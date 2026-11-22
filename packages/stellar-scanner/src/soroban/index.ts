import type { AstroGateLaunchpadAudit, Protocol23TtlStatus } from "@astrodex/domain";
import {
  Account,
  Address,
  Contract,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { ScannerFetchLike } from "../classic/index.js";

export const CANONICAL_STELLAR_BURN_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
export const DANGEROUS_SOROBAN_METHODS = [
  "mint",
  "clawback",
  "set_admin",
  "burn_from",
  "upgrade",
] as const;

const LEDGERS_PER_DAY = 17_280; // ~5s average Stellar ledger close time
const LOW_TTL_THRESHOLD_LEDGERS = LEDGERS_PER_DAY * 14; // Warn < 14 days

export interface SorobanRpcJsonResult {
  latestLedger?: number;
  entries?: Array<{
    key?: string;
    xdr?: string;
    liveUntilLedgerSeq?: number;
  }>;
  results?: Array<{
    xdr?: string;
  }>;
}

export async function callSorobanRpc<T>(
  rpcUrls: readonly string[],
  method: string,
  params: unknown,
  fetchFn: ScannerFetchLike,
): Promise<T | null> {
  for (const url of rpcUrls) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { result?: T; error?: unknown };
      if (body.error || body.result === undefined) continue;
      return body.result;
    } catch {
      // Fail over to next RPC endpoint
    }
  }
  return null;
}

/**
 * Inspects Protocol 23 ("Whisk") contract instance TTL via getLedgerEntries.
 */
export async function inspectProtocol23ContractTtl(
  rpcUrls: readonly string[],
  contractId: string,
  fetchFn: ScannerFetchLike,
): Promise<Protocol23TtlStatus> {
  const keyXdr = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ).toXDR("base64");

  const result = await callSorobanRpc<SorobanRpcJsonResult>(
    rpcUrls,
    "getLedgerEntries",
    { keys: [keyXdr] },
    fetchFn,
  );

  const currentLedger = result?.latestLedger ?? 0;
  const entry = result?.entries?.[0];
  const rawLiveUntil =
    typeof entry?.liveUntilLedgerSeq === "number" ? entry.liveUntilLedgerSeq : null;

  if (!entry || rawLiveUntil === null || rawLiveUntil <= 0 || currentLedger <= 0) {
    return {
      contractId,
      currentLedger,
      liveUntilLedgerSeq: null,
      ledgersRemaining: null,
      approxDaysRemaining: null,
      needsExtension: entry === undefined && currentLedger > 0,
      isExpiredOrArchived: entry === undefined && currentLedger > 0,
    };
  }

  const liveUntilLedgerSeq = rawLiveUntil;
  const ledgersRemaining = Math.max(0, liveUntilLedgerSeq - currentLedger);
  const approxDaysRemaining = Number((ledgersRemaining / LEDGERS_PER_DAY).toFixed(1));
  return {
    contractId,
    currentLedger,
    liveUntilLedgerSeq,
    ledgersRemaining,
    approxDaysRemaining,
    needsExtension: ledgersRemaining < LOW_TTL_THRESHOLD_LEDGERS,
    isExpiredOrArchived: liveUntilLedgerSeq <= currentLedger,
  };
}

/**
 * Builds an unsigned ExtendFootprintTtlOp XDR so users can rescue/extend Soroban contract TTL via AstroWallet.
 */
export function buildExtendContractTtlXdr(input: {
  sourceAddress: string;
  contractId: string;
  extendToLedgers?: number | undefined;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(input.contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );

  const sorobanData = new SorobanDataBuilder()
    .setReadOnly([key])
    .setResourceFee(50_000)
    .build();

  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      Operation.extendFootprintTtl({
        extendTo: input.extendToLedgers ?? 535_680, // ~31 days
      }),
    )
    .setSorobanData(sorobanData)
    .setTimeout(300)
    .build();

  return tx.toXDR();
}

/**
 * Checks Soroban contract exported spec names (SEP-48 style) against privileged dangerous entrypoints.
 */
export function detectDangerousSorobanMethods(exportedFunctions: readonly string[]): string[] {
  const lowerSet = new Set(exportedFunctions.map((fn) => fn.toLowerCase()));
  return DANGEROUS_SOROBAN_METHODS.filter((method) => lowerSet.has(method));
}

export interface SorobanTokenMetadata {
  symbol?: string | undefined;
  name?: string | undefined;
  decimals?: number | undefined;
}

async function simulateReadOnlyContractStringOrNumber(
  rpcUrls: readonly string[],
  contractId: string,
  method: string,
  networkPassphrase: string,
  fetchFn: ScannerFetchLike,
): Promise<unknown | null> {
  try {
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(new Account(CANONICAL_STELLAR_BURN_ADDRESS, "0"), {
      fee: "100",
      networkPassphrase,
    })
      .addOperation(contract.call(method))
      .setTimeout(30)
      .build();
    const result = await callSorobanRpc<SorobanRpcJsonResult>(
      rpcUrls,
      "simulateTransaction",
      { transaction: tx.toXDR() },
      fetchFn,
    );
    const rawXdr = result?.results?.[0]?.xdr;
    if (!rawXdr) return null;
    return scValToNative(xdr.ScVal.fromXDR(rawXdr, "base64"));
  } catch {
    return null;
  }
}

/**
 * Reads SEP-41 `symbol()`, `name()`, and `decimals()` from any Soroban token contract via RPC simulation.
 */
export async function fetchSorobanTokenMetadata(
  rpcUrls: readonly string[],
  contractId: string,
  networkPassphrase: string,
  fetchFn: ScannerFetchLike,
): Promise<SorobanTokenMetadata> {
  const [rawSymbol, rawName, rawDecimals] = await Promise.all([
    simulateReadOnlyContractStringOrNumber(rpcUrls, contractId, "symbol", networkPassphrase, fetchFn),
    simulateReadOnlyContractStringOrNumber(rpcUrls, contractId, "name", networkPassphrase, fetchFn),
    simulateReadOnlyContractStringOrNumber(rpcUrls, contractId, "decimals", networkPassphrase, fetchFn),
  ]);

  const symbol =
    typeof rawSymbol === "string" && rawSymbol.trim().length > 0
      ? rawSymbol.trim().slice(0, 24)
      : undefined;
  const name =
    typeof rawName === "string" && rawName.trim().length > 0
      ? rawName.trim().slice(0, 64)
      : undefined;
  const decimals =
    typeof rawDecimals === "number" && Number.isInteger(rawDecimals) && rawDecimals >= 0 && rawDecimals <= 18
      ? rawDecimals
      : typeof rawDecimals === "bigint" && rawDecimals >= 0n && rawDecimals <= 18n
        ? Number(rawDecimals)
        : undefined;

  return { symbol, name, decimals };
}

export interface AstroGateTokenAuditResult extends AstroGateLaunchpadAudit {
  symbol?: string | undefined;
  name?: string | undefined;
  decimals?: number | undefined;
}

/**
 * Queries AstroGate public token detail & audit endpoints when configured so AstroDex gets
 * exact v4.5 Launchpad curve, 48h timelock, 7Y LP lock, 30d CurveClosed, and SHA-256 logo data.
 */
export async function fetchAstroGateTokenAudit(
  astroGateApiBaseUrl: string | undefined,
  contractId: string,
  fetchFn: ScannerFetchLike,
): Promise<AstroGateTokenAuditResult> {
  const empty: AstroGateTokenAuditResult = {
    isLaunchpadToken: false,
    version: "none",
    graduated: false,
    curveClosed: false,
    curveXlmNetStroops: "0",
    graduationProgressPct: 0,
    lpProtection: "unlocked",
    lpLockedPercent: 0,
    has48hTimelock: false,
  };

  if (!astroGateApiBaseUrl) return empty;
  const base = astroGateApiBaseUrl.replace(/\/+$/, "");

  try {
    const [detailRes, auditRes] = await Promise.all([
      fetchFn(`${base}/api/v1/tokens/${encodeURIComponent(contractId)}`, {
        headers: { Accept: "application/json" },
      }),
      fetchFn(`${base}/api/v1/tokens/${encodeURIComponent(contractId)}/audit`, {
        headers: { Accept: "application/json" },
      }),
    ]);

    const detail = detailRes.ok
      ? ((await detailRes.json()) as {
          ok?: boolean;
          symbol?: string;
          name?: string;
          decimals?: number;
          dexReserveXlmStroops?: string | null;
          curve?: {
            graduated?: boolean;
            curveClosed?: boolean;
            graduationPercent?: number;
            curveXlmNetStroops?: string;
            pairId?: string | null;
            creator?: string;
          } | null;
          logoUrl?: string;
        })
      : null;

    const audit = auditRes.ok
      ? ((await auditRes.json()) as {
          ok?: boolean;
          status?: string;
          lpProtection?: "locked_7y" | "burned" | "unlocked" | "bonding_curve";
          lpLockedPercent?: number;
          pairId?: string | null;
          checks?: Array<{ id?: string; passed?: boolean; detail?: string }>;
        })
      : null;

    const hasDexReserve =
      typeof detail?.dexReserveXlmStroops === "string" &&
      /^\d+$/.test(detail.dexReserveXlmStroops) &&
      BigInt(detail.dexReserveXlmStroops) > 0n;
    const isVerifiedFair = Boolean(audit?.status?.startsWith("verified-fair"));

    if (!detail?.curve && !hasDexReserve && !isVerifiedFair) {
      return {
        ...empty,
        symbol: typeof detail?.symbol === "string" ? detail.symbol : undefined,
        name: typeof detail?.name === "string" ? detail.name : undefined,
        decimals: typeof detail?.decimals === "number" ? detail.decimals : undefined,
        logoSha256Url: detail?.logoUrl,
      };
    }

    const hasLaunchpadCheck = audit?.checks?.some(
      (c) => c.id === "launchpad_verified" && c.passed,
    );
    const isLaunchpadToken =
      Boolean(detail?.curve) || hasDexReserve || Boolean(hasLaunchpadCheck) || isVerifiedFair;
    const graduated = Boolean(detail?.curve?.graduated) || (!detail?.curve && hasDexReserve);

    return {
      isLaunchpadToken,
      version: "v4.5",
      graduated,
      curveClosed: Boolean(detail?.curve?.curveClosed),
      curveXlmNetStroops:
        detail?.curve?.curveXlmNetStroops ?? detail?.dexReserveXlmStroops ?? "0",
      graduationProgressPct: detail?.curve?.graduationPercent ?? (graduated ? 100 : 0),
      lpProtection: audit?.lpProtection ?? (graduated ? "locked_7y" : "bonding_curve"),
      lpLockedPercent: audit?.lpLockedPercent ?? (isLaunchpadToken ? 100 : 0),
      has48hTimelock: isLaunchpadToken,
      pairId: detail?.curve?.pairId ?? audit?.pairId ?? undefined,
      creator: detail?.curve?.creator,
      logoSha256Url: detail?.logoUrl,
      sorobitXpEligible: isLaunchpadToken,
      symbol: typeof detail?.symbol === "string" ? detail.symbol : undefined,
      name: typeof detail?.name === "string" ? detail.name : undefined,
      decimals: typeof detail?.decimals === "number" ? detail.decimals : undefined,
    };
  } catch {
    return empty;
  }
}

export async function checkStellarRegistryStatus(
  stellarRegistryApiBase: string | undefined,
  contractId: string,
  fetchFn: ScannerFetchLike,
): Promise<{ verified: boolean }> {
  if (!stellarRegistryApiBase) return { verified: false };
  const base = stellarRegistryApiBase.replace(/\/+$/, "");
  try {
    const res = await fetchFn(
      `${base}/api/contracts/${encodeURIComponent(contractId)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return { verified: false };
    const json = (await res.json()) as { verified?: boolean; name?: string };
    return { verified: Boolean(json.verified || json.name) };
  } catch {
    return { verified: false };
  }
}
