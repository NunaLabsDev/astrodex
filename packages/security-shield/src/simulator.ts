import type { BalanceDiff } from "@astrodex/domain";
import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";

export interface MinimalRpcResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type ShieldFetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  },
) => Promise<MinimalRpcResponse>;

export interface SimulatedSorobanResult {
  ok: boolean;
  error?: string | undefined;
  minResourceFeeStroops: string;
  requiresProtocol23Restore: boolean;
  balanceDiffs: BalanceDiff[];
  assembledXdr?: string | undefined;
}

export async function simulateSorobanTransaction(
  rpcUrls: readonly string[],
  xdrBase64: string,
  fetchFn: ShieldFetchLike,
  networkPassphrase?: string,
): Promise<SimulatedSorobanResult> {
  for (const url of rpcUrls) {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: { transaction: xdrBase64 },
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        result?: {
          error?: string;
          minResourceFee?: string;
          transactionData?: string;
          restorePreamble?: { minResourceFee?: string };
        };
        error?: { message?: string };
      };
      if (body.error) {
        return {
          ok: false,
          error: body.error.message ?? "Simulation RPC error",
          minResourceFeeStroops: "0",
          requiresProtocol23Restore: false,
          balanceDiffs: [],
        };
      }
      if (body.result?.error) {
        return {
          ok: false,
          error: body.result.error,
          minResourceFeeStroops: body.result.minResourceFee ?? "0",
          requiresProtocol23Restore: false,
          balanceDiffs: [],
        };
      }
      let assembledXdr: string | undefined;
      if (networkPassphrase && body.result?.transactionData) {
        try {
          const parsedTx = TransactionBuilder.fromXDR(xdrBase64, networkPassphrase);
          assembledXdr = rpc.assembleTransaction(parsedTx, body.result as never).build().toXDR();
        } catch {
          assembledXdr = undefined;
        }
      }
      return {
        ok: true,
        minResourceFeeStroops: body.result?.minResourceFee ?? "0",
        requiresProtocol23Restore: Boolean(body.result?.restorePreamble),
        balanceDiffs: [],
        assembledXdr,
      };
    } catch {
      // Fail over to next RPC
    }
  }
  return {
    ok: false,
    error: "All Soroban RPC endpoints unavailable",
    minResourceFeeStroops: "0",
    requiresProtocol23Restore: false,
    balanceDiffs: [],
  };
}
