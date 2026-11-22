import { formatStroops7, parseDecimalToStroops7, type RouteQuote } from "@astrodex/domain";
import type { AggregatorFetchLike } from "../soroswap/index.js";

/**
 * Optional XOXNO Swap Aggregator adapter. Gracefully returns null when `xoxnoApiBase`
 * is unset (e.g., on Stellar Testnet) so routing proceeds without blocking.
 */
export async function quoteViaXoxno(input: {
  xoxnoApiBase?: string | undefined;
  fromAsset: string;
  toAsset: string;
  amount: string;
  slippageBps: number;
  fetchFn: AggregatorFetchLike;
}): Promise<RouteQuote | null> {
  if (!input.xoxnoApiBase) return null;
  const base = input.xoxnoApiBase.replace(/\/+$/, "");
  try {
    const res = await input.fetchFn(`${base}/v1/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sellToken: input.fromAsset,
        buyToken: input.toAsset,
        sellAmount: input.amount,
        slippageBps: input.slippageBps,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      expectedOutputAmount?: string;
      priceImpactPct?: string;
      pathAssets?: string[];
      unsignedXdr?: string;
    };
    if (!json.expectedOutputAmount) return null;
    const outStroops = parseDecimalToStroops7(json.expectedOutputAmount);
    if (outStroops === null || outStroops <= 0n) return null;
    const minOut =
      (outStroops * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) / 10_000n;

    return {
      venue: "xoxno_aggregator",
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
      inputAmount: input.amount,
      expectedOutputAmount: json.expectedOutputAmount,
      minOutputAmount: formatStroops7(minOut),
      priceImpactPct: json.priceImpactPct ?? "0.30",
      feeBps: 30,
      requiresTrustline: false,
      requiresSacBridgeForSmartAccount: false,
      pathAssets: json.pathAssets ?? [input.fromAsset, input.toAsset],
      unsignedXdr: json.unsignedXdr,
    };
  } catch {
    return null;
  }
}
