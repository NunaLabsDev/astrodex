import type {
  OhlcvCandle,
  OhlcvTimeframe,
  OraclePort,
  OraclePriceQuote,
} from "@astrodex/domain";
import {
  fetchGeckoTerminalStellarOhlcv,
  fetchHorizonOhlcvCandles,
  mergeOhlcvCandles,
} from "./charts/index.js";
import {
  fetchChainlinkXlmUsd,
  fetchHorizonUsdcSpotXlmUsd,
  fetchReflectorSep40Price,
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
  xlmSacContractId?: string | undefined;
  stellarPricesApiBase?: string | undefined;
  stellarPricesApiKey?: string | undefined;
  usdcIssuer?: string | undefined;
  fallbackContractId?: string | undefined;
  sorobanCandlesLoader?:
    | ((pairId: string, timeframe: OhlcvTimeframe, limit: number) => Promise<OhlcvCandle[]>)
    | undefined;
  spotMidPriceLoader?: (() => Promise<number | null>) | undefined;
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

      const reflector = await fetchReflectorSep40Price({
        rpcUrls: config.rpcUrls,
        reflectorOracleContractId: config.reflectorDexOracleContractId,
        tokenContractId: config.xlmSacContractId,
        assetKey: "XLM",
        networkPassphrase: config.networkPassphrase,
        fetchFn,
      });
      if (reflector) return reflector;

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
      if (/^C[A-Z2-7]{55}$/.test(assetKey) && config.reflectorDexOracleContractId) {
        const reflector = await fetchReflectorSep40Price({
          rpcUrls: config.rpcUrls,
          reflectorOracleContractId: config.reflectorDexOracleContractId,
          tokenContractId: assetKey,
          assetKey,
          networkPassphrase: config.networkPassphrase,
          fetchFn,
        });
        if (reflector) return reflector;
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
      const [d1Candles, horizonCandles, spotPrice] = await Promise.all([
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
        config.spotMidPriceLoader
          ? config.spotMidPriceLoader().catch(() => null)
          : Promise.resolve(null),
      ]);
      const merged = mergeOhlcvCandles(d1Candles, horizonCandles, limit);
      const isMainnet = !config.horizonUrls.some((u) => u.includes("testnet"));
      if (merged.length >= 6 && !/^C[A-Z2-7]{55}$/.test(input.baseAsset)) {
        return merged;
      }
      if (isMainnet) {
        const gtTokenId = config.fallbackContractId ?? input.baseAsset;
        const gtCandles = await fetchGeckoTerminalStellarOhlcv({
          baseAsset: gtTokenId,
          timeframe: input.timeframe,
          limit,
          fetchFn,
        });
        if (gtCandles.length > 0) return gtCandles;
      }
      if (merged.length > 0) return merged;
      if (spotPrice !== null && Number.isFinite(spotPrice) && spotPrice > 0) {
        const stepSeconds: Record<OhlcvTimeframe, number> = {
          "1m": 60,
          "5m": 300,
          "15m": 900,
          "1h": 3600,
          "4h": 14400,
          "1d": 86400,
        };
        const step = stepSeconds[input.timeframe] ?? 3600;
        const nowBucket = Math.floor(Date.now() / 1000 / step) * step;
        const series: OhlcvCandle[] = [];
        const points = 24;
        for (let i = points - 1; i >= 0; i -= 1) {
          series.push({
            time: nowBucket - i * step,
            open: spotPrice,
            high: spotPrice,
            low: spotPrice,
            close: spotPrice,
            volume: 0,
          });
        }
        return series;
      }
      return [];
    },
  };
}
