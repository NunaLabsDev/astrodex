import type { ServerConfig } from "@astrodex/domain";

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
    });
}

export type TxVerificationResult =
  | { confirmed: true; ledger: number }
  | { confirmed: false; reason: string };

/**
 * Verifies a submitted Stellar transaction hash against Horizon and Soroban RPC failover pools.
 */
export async function verifyTransactionConfirmed(
  config: Pick<ServerConfig, "horizonUrls" | "rpcUrls">,
  txHash: string,
  expected?: { expectedSourceAccount?: string | undefined },
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
      });
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const body = (await res.json()) as {
        successful?: boolean;
        ledger?: number;
        source_account?: string;
      };
      if (body.successful === false) {
        return { confirmed: false, reason: "Transaction failed on-chain" };
      }
      if (
        expected?.expectedSourceAccount &&
        body.source_account &&
        body.source_account !== expected.expectedSourceAccount
      ) {
        return { confirmed: false, reason: "Transaction source account mismatch" };
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
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: { hash: cleanHash },
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        result?: { status?: string; ledger?: number };
      };
      if (body.result?.status === "SUCCESS") {
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
