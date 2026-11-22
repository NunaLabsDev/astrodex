import { formatStroops7, parseDecimalToStroops7, type RouteQuote } from "@astrodex/domain";
import { Account, Address, Contract, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";

export interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type AggregatorFetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  },
) => Promise<MinimalFetchResponse>;

/**
 * Constant-product 30 bps Soroswap AMM formula matching Soroswap Router `router_get_amount_out`.
 * Never uses `router_get_amounts_out`.
 */
export function computeSoroswapAmountOut(
  amountInStroops: bigint,
  reserveInStroops: bigint,
  reserveOutStroops: bigint,
): bigint {
  if (amountInStroops <= 0n || reserveInStroops <= 0n || reserveOutStroops <= 0n) {
    return 0n;
  }
  const amountInWithFee = amountInStroops * 997n;
  const numerator = amountInWithFee * reserveOutStroops;
  const denominator = reserveInStroops * 1000n + amountInWithFee;
  return denominator > 0n ? numerator / denominator : 0n;
}

/**
 * Builds an unsigned direct Soroswap Router `swap_exact_tokens_for_tokens` transaction XDR.
 */
export function buildSoroswapRouterSwapXdr(input: {
  sourceAddress: string;
  routerContractId: string;
  amountInStroops: bigint;
  amountOutMinStroops: bigint;
  pathContracts: readonly string[];
  deadlineUnix: number;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const contract = new Contract(input.routerContractId);
  const pathVal = xdr.ScVal.scvVec(
    input.pathContracts.map((id) => new Address(id).toScVal()),
  );
  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "swap_exact_tokens_for_tokens",
        nativeToScVal(input.amountInStroops, { type: "i128" }),
        nativeToScVal(input.amountOutMinStroops, { type: "i128" }),
        pathVal,
        new Address(input.sourceAddress).toScVal(),
        nativeToScVal(BigInt(input.deadlineUnix), { type: "u64" }),
      ),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export async function quoteViaSoroswapProxy(input: {
  proxyQuoteUrl?: string | undefined;
  fromAsset: string;
  toAsset: string;
  amount: string;
  slippageBps: number;
  sourceAddress?: string | undefined;
  fetchFn: AggregatorFetchLike;
}): Promise<RouteQuote | null> {
  if (!input.proxyQuoteUrl) return null;
  const res = await input.fetchFn(input.proxyQuoteUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
      amount: input.amount,
      slippageBps: input.slippageBps,
      sourceAddress: input.sourceAddress,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    expectedOutputAmount?: string;
    minOutputAmount?: string;
    priceImpactPct?: string;
    feeBps?: number;
    pathAssets?: string[];
    unsignedXdr?: string;
    pairId?: string;
  };
  if (!body.expectedOutputAmount) return null;
  const outStroops = parseDecimalToStroops7(body.expectedOutputAmount);
  if (outStroops === null || outStroops <= 0n) return null;
  const minOutStroops =
    (outStroops * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) / 10_000n;

  return {
    venue: "soroswap_aggregator",
    fromAsset: input.fromAsset,
    toAsset: input.toAsset,
    inputAmount: input.amount,
    expectedOutputAmount: body.expectedOutputAmount,
    minOutputAmount: body.minOutputAmount ?? formatStroops7(minOutStroops),
    priceImpactPct: body.priceImpactPct ?? "0.30",
    feeBps: body.feeBps ?? 30,
    requiresTrustline: false,
    requiresSacBridgeForSmartAccount: false,
    pathAssets: body.pathAssets ?? [input.fromAsset, input.toAsset],
    pairId: body.pairId,
    unsignedXdr: body.unsignedXdr,
  };
}
