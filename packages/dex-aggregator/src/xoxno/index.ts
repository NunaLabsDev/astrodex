import { formatStroops7, parseDecimalToStroops7, type RouteQuote } from "@astrodex/domain";
import { deriveContractIdForAsset, type AggregatorFetchLike } from "../soroswap/index.js";

/**
 * XOXNO Stellar DEX Aggregator (`GET /api/v1/quote`) across Soroswap, Aquarius,
 * Phoenix, Sushi, Comet, and Curve. Gracefully returns null when `xoxnoApiBase`
 * or `networkPassphrase` is unset.
 */
export async function quoteViaXoxno(input: {
  xoxnoApiBase?: string | undefined;
  networkPassphrase?: string | undefined;
  fromAsset: string;
  toAsset: string;
  amount: string;
  slippageBps: number;
  sourceAddress?: string | undefined;
  fetchFn: AggregatorFetchLike;
}): Promise<RouteQuote | null> {
  if (!input.xoxnoApiBase || !input.networkPassphrase) return null;
  const fromContract = deriveContractIdForAsset(input.fromAsset, input.networkPassphrase);
  const toContract = deriveContractIdForAsset(input.toAsset, input.networkPassphrase);
  const amountInStroops = parseDecimalToStroops7(input.amount);
  if (!fromContract || !toContract || amountInStroops === null || amountInStroops <= 0n) {
    return null;
  }

  const base = input.xoxnoApiBase.replace(/\/+$/, "");
  const clampedSlippage = Math.max(1, Math.min(5000, input.slippageBps)) / 10_000;
  const queryParts = [
    `from=${encodeURIComponent(fromContract)}`,
    `to=${encodeURIComponent(toContract)}`,
    `amount_in=${encodeURIComponent(amountInStroops.toString())}`,
    `slippage=${encodeURIComponent(clampedSlippage.toString())}`,
    "include_paths=true",
  ];
  if (input.sourceAddress && /^[GC][A-Z2-7]{55}$/.test(input.sourceAddress)) {
    queryParts.push(`sender=${encodeURIComponent(input.sourceAddress)}`);
    queryParts.push("simulate=true");
  }

  try {
    const res = await input.fetchFn(`${base}/api/v1/quote?${queryParts.join("&")}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      amountOut?: string;
      amountOutMin?: string;
      priceImpact?: number;
      hops?: Array<{ dex?: string; feeBps?: number }>;
      transaction?: string;
    };
    if (!json.amountOut || !/^\d+$/.test(json.amountOut)) return null;
    const outStroops = BigInt(json.amountOut);
    if (outStroops <= 0n) return null;

    const minOutStroops =
      json.amountOutMin && /^\d+$/.test(json.amountOutMin)
        ? BigInt(json.amountOutMin)
        : (outStroops * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) /
          10_000n;

    const totalFeeBps = (json.hops ?? []).reduce((sum, h) => sum + (h.feeBps ?? 0), 0);
    const impactPct =
      typeof json.priceImpact === "number" && Number.isFinite(json.priceImpact)
        ? (Math.abs(json.priceImpact) * 100).toFixed(2)
        : "0.00";

    return {
      venue: "xoxno_aggregator",
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
      inputAmount: input.amount,
      expectedOutputAmount: formatStroops7(outStroops),
      minOutputAmount: formatStroops7(minOutStroops),
      priceImpactPct: impactPct,
      feeBps: totalFeeBps > 0 ? totalFeeBps : 10,
      requiresTrustline: false,
      requiresSacBridgeForSmartAccount: false,
      pathAssets: [input.fromAsset, input.toAsset],
      ...(typeof json.transaction === "string" && json.transaction.length > 20
        ? { unsignedXdr: json.transaction }
        : {}),
    };
  } catch {
    return null;
  }
}
