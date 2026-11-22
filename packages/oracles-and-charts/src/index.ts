import type {
  OhlcvCandle,
  OhlcvTimeframe,
  OraclePort,
  OraclePriceQuote,
} from "@astrodex/domain";
import { fetchHorizonOhlcvCandles, mergeOhlcvCandles } from "./charts/index.js";
import {
  fetchChainlinkXlmUsd,
  fetchHorizonUsdcSpotXlmUsd,
  fetchRumbleFishVwapPrice,
  type OracleFetchLike,
} from "./oracles/index.js";

export * from "./charts/index.js";
export * from "./oracles/index.js";

export interface OraclesAndChartsConfig {
  networkPassphrase: string;
  rpcUrls: readonly string[];
  horizonUrls: readonly string[];
  chainlinkPriceProxyContractId?: string | undefined;
  reflectorDexOracleContractId?: string | undefined;
  stellarPricesApiBase?: string | undefined;
  stellarPricesApiKey?: string | undefined;
  usdcIssuer?: string | undefined;
  sorobanCandlesLoader?:
    | ((pairId: string, timeframe: OhlcvTimeframe, limit: number) => Promise<OhlcvCandle[]>)
    | undefined;
  cexXlmUsdFetcher?: (() => Promise<number | null>) | undefined;
  fetchFn?: OracleFetchLike | undefined;
}

export function createOraclesAndChartsEngine(config: OraclesAndChartsConfig): OraclePort {
  const fetchFn =
    config.fetchFn ?? ((globalThis as unknown as { fetch: OracleFetchLike }).fetch);

  return {
    async getXlmUsdPrice(): Promise<OraclePriceQuote> {
      const chainlink = await fetchChainlinkXlmUsd({
        rpcUrls: config.rpcUrls,
        chainlinkProxyContractId: config.chainlinkPriceProxyContractId,
        networkPassphrase: config.networkPassphrase,
        fetchFn,
      });
      if (chainlink) return chainlink;

      const rumble = await fetchRumbleFishVwapPrice({
        stellarPricesApiBase: config.stellarPricesApiBase,
        stellarPricesApiKey: config.stellarPricesApiKey,
        assetKey: "XLM",
        fetchFn,
      });
      if (rumble) return rumble;

      const horizonSpot = await fetchHorizonUsdcSpotXlmUsd({
        horizonUrls: config.horizonUrls,
        usdcIssuer: config.usdcIssuer,
        fetchFn,
      });
      if (horizonSpot) return horizonSpot;

      if (config.cexXlmUsdFetcher) {
        const cexPrice = await config.cexXlmUsdFetcher().catch(() => null);
        if (cexPrice && cexPrice > 0) {
          return {
            assetKey: "XLM",
            priceUsd: cexPrice,
            source: "cex_fallback",
            updatedAtUnix: Math.floor(Date.now() / 1000),
          };
        }
      }

      return {
        assetKey: "XLM",
        priceUsd: 0,
        source: "cex_fallback",
        updatedAtUnix: Math.floor(Date.now() / 1000),
      };
    },

    async getAssetUsdPrice(assetKey: string): Promise<OraclePriceQuote | null> {
      if (assetKey.toUpperCase() === "XLM") {
        return this.getXlmUsdPrice();
      }
      return fetchRumbleFishVwapPrice({
        stellarPricesApiBase: config.stellarPricesApiBase,
        stellarPricesApiKey: config.stellarPricesApiKey,
        assetKey,
        fetchFn,
      });
    },

    async getOhlcvCandles(input: {
      pairId: string;
      baseAsset: string;
      quoteAsset: string;
      timeframe: OhlcvTimeframe;
      limit?: number | undefined;
    }): Promise<readonly OhlcvCandle[]> {
      const limit = input.limit ?? 120;
      const [d1Candles, horizonCandles] = await Promise.all([
        config.sorobanCandlesLoader
          ? config.sorobanCandlesLoader(input.pairId, input.timeframe, limit).catch(() => [])
          : Promise.resolve([]),
        fetchHorizonOhlcvCandles({
          horizonUrls: config.horizonUrls,
          baseAsset: input.baseAsset,
          quoteAsset: input.quoteAsset,
          timeframe: input.timeframe,
          limit,
          fetchFn,
        }),
      ]);
      return mergeOhlcvCandles(d1Candles, horizonCandles, limit);
    },
  };
}
