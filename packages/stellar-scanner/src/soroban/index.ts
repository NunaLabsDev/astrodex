import type { AstroGateLaunchpadAudit, Protocol23TtlStatus } from "@astrodex/domain";
import {
  Account,
  Address,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
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
  const liveUntilLedgerSeq =
    typeof entry?.liveUntilLedgerSeq === "number" ? entry.liveUntilLedgerSeq : null;

  if (!entry || liveUntilLedgerSeq === null || currentLedger <= 0) {
    return {
      contractId,
      currentLedger,
      liveUntilLedgerSeq: null,
      ledgersRemaining: null,
      approxDaysRemaining: null,
      needsExtension: true,
      isExpiredOrArchived: entry === undefined && currentLedger > 0,
    };
  }

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

/**
 * Queries AstroGate public token detail & audit endpoints when configured so AstroDex gets
 * exact v4.5 Launchpad curve, 48h timelock, 7Y LP lock, 30d CurveClosed, and SHA-256 logo data.
 */
export async function fetchAstroGateTokenAudit(
  astroGateApiBaseUrl: string | undefined,
  contractId: string,
  fetchFn: ScannerFetchLike,
): Promise<AstroGateLaunchpadAudit> {
  const empty: AstroGateLaunchpadAudit = {
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

    if (!detail?.curve && !audit?.status?.startsWith("verified-fair")) {
      return empty;
    }

    const hasLaunchpadCheck = audit?.checks?.some(
      (c) => c.id === "launchpad_verified" && c.passed,
    );
    const isLaunchpadToken = Boolean(detail?.curve) || Boolean(hasLaunchpadCheck);

    return {
      isLaunchpadToken,
      version: "v4.5",
      graduated: Boolean(detail?.curve?.graduated),
      curveClosed: Boolean(detail?.curve?.curveClosed),
      curveXlmNetStroops: detail?.curve?.curveXlmNetStroops ?? "0",
      graduationProgressPct: detail?.curve?.graduationPercent ?? 0,
      lpProtection: audit?.lpProtection ?? (detail?.curve?.graduated ? "locked_7y" : "bonding_curve"),
      lpLockedPercent: audit?.lpLockedPercent ?? (isLaunchpadToken ? 100 : 0),
      has48hTimelock: isLaunchpadToken,
      pairId: detail?.curve?.pairId ?? audit?.pairId ?? undefined,
      creator: detail?.curve?.creator,
      logoSha256Url: detail?.logoUrl,
      sorobitXpEligible: isLaunchpadToken,
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
