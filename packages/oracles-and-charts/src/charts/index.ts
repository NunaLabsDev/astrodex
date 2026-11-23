import {
  normalizeAssetIdentifier,
  type OhlcvCandle,
  type OhlcvTimeframe,
} from "@astrodex/domain";
import type { OracleFetchLike } from "../oracles/index.js";

const TIMEFRAME_MS: Record<OhlcvTimeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

interface RawOhlcvCandle extends OhlcvCandle {
  avg?: number | undefined;
}

function medianOf(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function rollupOhlcvCandles(
  candles: readonly RawOhlcvCandle[],
  bucketSec: number,
): RawOhlcvCandle[] {
  if (candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, RawOhlcvCandle & { weightedSum: number; weightVol: number }>();

  for (const c of sorted) {
    const bucketTime = Math.floor(c.time / bucketSec) * bucketSec;
    const prev = buckets.get(bucketTime);
    const weight = c.volume > 0 ? c.volume : 0;
    const avgPrice = c.avg && c.avg > 0 ? c.avg : c.close;
    if (!prev) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        avg: avgPrice,
        weightedSum: avgPrice * weight,
        weightVol: weight,
      });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += c.volume;
      prev.weightedSum += avgPrice * weight;
      prev.weightVol += weight;
      prev.avg = prev.weightVol > 0 ? prev.weightedSum / prev.weightVol : prev.close;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.time - b.time)
    .map(({ time, open, high, low, close, volume, avg }) => ({
      time,
      open,
      high,
      low,
      close,
      volume,
      ...(avg !== undefined ? { avg } : {}),
    }));
}

function percentile75(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))]!;
}

/**
 * Two-tier Stellar SDEX/AMM OHLCV sanitizer:
 * 1) Snaps dust-corrupted open/close prices (>12% away from Horizon VWAP `avg`) back to `avg`.
 * 2) Leaves normal wicks untouched while reconstructing unmistakably corrupted SDEX dust wicks
 *    to a realistic 75th-percentile candle wick ratio (instead of leaving 15% hair-comb spikes).
 */
export function sanitizeOhlcvCandles(
  candles: readonly RawOhlcvCandle[],
  opts?: { maxWickFloorPct?: number },
): OhlcvCandle[] {
  if (candles.length === 0) return [];
  const deduped = new Map<number, RawOhlcvCandle>();
  for (const c of candles) {
    if (Number.isFinite(c.time) && c.time > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0) {
      deduped.set(c.time, c);
    }
  }
  const sorted = Array.from(deduped.values()).sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return [];

  const allAnchors = sorted.map((c) => (c.avg && c.avg > 0 ? c.avg : c.close));
  const seriesMedian = medianOf(allAnchors);
  const medianVol = medianOf(sorted.map((c) => c.volume).filter((v) => v > 0));

  const bodyCleaned = sorted.map((c, idx) => {
    const start = Math.max(0, idx - 3);
    const end = Math.min(sorted.length, idx + 4);
    const windowAnchors = allAnchors.slice(start, end);
    const localMed = windowAnchors.length >= 3 ? medianOf(windowAnchors) : seriesMedian;

    let open = c.open;
    let close = c.close;
    let high = c.high;
    let low = c.low;

    const avgValid =
      c.avg !== undefined && c.avg > 0 && localMed > 0 && c.avg >= 0.55 * localMed && c.avg <= 1.8 * localMed;
    if (avgValid && c.avg !== undefined) {
      if (Math.abs(open - c.avg) / c.avg > 0.08) open = c.avg;
      if (Math.abs(close - c.avg) / c.avg > 0.08) close = c.avg;
    }

    // Isolated 1-2 bar spike guard (regardless of volume) using immediate neighbors
    const neighborVals: number[] = [];
    for (let nIdx = Math.max(0, idx - 2); nIdx <= Math.min(sorted.length - 1, idx + 2); nIdx++) {
      if (nIdx !== idx) {
        neighborVals.push(allAnchors[nIdx]!);
      }
    }
    const neighborMed = neighborVals.length >= 2 ? medianOf(neighborVals) : localMed;

    if (
      neighborMed > 0 &&
      (close > 1.55 * neighborMed ||
        close < neighborMed / 1.55 ||
        open > 1.55 * neighborMed ||
        open < neighborMed / 1.55)
    ) {
      open = neighborMed;
      close = neighborMed;
      high = neighborMed;
      low = neighborMed;
    } else if (
      localMed > 0 &&
      medianVol > 0 &&
      c.volume < 0.05 * medianVol &&
      (close > 3.5 * localMed || close < localMed / 3.5)
    ) {
      open = localMed;
      close = localMed;
      high = localMed;
      low = localMed;
    }

    return { time: c.time, open, high, low, close, volume: c.volume };
  });

  const cleanUpWicks = bodyCleaned
    .map((c) => {
      const bm = Math.max(c.open, c.close);
      return bm > 0 ? (c.high - bm) / bm : 0;
    })
    .filter((w) => w >= 0 && w < 0.08);
  const cleanDnWicks = bodyCleaned
    .map((c) => {
      const bm = Math.min(c.open, c.close);
      return bm > 0 ? (bm - c.low) / bm : 0;
    })
    .filter((w) => w >= 0 && w < 0.08);

  const p75Up = Math.max(0.012, Math.min(0.04, percentile75(cleanUpWicks) || 0.022));
  const p75Dn = Math.max(0.012, Math.min(0.04, percentile75(cleanDnWicks) || 0.022));

  const floorCap = opts?.maxWickFloorPct && opts.maxWickFloorPct > 0.12 ? 0.06 : 0.035;
  const upThreshold = Math.min(0.08, Math.max(0.045, p75Up * 2.5));
  const dnThreshold = Math.min(0.08, Math.max(0.045, p75Dn * 2.5));
  const upReconstruct = Math.min(floorCap, p75Up * 1.25);
  const dnReconstruct = Math.min(floorCap, p75Dn * 1.25);

  return bodyCleaned.map((c) => {
    const bodyMax = Math.max(c.open, c.close);
    const bodyMin = Math.min(c.open, c.close);
    const rawUp = bodyMax > 0 ? (c.high - bodyMax) / bodyMax : 0;
    const rawDn = bodyMin > 0 ? (bodyMin - c.low) / bodyMin : 0;

    const high = Math.max(
      bodyMax,
      rawUp > upThreshold ? bodyMax * (1 + upReconstruct) : c.high,
    );
    const low = Math.min(
      bodyMin,
      rawDn > dnThreshold ? bodyMin / (1 + dnReconstruct) : c.low,
    );

    return {
      time: c.time,
      open: c.open,
      high,
      low,
      close: c.close,
      volume: c.volume,
    };
  });
}

function assetParams(prefix: string, identifier: string): Record<string, string> {
  const norm = normalizeAssetIdentifier(identifier);
  if (norm.kind === "native") return { [`${prefix}_asset_type`]: "native" };
  if (norm.kind === "classic" && norm.issuer) {
    return {
      [`${prefix}_asset_type`]: norm.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
      [`${prefix}_asset_code`]: norm.code,
      [`${prefix}_asset_issuer`]: norm.issuer,
    };
  }
  throw new Error("Classic Horizon aggregations require XLM or CODE:G...");
}

/**
 * Merges and deduplicates OHLCV candles from Cloudflare D1 Soroban index and Horizon
 * `/trade_aggregations` -> `/trades` -> `/order_book` fallback, sorted ascending by timestamp.
 */
export function mergeOhlcvCandles(
  primary: readonly OhlcvCandle[],
  secondary: readonly OhlcvCandle[],
  limit = 200,
): OhlcvCandle[] {
  const map = new Map<number, OhlcvCandle>();
  for (const c of secondary) {
    map.set(c.time, c);
  }
  for (const c of primary) {
    map.set(c.time, c);
  }
  return sanitizeOhlcvCandles(Array.from(map.values())).slice(-Math.max(1, limit));
}

const MAINNET_USDC_KEY = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

async function fetchKrakenXlmUsdDailyCandles(
  fetchFn: OracleFetchLike,
  invert: boolean,
  limit: number,
): Promise<OhlcvCandle[] | null> {
  try {
    const res = await fetchFn("https://api.kraken.com/0/public/OHLC?pair=XLMUSD&interval=1440", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      error?: string[];
      result?: Record<string, Array<[number, string, string, string, string, string, string, number]>>;
    };
    if (json.error && json.error.length > 0) return null;
    const rows = json.result?.XXLMZUSD ?? json.result?.XLMUSD;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const candles: OhlcvCandle[] = [];
    for (const row of rows.slice(-limit)) {
      const time = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[6]);
      if (!Number.isFinite(time) || open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
      if (invert) {
        candles.push({
          time,
          open: 1 / open,
          high: 1 / low,
          low: 1 / high,
          close: 1 / close,
          volume: Number.isFinite(volume) ? volume * close : 0,
        });
      } else {
        candles.push({
          time,
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : 0,
        });
      }
    }
    return candles.length > 0 ? candles : null;
  } catch {
    return null;
  }
}

export async function fetchHorizonOhlcvCandles(input: {
  horizonUrls: readonly string[];
  baseAsset: string;
  quoteAsset: string;
  timeframe: OhlcvTimeframe;
  limit?: number | undefined;
  fetchFn: OracleFetchLike;
}): Promise<OhlcvCandle[]> {
  const baseUpper = input.baseAsset.trim().toUpperCase();
  const quoteUpper = input.quoteAsset.trim().toUpperCase();
  const isMainnetHorizon = input.horizonUrls.some(
    (u) => !u.includes("testnet") && u.includes("horizon.stellar.org"),
  );
  if (input.timeframe === "1d" && isMainnetHorizon) {
    const isXlmUsdc = baseUpper === "XLM" && quoteUpper === MAINNET_USDC_KEY;
    const isUsdcXlm = baseUpper === MAINNET_USDC_KEY && quoteUpper === "XLM";
    if (isXlmUsdc || isUsdcXlm) {
      const krakenCandles = await fetchKrakenXlmUsdDailyCandles(
        input.fetchFn,
        isUsdcXlm,
        Math.max(10, Math.min(200, input.limit ?? 120)),
      );
      if (krakenCandles) return krakenCandles;
    }
  }

  let baseParams: Record<string, string>;
  let counterParams: Record<string, string>;
  try {
    baseParams = assetParams("base", input.baseAsset);
    counterParams = assetParams("counter", input.quoteAsset);
  } catch {
    return [];
  }

  const isFourHour = input.timeframe === "4h";
  // Horizon /trade_aggregations rejects 14_400_000 (4h); query 1h and roll up in JS.
  const resolution = isFourHour ? 3_600_000 : TIMEFRAME_MS[input.timeframe];
  const targetCount = Math.max(10, Math.min(200, input.limit ?? 120));
  const fetchCount = isFourHour ? Math.min(200, targetCount * 4) : targetCount;
  const endTime = Date.now();
  const startTime = endTime - resolution * fetchCount;

  const qs = Object.entries({
    ...baseParams,
    ...counterParams,
    resolution: String(resolution),
    start_time: String(startTime),
    end_time: String(endTime),
    limit: String(fetchCount),
    order: "asc",
  })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  for (const base of input.horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await input.fetchFn(`${clean}/trade_aggregations?${qs}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        _embedded?: {
          records?: Array<{
            timestamp?: string;
            open?: string;
            high?: string;
            low?: string;
            close?: string;
            avg?: string;
            base_volume?: string;
          }>;
        };
      };
      const records = body._embedded?.records ?? [];
      if (records.length > 0) {
        const raw = records
          .map((r): RawOhlcvCandle => ({
            time: Math.floor(Number(r.timestamp ?? "0") / 1000),
            open: Number(r.open ?? "0"),
            high: Number(r.high ?? "0"),
            low: Number(r.low ?? "0"),
            close: Number(r.close ?? "0"),
            avg: Number(r.avg ?? "0") || undefined,
            volume: Number(r.base_volume ?? "0"),
          }))
          .filter((c) => c.time > 0 && Number.isFinite(c.close) && c.close > 0);
        const rolled = isFourHour ? rollupOhlcvCandles(raw, 14_400) : raw;
        return sanitizeOhlcvCandles(rolled, {
          maxWickFloorPct: input.timeframe === "1d" ? 0.15 : 0.08,
        }).slice(-targetCount);
      }
    } catch {
      // Fall through cleanly
    }
  }

  return [];
}

export async function fetchGeckoTerminalStellarOhlcv(input: {
  baseAsset: string;
  timeframe: OhlcvTimeframe;
  limit?: number | undefined;
  fetchFn: OracleFetchLike;
}): Promise<OhlcvCandle[]> {
  const gtMap: Record<OhlcvTimeframe, { tf: string; agg: number }> = {
    "1m": { tf: "minute", agg: 1 },
    "5m": { tf: "minute", agg: 5 },
    "15m": { tf: "minute", agg: 15 },
    "1h": { tf: "hour", agg: 1 },
    "4h": { tf: "hour", agg: 4 },
    "1d": { tf: "day", agg: 1 },
  };
  const cfg = gtMap[input.timeframe] ?? { tf: "hour", agg: 1 };
  const limit = Math.max(10, Math.min(200, input.limit ?? 120));
  const tokenId = input.baseAsset.trim();
  if (!tokenId) return [];

  try {
    const poolsRes = await input.fetchFn(
      `https://api.geckoterminal.com/api/v2/networks/stellar/tokens/${encodeURIComponent(tokenId)}/pools?page=1`,
      { headers: { Accept: "application/json" } },
    );
    if (!poolsRes.ok) return [];
    const poolsJson = (await poolsRes.json()) as {
      data?: Array<{ attributes?: { address?: string } }>;
    };
    const poolAddress = poolsJson.data?.[0]?.attributes?.address;
    if (!poolAddress) return [];

    const ohlcvRes = await input.fetchFn(
      `https://api.geckoterminal.com/api/v2/networks/stellar/pools/${encodeURIComponent(poolAddress)}/ohlcv/${cfg.tf}?aggregate=${cfg.agg}&limit=${limit}`,
      { headers: { Accept: "application/json" } },
    );
    if (!ohlcvRes.ok) return [];
    const ohlcvJson = (await ohlcvRes.json()) as {
      data?: {
        attributes?: {
          ohlcv_list?: Array<[number, number, number, number, number, number]>;
        };
      };
    };
    const rows = ohlcvJson.data?.attributes?.ohlcv_list ?? [];
    if (rows.length === 0) return [];
    const raw: RawOhlcvCandle[] = rows
      .map(([tsSec, o, h, l, c, vol]) => ({
        time: Math.floor(Number(tsSec)),
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c),
        volume: Number(vol) || 0,
      }))
      .filter((c) => c.time > 0 && Number.isFinite(c.close) && c.close > 0);
    return sanitizeOhlcvCandles(raw, {
      maxWickFloorPct: input.timeframe === "1d" ? 0.15 : 0.08,
    }).slice(-limit);
  } catch {
    return [];
  }
}
