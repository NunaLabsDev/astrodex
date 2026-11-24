import type { ClassicIssuerLockResult } from "@astrodex/domain";
import { Asset } from "@stellar/stellar-sdk";

export interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type ScannerFetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  },
) => Promise<MinimalFetchResponse>;

export interface HorizonAccountInput {
  thresholds?: {
    low_threshold?: number;
    med_threshold?: number;
    high_threshold?: number;
  };
  signers?: Array<{
    key?: string;
    weight?: number;
    type?: string;
  }>;
  flags?: {
    auth_required?: boolean;
    auth_revocable?: boolean;
    auth_immutable?: boolean;
    auth_clawback_enabled?: boolean;
  };
  home_domain?: string;
  balances?: Array<{
    asset_type?: string;
    asset_code?: string;
    asset_issuer?: string;
    balance?: string;
  }>;
}

export interface StellarTomlCurrencyMeta {
  code: string;
  issuer?: string | undefined;
  name?: string | undefined;
  desc?: string | undefined;
  image?: string | undefined;
  conditions?: string | undefined;
  isAssetAnchored?: boolean | undefined;
  anchorAsset?: string | undefined;
  orgName?: string | undefined;
  orgUrl?: string | undefined;
}

export interface Sep42VerifiedAsset {
  code: string;
  issuer?: string | undefined;
  contract?: string | undefined;
  name?: string | undefined;
  icon?: string | undefined;
  domain?: string | undefined;
}

export const PROTECTED_CLASSIC_TICKERS = new Set([
  "XLM",
  "USDC",
  "EURC",
  "PYUSD",
  "AQUA",
  "BTC",
  "ETH",
  "USDT",
  "USDT0",
  "USDE",
  "SUSDE",
  "YUSDC",
  "YXLM",
]);

export interface KnownLayerZeroOftAsset {
  code: string;
  name: string;
  issuer: string;
  sacId: string;
  oftContractId?: string | undefined;
  category: "ethena_yield" | "omnichain_stable";
}

/**
 * Canonical Stellar Mainnet LayerZero V2 (EID 30600) OFT assets.
 * OFT issuers typically omit `stellar.toml` / `home_domain` and mint/burn via SAC Manager.
 */
export const KNOWN_MAINNET_LAYERZERO_OFT_ASSETS: readonly KnownLayerZeroOftAsset[] = [
  {
    code: "USDE",
    name: "Ethena USDe",
    issuer: "GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47",
    sacId: "CCNOV6XVI2O5BSTA3232GIRUQULDEBV7IWGKM6QKI6II5OIIQTU24JJN",
    category: "ethena_yield",
  },
  {
    code: "SUSDE",
    name: "Ethena Staked USDe",
    issuer: "GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47",
    sacId: "CACSKWC753QVGC4J6YPDBIR2BEHFVWIAE7CBSS3HOVYMN623OAIQYE2M",
    category: "ethena_yield",
  },
  {
    code: "USDT0",
    name: "Tether USDT0 (LayerZero OFT)",
    issuer: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    sacId: "CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF",
    oftContractId: "CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6",
    category: "omnichain_stable",
  },
];

export function findKnownLayerZeroOftAsset(input: {
  code?: string | undefined;
  issuer?: string | undefined;
  contractId?: string | undefined;
}): KnownLayerZeroOftAsset | undefined {
  const upperCode = input.code?.trim().toUpperCase();
  const upperIssuer = input.issuer?.trim().toUpperCase();
  const upperContract = input.contractId?.trim().toUpperCase();
  return KNOWN_MAINNET_LAYERZERO_OFT_ASSETS.find((entry) => {
    if (upperContract && (entry.sacId === upperContract || entry.oftContractId === upperContract)) {
      return true;
    }
    if (upperCode && upperIssuer) {
      return entry.code.toUpperCase() === upperCode && entry.issuer === upperIssuer;
    }
    return false;
  });
}

/**
 * Computes deterministic Stellar Asset Contract (SAC) C... ID for any Classic or Native asset.
 */
export function deriveSacContractId(
  assetCode: string,
  assetIssuer: string | undefined,
  networkPassphrase: string,
): string {
  const asset =
    assetCode.toUpperCase() === "XLM" && !assetIssuer
      ? Asset.native()
      : new Asset(assetCode, assetIssuer ?? "");
  return asset.contractId(networkPassphrase);
}

/**
 * Mathematical Issuer Lock audit:
 * An issuer is supply-locked ONLY when master_weight === 0 AND the sum of all
 * remaining secondary signer weights is strictly less than low_threshold
 * (or any non-master signer alone cannot reach low_threshold).
 */
export function auditClassicIssuerLock(account: HorizonAccountInput): ClassicIssuerLockResult {
  const lowThreshold = Math.max(0, Math.trunc(account.thresholds?.low_threshold ?? 0));
  const medThreshold = Math.max(0, Math.trunc(account.thresholds?.med_threshold ?? 0));
  const highThreshold = Math.max(0, Math.trunc(account.thresholds?.high_threshold ?? 0));

  let masterWeight = 0;
  let maxSignerWeight = 0;
  let combinedSecondaryWeight = 0;
  const signers = account.signers ?? [];

  for (const signer of signers) {
    const w = Math.max(0, Math.trunc(signer.weight ?? 0));
    if (signer.type === "ed25519_public_key" && signers.length === 1) {
      masterWeight = w;
    } else if (signer.key && signer.weight !== undefined) {
      // Caller can provide master key separately or as first ed25519 signer; distinguish via account_id if known.
      combinedSecondaryWeight += w;
      if (w > maxSignerWeight) maxSignerWeight = w;
    }
  }

  return {
    locked: masterWeight === 0 && combinedSecondaryWeight < Math.max(1, lowThreshold),
    masterWeight,
    lowThreshold,
    medThreshold,
    highThreshold,
    maxSignerWeight,
    combinedSecondaryWeight,
    signerCount: signers.length,
    flags: {
      authRequired: Boolean(account.flags?.auth_required),
      authRevocable: Boolean(account.flags?.auth_revocable),
      authImmutable: Boolean(account.flags?.auth_immutable),
      authClawbackEnabled: Boolean(account.flags?.auth_clawback_enabled),
    },
  };
}

/**
 * Account-ID-aware Issuer Lock audit: separates master key weight from secondary co-signers.
 */
export function auditClassicIssuerLockForAccount(
  issuerAccountId: string,
  account: HorizonAccountInput,
): ClassicIssuerLockResult {
  const lowThreshold = Math.max(0, Math.trunc(account.thresholds?.low_threshold ?? 0));
  const medThreshold = Math.max(0, Math.trunc(account.thresholds?.med_threshold ?? 0));
  const highThreshold = Math.max(0, Math.trunc(account.thresholds?.high_threshold ?? 0));

  let masterWeight = 0;
  let maxSignerWeight = 0;
  let combinedSecondaryWeight = 0;
  const signers = account.signers ?? [];

  for (const signer of signers) {
    const w = Math.max(0, Math.trunc(signer.weight ?? 0));
    if (signer.key === issuerAccountId) {
      masterWeight = w;
    } else {
      combinedSecondaryWeight += w;
      if (w > maxSignerWeight) maxSignerWeight = w;
    }
  }

  const minActionableThreshold = Math.max(1, lowThreshold);
  const locked =
    masterWeight === 0 && combinedSecondaryWeight < minActionableThreshold;

  return {
    locked,
    masterWeight,
    lowThreshold,
    medThreshold,
    highThreshold,
    maxSignerWeight,
    combinedSecondaryWeight,
    signerCount: signers.length,
    flags: {
      authRequired: Boolean(account.flags?.auth_required),
      authRevocable: Boolean(account.flags?.auth_revocable),
      authImmutable: Boolean(account.flags?.auth_immutable),
      authClawbackEnabled: Boolean(account.flags?.auth_clawback_enabled),
    },
  };
}

export async function fetchHorizonWithFailover<T>(
  horizonUrls: readonly string[],
  path: string,
  fetchFn: ScannerFetchLike,
): Promise<T | null> {
  for (const base of horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await fetchFn(`${clean}${path}`, {
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) return null;
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // Try next Horizon node
    }
  }
  return null;
}

export async function fetchSep42VerifiedAssets(
  urls: readonly string[],
  fetchFn: ScannerFetchLike,
): Promise<Sep42VerifiedAsset[]> {
  const byKey = new Map<string, Sep42VerifiedAsset>();

  for (const url of urls) {
    try {
      const res = await fetchFn(url, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        assets?: Array<{
          code?: string;
          issuer?: string;
          contract?: string;
          name?: string;
          icon?: string;
          domain?: string;
        }>;
      };
      for (const item of body.assets ?? []) {
        if (!item.code) continue;
        const key = `${item.code.toUpperCase()}:${item.issuer ?? item.contract ?? ""}`;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, {
            code: item.code,
            issuer: item.issuer,
            contract: item.contract,
            name: item.name,
            icon: item.icon,
            domain: item.domain,
          });
        } else {
          byKey.set(key, {
            code: existing.code,
            issuer: existing.issuer ?? item.issuer,
            contract: existing.contract ?? item.contract,
            name: existing.name ?? item.name,
            icon: existing.icon ?? item.icon,
            domain: existing.domain ?? item.domain,
          });
        }
      }
    } catch {
      // Continue to next registry
    }
  }

  return Array.from(byKey.values());
}

export async function fetchDirectoryTags(
  stellarExpertApiBase: string | undefined,
  network: "testnet" | "mainnet",
  address: string,
  fetchFn: ScannerFetchLike,
): Promise<string[]> {
  if (!stellarExpertApiBase) return [];
  const netSlug = network === "mainnet" ? "public" : "testnet";
  const base = stellarExpertApiBase.replace(/\/+$/, "");
  try {
    const res = await fetchFn(
      `${base}/explorer/${netSlug}/directory/${encodeURIComponent(address)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const raw = (await res.json()) as { tags?: unknown };
    return Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Lightweight, SSRF-safe parser for SEP-0001 stellar.toml [[CURRENCIES]] and [DOCUMENTATION] blocks.
 */
export function parseStellarTomlForAsset(
  tomlText: string,
  assetCode: string,
  assetIssuer?: string,
): StellarTomlCurrencyMeta | null {
  const lines = tomlText.split(/\r?\n/);
  let section: "none" | "doc" | "currency" = "none";
  let orgName: string | undefined;
  let orgUrl: string | undefined;
  let current: Record<string, string | boolean> | null = null;
  const currencies: Array<Record<string, string | boolean>> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "[DOCUMENTATION]") {
      if (current) {
        currencies.push(current);
        current = null;
      }
      section = "doc";
      continue;
    }
    if (line === "[[CURRENCIES]]") {
      if (current) currencies.push(current);
      current = {};
      section = "currency";
      continue;
    }
    if (line.startsWith("[")) {
      if (current) {
        currencies.push(current);
        current = null;
      }
      section = "none";
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const rawValAfterEq = line.slice(eqIdx + 1).trim();
    // Strip inline TOML comments outside quotes
    let rawVal = rawValAfterEq;
    if (rawValAfterEq.startsWith('"') || rawValAfterEq.startsWith("'")) {
      const quoteChar = rawValAfterEq[0]!;
      const closeIdx = rawValAfterEq.indexOf(quoteChar, 1);
      if (closeIdx > 0) {
        rawVal = rawValAfterEq.slice(0, closeIdx + 1);
      }
    } else {
      const hashIdx = rawValAfterEq.indexOf("#");
      if (hashIdx >= 0) {
        rawVal = rawValAfterEq.slice(0, hashIdx).trim();
      }
    }
    let parsedVal: string | boolean = rawVal;
    if (
      (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'"))
    ) {
      parsedVal = rawVal.slice(1, -1);
    } else if (rawVal === "true") {
      parsedVal = true;
    } else if (rawVal === "false") {
      parsedVal = false;
    }

    if (section === "doc") {
      if (key === "ORG_NAME" && typeof parsedVal === "string") orgName = parsedVal;
      if (key === "ORG_URL" && typeof parsedVal === "string") orgUrl = parsedVal;
    } else if (section === "currency" && current) {
      current[key] = parsedVal;
    }
  }
  if (current) currencies.push(current);

  const upperCode = assetCode.toUpperCase();
  const match = currencies.find((c) => {
    const cCode = typeof c.code === "string" ? c.code.toUpperCase() : "";
    const cIssuer = typeof c.issuer === "string" ? c.issuer.toUpperCase() : "";
    if (cCode !== upperCode) return false;
    if (assetIssuer) return cIssuer === assetIssuer.toUpperCase();
    return true;
  });

  if (!match) return null;

  return {
    code: typeof match.code === "string" ? match.code : assetCode,
    issuer: typeof match.issuer === "string" ? match.issuer : undefined,
    name: typeof match.name === "string" ? match.name : undefined,
    desc: typeof match.desc === "string" ? match.desc : undefined,
    image: typeof match.image === "string" ? match.image : undefined,
    conditions: typeof match.conditions === "string" ? match.conditions : undefined,
    isAssetAnchored:
      typeof match.is_asset_anchored === "boolean" ? match.is_asset_anchored : undefined,
    anchorAsset: typeof match.anchor_asset === "string" ? match.anchor_asset : undefined,
    orgName,
    orgUrl,
  };
}
