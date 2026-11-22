import {
  formatStroops7,
  normalizeAssetIdentifier,
  parseDecimalToStroops7,
  type AccountKind,
  type LiquidityRouterPort,
  type LiquidityVenue,
  type MultiVenueQuoteResult,
  type RouteQuote,
  type StellarAddress,
} from "@astrodex/domain";
import {
  curveFeeBpsForOrder,
  localCurveQuoteBuy,
  localCurveQuoteSell,
} from "../astrogate-curve/curve-math.js";
import { quoteHorizonSdexPath } from "../sdex/index.js";
import {
  computeSoroswapAmountOut,
  quoteViaSoroswapProxy,
  type AggregatorFetchLike,
} from "../soroswap/index.js";
import { quoteViaXoxno } from "../xoxno/index.js";

export interface VerifiedTickerEntry {
  code: string;
  issuer?: string | undefined;
  contract?: string | undefined;
}

export interface SmartRouterConfig {
  horizonUrls: readonly string[];
  soroswapProxyQuoteUrl?: string | undefined;
  xoxnoApiBase?: string | undefined;
  verifiedAssets?: readonly VerifiedTickerEntry[] | undefined;
  curveStateLoader?:
    | ((tokenContractId: string) => Promise<{
        graduated: boolean;
        curveClosed: boolean;
        curveXlmNet: bigint;
        tokensSold: bigint;
      } | null>)
    | undefined;
  directPairReservesLoader?:
    | ((fromAsset: string, toAsset: string) => Promise<{
        pairId: string;
        reserveIn: bigint;
        reserveOut: bigint;
      } | null>)
    | undefined;
  fetchFn?: AggregatorFetchLike | undefined;
}

const PROTECTED_TICKERS = new Set([
  "XLM",
  "USDC",
  "EURC",
  "PYUSD",
  "AQUA",
  "BTC",
  "ETH",
  "USDT",
  "YUSDC",
  "YXLM",
]);

export type TokenTrustTier = "official" | "spoof_blocked" | "unverified";

export function classifyTokenTrust(
  assetIdentifier: string,
  verifiedAssets: readonly VerifiedTickerEntry[] = [],
): TokenTrustTier {
  const norm = normalizeAssetIdentifier(assetIdentifier);
  if (norm.kind === "native") return "official";

  const upperCode = norm.code.toUpperCase();
  if (norm.kind === "classic" && norm.issuer) {
    const matchesVerified = verifiedAssets.some(
      (v) =>
        v.code.toUpperCase() === upperCode &&
        v.issuer?.toUpperCase() === norm.issuer?.toUpperCase(),
    );
    if (matchesVerified) return "official";
    if (
      PROTECTED_TICKERS.has(upperCode) &&
      verifiedAssets.some((v) => v.code.toUpperCase() === upperCode)
    ) {
      return "spoof_blocked";
    }
  }
  if (norm.kind === "soroban" && norm.contractId) {
    const matchesVerified = verifiedAssets.some(
      (v) => v.contract?.toUpperCase() === norm.contractId?.toUpperCase(),
    );
    if (matchesVerified) return "official";
  }
  return "unverified";
}

function compareExpectedOutDesc(a: RouteQuote, b: RouteQuote): number {
  const aS = parseDecimalToStroops7(a.expectedOutputAmount) ?? 0n;
  const bS = parseDecimalToStroops7(b.expectedOutputAmount) ?? 0n;
  return aS > bS ? -1 : aS < bS ? 1 : 0;
}

/**
 * 5-Way Parallel Smart Liquidity Router enforcing 3-tier anti-spoof protection and
 * honest Classic (G...) vs Smart Account (C...) protocol compatibility.
 */
export function createSmartLiquidityRouter(config: SmartRouterConfig): LiquidityRouterPort {
  const fetchFn =
    config.fetchFn ?? ((globalThis as unknown as { fetch: AggregatorFetchLike }).fetch);

  return {
    async quoteBestRoutes(input: {
      fromAsset: string;
      toAsset: string;
      amount: string;
      slippageBps: number;
      sourceAddress?: StellarAddress | undefined;
      accountKind: AccountKind;
    }): Promise<MultiVenueQuoteResult> {
      const fromTier = classifyTokenTrust(input.fromAsset, config.verifiedAssets);
      const toTier = classifyTokenTrust(input.toAsset, config.verifiedAssets);
      if (fromTier === "spoof_blocked" || toTier === "spoof_blocked") {
        return {
          fromAsset: input.fromAsset,
          toAsset: input.toAsset,
          inputAmount: input.amount,
          accountKind: input.accountKind,
          bestRoute: null,
          routes: [],
          skippedVenues: [],
          blockedReason:
            "Blocked by Astro Shield: spoofed protected ticker issuer detected.",
        };
      }

      const amountStroops = parseDecimalToStroops7(input.amount);
      if (amountStroops === null || amountStroops <= 0n) {
        return {
          fromAsset: input.fromAsset,
          toAsset: input.toAsset,
          inputAmount: input.amount,
          accountKind: input.accountKind,
          bestRoute: null,
          routes: [],
          skippedVenues: [],
          blockedReason: "Invalid positive swap amount.",
        };
      }

      const skippedVenues: Array<{ venue: LiquidityVenue; reason: string }> = [];

      const fromNorm = normalizeAssetIdentifier(input.fromAsset);
      const toNorm = normalizeAssetIdentifier(input.toAsset);
      const isCurveBuy = fromNorm.kind === "native" && toNorm.kind === "soroban";
      const isCurveSell = fromNorm.kind === "soroban" && toNorm.kind === "native";

      const venuePromises: Array<Promise<RouteQuote | null>> = [
        // 1. AstroGate Fair-Flywheel v4.5 Bonding Curve
        (async () => {
          if (!config.curveStateLoader || (!isCurveBuy && !isCurveSell)) return null;
          const tokenId = isCurveBuy ? toNorm.contractId! : fromNorm.contractId!;
          const state = await config.curveStateLoader(tokenId);
          if (!state || state.graduated || state.curveClosed) return null;
          if (isCurveBuy) {
            const q = localCurveQuoteBuy(state.curveXlmNet, state.tokensSold, amountStroops);
            if (!q) return null;
            const minOut =
              (q.tokens_out * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) /
              10_000n;
            return {
              venue: "astrogate_curve",
              fromAsset: input.fromAsset,
              toAsset: input.toAsset,
              inputAmount: input.amount,
              expectedOutputAmount: formatStroops7(q.tokens_out),
              minOutputAmount: formatStroops7(minOut),
              priceImpactPct: "0.00",
              feeBps: Number(q.total_fee_bps),
              requiresTrustline: false,
              requiresSacBridgeForSmartAccount: false,
              pathAssets: [fromNorm.canonicalKey, toNorm.canonicalKey],
            } satisfies RouteQuote;
          }
          const q = localCurveQuoteSell(state.curveXlmNet, state.tokensSold, amountStroops);
          if (!q) return null;
          const minOut =
            (q.net_xlm_out * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) /
            10_000n;
          void curveFeeBpsForOrder;
          return {
            venue: "astrogate_curve",
            fromAsset: input.fromAsset,
            toAsset: input.toAsset,
            inputAmount: input.amount,
            expectedOutputAmount: formatStroops7(q.net_xlm_out),
            minOutputAmount: formatStroops7(minOut),
            priceImpactPct: "0.00",
            feeBps: Number(q.total_fee_bps),
            requiresTrustline: false,
            requiresSacBridgeForSmartAccount: false,
            pathAssets: [fromNorm.canonicalKey, toNorm.canonicalKey],
          } satisfies RouteQuote;
        })(),

        // 2. Worker-Proxied Soroswap Aggregator
        quoteViaSoroswapProxy({
          proxyQuoteUrl: config.soroswapProxyQuoteUrl,
          fromAsset: input.fromAsset,
          toAsset: input.toAsset,
          amount: input.amount,
          slippageBps: input.slippageBps,
          sourceAddress: input.sourceAddress,
          fetchFn,
        }),

        // 3. Optional XOXNO Swap Aggregator
        quoteViaXoxno({
          xoxnoApiBase: config.xoxnoApiBase,
          fromAsset: input.fromAsset,
          toAsset: input.toAsset,
          amount: input.amount,
          slippageBps: input.slippageBps,
          fetchFn,
        }),

        // 4. Direct On-Chain Soroswap Pair / Router
        (async () => {
          if (!config.directPairReservesLoader) return null;
          const pair = await config.directPairReservesLoader(input.fromAsset, input.toAsset);
          if (!pair) return null;
          const out = computeSoroswapAmountOut(amountStroops, pair.reserveIn, pair.reserveOut);
          if (out <= 0n) return null;
          const minOut =
            (out * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) / 10_000n;
          return {
            venue: "soroswap_direct",
            fromAsset: input.fromAsset,
            toAsset: input.toAsset,
            inputAmount: input.amount,
            expectedOutputAmount: formatStroops7(out),
            minOutputAmount: formatStroops7(minOut),
            priceImpactPct: "0.30",
            feeBps: 30,
            requiresTrustline: false,
            requiresSacBridgeForSmartAccount: false,
            pathAssets: [fromNorm.canonicalKey, toNorm.canonicalKey],
            pairId: pair.pairId,
          } satisfies RouteQuote;
        })(),

        // 5. Classic SDEX Horizon Paths + Orderbook Walk (G... only)
        (async () => {
          if (input.accountKind === "smart") {
            skippedVenues.push({
              venue: "sdex_horizon",
              reason: "Classic SDEX orderbook requires a G... account (use 1-tap SAC bridge)",
            });
            return null;
          }
          return quoteHorizonSdexPath({
            horizonUrls: config.horizonUrls,
            fromAsset: input.fromAsset,
            toAsset: input.toAsset,
            amount: input.amount,
            slippageBps: input.slippageBps,
            fetchFn,
          });
        })(),
      ];

      if (!config.xoxnoApiBase) {
        skippedVenues.push({
          venue: "xoxno_aggregator",
          reason: "XOXNO_SWAP_API_BASE not configured for this network",
        });
      }

      const settled = await Promise.allSettled(venuePromises);
      const routes: RouteQuote[] = [];
      for (const item of settled) {
        if (item.status === "fulfilled" && item.value) {
          routes.push(item.value);
        }
      }
      routes.sort(compareExpectedOutDesc);

      return {
        fromAsset: input.fromAsset,
        toAsset: input.toAsset,
        inputAmount: input.amount,
        accountKind: input.accountKind,
        bestRoute: routes[0] ?? null,
        routes,
        skippedVenues,
      };
    },
  };
}
