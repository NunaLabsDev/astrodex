import {
  normalizeAssetIdentifier,
  type ScannerPort,
  type StellarAddress,
  type TokenForensicAudit,
} from "@astrodex/domain";
import {
  auditClassicIssuerLockForAccount,
  deriveSacContractId,
  fetchDirectoryTags,
  fetchHorizonWithFailover,
  fetchSep42VerifiedAssets,
  findKnownLayerZeroOftAsset,
  KNOWN_MAINNET_LAYERZERO_OFT_ASSETS,
  parseStellarTomlForAsset,
  PROTECTED_CLASSIC_TICKERS,
  type HorizonAccountInput,
  type ScannerFetchLike,
} from "./classic/index.js";
import { computeAstroShieldScore } from "./scorer/index.js";
import {
  buildExtendContractTtlXdr,
  checkStellarRegistryStatus,
  fetchAstroGateTokenAudit,
  fetchSorobanTokenMetadata,
  inspectProtocol23ContractTtl,
} from "./soroban/index.js";

export * from "./classic/index.js";
export * from "./holders/index.js";
export * from "./scorer/index.js";
export * from "./soroban/index.js";

export interface StellarScannerConfig {
  network: "testnet" | "mainnet";
  networkPassphrase: string;
  rpcUrls: readonly string[];
  horizonUrls: readonly string[];
  sep42AssetListUrls: readonly string[];
  stellarExpertApiBase?: string | undefined;
  astroGateApiBaseUrl?: string | undefined;
  stellarRegistryApiBase?: string | undefined;
  stellarTomlProxyFetcher?: ((domain: string) => Promise<string | null>) | undefined;
  fetchFn?: ScannerFetchLike | undefined;
}

export function createStellarForensicScanner(config: StellarScannerConfig): ScannerPort {
  const fetchFn =
    config.fetchFn ?? ((globalThis as unknown as { fetch: ScannerFetchLike }).fetch);

  return {
    async auditToken(assetIdentifier: string): Promise<TokenForensicAudit> {
      const normalized = normalizeAssetIdentifier(assetIdentifier);
      const nowUnix = Math.floor(Date.now() / 1000);

      if (normalized.kind === "native") {
        const sacContractId = deriveSacContractId("XLM", undefined, config.networkPassphrase);
        const scored = computeAstroShieldScore({
          kind: "native",
          code: "XLM",
          isSpoofedProtectedTicker: false,
          isSep42Verified: true,
          directoryTags: [],
        });
        return {
          assetKey: "XLM",
          kind: "native",
          code: "XLM",
          name: "Stellar Lumens",
          sacContractId,
          decimals: 7,
          ...scored,
          directoryTags: [],
          auditedAtUnix: nowUnix,
        };
      }

      const sep42Assets = await fetchSep42VerifiedAssets(config.sep42AssetListUrls, fetchFn);

      if (normalized.kind === "classic" && normalized.issuer) {
        const sacContractId = deriveSacContractId(
          normalized.code,
          normalized.issuer,
          config.networkPassphrase,
        );
        const [account, directoryTags] = await Promise.all([
          fetchHorizonWithFailover<HorizonAccountInput>(
            config.horizonUrls,
            `/accounts/${encodeURIComponent(normalized.issuer)}`,
            fetchFn,
          ),
          fetchDirectoryTags(
            config.stellarExpertApiBase,
            config.network,
            normalized.issuer,
            fetchFn,
          ),
        ]);

        const classicAudit = account
          ? auditClassicIssuerLockForAccount(normalized.issuer, account)
          : undefined;
        const homeDomain = account?.home_domain;
        let tomlMeta = null;
        if (homeDomain && config.stellarTomlProxyFetcher) {
          const tomlText = await config.stellarTomlProxyFetcher(homeDomain).catch(() => null);
          if (tomlText) {
            tomlMeta = parseStellarTomlForAsset(tomlText, normalized.code, normalized.issuer);
          }
        }

        const sep42Match = sep42Assets.find(
          (a) =>
            a.code.toUpperCase() === normalized.code.toUpperCase() &&
            a.issuer?.toUpperCase() === normalized.issuer?.toUpperCase(),
        );
        const oftMatch =
          config.network === "mainnet"
            ? findKnownLayerZeroOftAsset({
                code: normalized.code,
                issuer: normalized.issuer,
                contractId: sacContractId,
              })
            : undefined;
        const isSep42Verified = Boolean(sep42Match);
        const isLayerZeroOftVerified = Boolean(oftMatch);
        const upperCode = normalized.code.toUpperCase();
        const isProtectedOftTicker =
          config.network === "mainnet" &&
          KNOWN_MAINNET_LAYERZERO_OFT_ASSETS.some((a) => a.code.toUpperCase() === upperCode);
        const isSpoofedProtectedTicker =
          PROTECTED_CLASSIC_TICKERS.has(upperCode) &&
          !isSep42Verified &&
          !isLayerZeroOftVerified &&
          (isProtectedOftTicker || sep42Assets.some((a) => a.code.toUpperCase() === upperCode));

        const scored = computeAstroShieldScore({
          kind: "classic",
          code: normalized.code,
          isSpoofedProtectedTicker,
          isSep42Verified,
          isLayerZeroOftVerified,
          directoryTags,
          classicAudit,
        });

        return {
          assetKey: normalized.canonicalKey,
          kind: "classic",
          code: normalized.code,
          name: tomlMeta?.name ?? sep42Match?.name ?? oftMatch?.name,
          issuer: normalized.issuer,
          sacContractId,
          decimals: 7,
          logoUrl: tomlMeta?.image ?? sep42Match?.icon,
          homeDomain,
          ...scored,
          classicAudit,
          directoryTags,
          auditedAtUnix: nowUnix,
        };
      }

      // Soroban contract token (C...)
      const contractId = normalized.contractId!;
      const [ttlStatus, astroGate, registry, directoryTags, sep41Meta] = await Promise.all([
        inspectProtocol23ContractTtl(config.rpcUrls, contractId, fetchFn),
        fetchAstroGateTokenAudit(config.astroGateApiBaseUrl, contractId, fetchFn),
        checkStellarRegistryStatus(config.stellarRegistryApiBase, contractId, fetchFn),
        fetchDirectoryTags(config.stellarExpertApiBase, config.network, contractId, fetchFn),
        fetchSorobanTokenMetadata(config.rpcUrls, contractId, config.networkPassphrase, fetchFn),
      ]);

      const sep42Match = sep42Assets.find(
        (a) => a.contract?.toUpperCase() === contractId.toUpperCase(),
      );
      const oftMatch =
        config.network === "mainnet"
          ? findKnownLayerZeroOftAsset({ contractId })
          : undefined;
      const isSep42Verified = Boolean(sep42Match);
      const isLayerZeroOftVerified = Boolean(oftMatch);
      const resolvedCode =
        oftMatch?.code ?? sep42Match?.code ?? astroGate.symbol ?? sep41Meta.symbol ?? normalized.code;
      const resolvedName =
        oftMatch?.name ?? sep42Match?.name ?? astroGate.name ?? sep41Meta.name;
      const resolvedDecimals = astroGate.decimals ?? sep41Meta.decimals ?? 7;

      const sorobanAudit = {
        owner: isLayerZeroOftVerified || astroGate.isLaunchpadToken ? null : "unverified",
        ownerRenounced: astroGate.isLaunchpadToken || isLayerZeroOftVerified,
        dangerousMethods:
          !astroGate.isLaunchpadToken && !isLayerZeroOftVerified && !registry.verified
            ? ["unverified_admin_authority"]
            : ([] as string[]),
        sep55Verified: registry.verified || astroGate.isLaunchpadToken || isLayerZeroOftVerified,
        registryVerified: registry.verified || isLayerZeroOftVerified,
        ttlStatus,
        astroGate,
      };

      const upperSorobanCode = resolvedCode.toUpperCase();
      const isSpoofedSorobanOft =
        config.network === "mainnet" &&
        !isSep42Verified &&
        !isLayerZeroOftVerified &&
        KNOWN_MAINNET_LAYERZERO_OFT_ASSETS.some((a) => a.code.toUpperCase() === upperSorobanCode);

      const scored = computeAstroShieldScore({
        kind: "soroban",
        code: resolvedCode,
        isSpoofedProtectedTicker: isSpoofedSorobanOft,
        isSep42Verified,
        isLayerZeroOftVerified,
        directoryTags,
        sorobanAudit: {
          owner: sorobanAudit.owner ?? null,
          ownerRenounced: sorobanAudit.ownerRenounced,
          dangerousMethods: sorobanAudit.dangerousMethods,
          sep55Verified: sorobanAudit.sep55Verified,
          registryVerified: sorobanAudit.registryVerified,
          ttlStatus,
          astroGate,
        },
      });

      return {
        assetKey: contractId,
        kind: "soroban",
        code: resolvedCode,
        name: resolvedName,
        issuer: sep42Match?.issuer,
        contractId,
        decimals: resolvedDecimals,
        logoUrl: astroGate.logoSha256Url ?? sep42Match?.icon,
        ...scored,
        sorobanAudit: {
          owner: sorobanAudit.owner ?? null,
          ownerRenounced: sorobanAudit.ownerRenounced,
          dangerousMethods: sorobanAudit.dangerousMethods,
          sep55Verified: sorobanAudit.sep55Verified,
          registryVerified: sorobanAudit.registryVerified,
          ttlStatus,
          astroGate,
        },
        directoryTags,
        auditedAtUnix: nowUnix,
      };
    },

    async buildExtendTtlXdr(contractId: string, sourceAddress: StellarAddress): Promise<string> {
      return buildExtendContractTtlXdr({
        contractId,
        sourceAddress,
        networkPassphrase: config.networkPassphrase,
      });
    },
  };
}
