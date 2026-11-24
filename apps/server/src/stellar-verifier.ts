import type { ServerConfig } from "@astrodex/domain";
import { decodeTransactionEnvelope } from "@astrodex/security-shield";

export type FetchLike = typeof fetch;

export function adaptFetch(fetchFn: FetchLike) {
  return (
    input: string,
    init?: {
      method?: string | undefined;
      headers?: Record<string, string> | undefined;
      body?: string | undefined;
    },
  ) =>
    fetchFn(input, {
      ...(init?.method !== undefined ? { method: init.method } : {}),
      ...(init?.headers !== undefined ? { headers: init.headers } : {}),
      ...(init?.body !== undefined ? { body: init.body } : {}),
      signal: AbortSignal.timeout(8_000),
    });
}

export type TxVerificationResult =
  | { confirmed: true; ledger: number }
  | { confirmed: false; reason: string };

/**
 * Verifies a submitted Stellar transaction hash against Horizon and Soroban RPC failover pools.
 */
export async function verifyTransactionConfirmed(
  config: Pick<ServerConfig, "horizonUrls" | "rpcUrls" | "networkPassphrase">,
  txHash: string,
  expected?: {
    expectedSourceAccount?: string | undefined;
    minCreatedAtUnix?: number | undefined;
  },
  fetchFn: FetchLike = fetch,
): Promise<TxVerificationResult> {
  const cleanHash = txHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleanHash)) {
    return { confirmed: false, reason: "Invalid 64-char hex transaction hash" };
  }

  for (const base of config.horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await fetchFn(`${clean}/transactions/${cleanHash}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const body = (await res.json()) as {
        successful?: boolean;
        ledger?: number;
        created_at?: string;
        source_account?: string;
        envelope_xdr?: string;
      };
      if (body.successful === false) {
        return { confirmed: false, reason: "Transaction failed on-chain" };
      }
      if (expected?.minCreatedAtUnix && body.created_at) {
        const txUnix = Math.floor(Date.parse(body.created_at) / 1000);
        if (Number.isFinite(txUnix) && txUnix > 0 && txUnix < expected.minCreatedAtUnix - 15) {
          return {
            confirmed: false,
            reason: "Transaction predates intent creation (replay rejected)",
          };
        }
      }
      if (
        expected?.expectedSourceAccount &&
        body.source_account &&
        body.source_account !== expected.expectedSourceAccount
      ) {
        return { confirmed: false, reason: "Transaction source account mismatch" };
      }
      if (expected?.expectedSourceAccount) {
        if (!body.envelope_xdr) {
          return { confirmed: false, reason: "Missing Horizon transaction envelope_xdr" };
        }
        try {
          const decoded = decodeTransactionEnvelope(body.envelope_xdr, config.networkPassphrase);
          if (
            decoded.sourceAccount !== expected.expectedSourceAccount &&
            decoded.feeSource !== expected.expectedSourceAccount
          ) {
            return { confirmed: false, reason: "Transaction source account mismatch" };
          }
          if (decoded.operations.length === 0) {
            return { confirmed: false, reason: "Transaction envelope contains no operations" };
          }
        } catch {
          return { confirmed: false, reason: "Unable to verify Horizon transaction envelope" };
        }
      }
      return { confirmed: true, ledger: body.ledger ?? 0 };
    } catch {
      // Fail over
    }
  }

  for (const rpcUrl of config.rpcUrls) {
    try {
      const res = await fetchFn(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: { hash: cleanHash },
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        result?: { status?: string; ledger?: number; ledgerCloseTime?: string; envelopeXdr?: string };
      };
      if (body.result?.status === "SUCCESS") {
        if (expected?.minCreatedAtUnix && body.result.ledgerCloseTime) {
          const txUnix = Number(body.result.ledgerCloseTime);
          if (Number.isFinite(txUnix) && txUnix > 0 && txUnix < expected.minCreatedAtUnix - 15) {
            return {
              confirmed: false,
              reason: "Transaction predates intent creation (replay rejected)",
            };
          }
        }
        if (expected?.expectedSourceAccount) {
          if (!body.result.envelopeXdr) {
            return { confirmed: false, reason: "Missing Soroban transaction envelopeXdr" };
          }
          try {
            const decoded = decodeTransactionEnvelope(
              body.result.envelopeXdr,
              config.networkPassphrase,
            );
            if (
              decoded.sourceAccount !== expected.expectedSourceAccount &&
              decoded.feeSource !== expected.expectedSourceAccount
            ) {
              return { confirmed: false, reason: "Transaction source account mismatch" };
            }
          } catch {
            return { confirmed: false, reason: "Unable to verify Soroban transaction envelope" };
          }
        }
        return { confirmed: true, ledger: body.result.ledger ?? 0 };
      }
      if (body.result?.status === "FAILED") {
        return { confirmed: false, reason: "Soroban transaction failed on-chain" };
      }
    } catch {
      // Fail over
    }
  }

  return { confirmed: false, reason: "Transaction not found or not yet confirmed on-chain" };
}
