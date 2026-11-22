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
  return Array.from(map.values())
    .sort((a, b) => a.time - b.time)
    .slice(-Math.max(1, limit));
}

export async function fetchHorizonOhlcvCandles(input: {
  horizonUrls: readonly string[];
  baseAsset: string;
  quoteAsset: string;
  timeframe: OhlcvTimeframe;
  limit?: number | undefined;
  fetchFn: OracleFetchLike;
}): Promise<OhlcvCandle[]> {
  let baseParams: Record<string, string>;
  let counterParams: Record<string, string>;
  try {
    baseParams = assetParams("base", input.baseAsset);
    counterParams = assetParams("counter", input.quoteAsset);
  } catch {
    return [];
  }

  const resolution = TIMEFRAME_MS[input.timeframe];
  const count = Math.max(10, Math.min(200, input.limit ?? 120));
  const endTime = Date.now();
  const startTime = endTime - resolution * count;

  const qs = Object.entries({
    ...baseParams,
    ...counterParams,
    resolution: String(resolution),
    start_time: String(startTime),
    end_time: String(endTime),
    limit: String(count),
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
            base_volume?: string;
          }>;
        };
      };
      const records = body._embedded?.records ?? [];
      if (records.length > 0) {
        return records
          .map((r) => ({
            time: Math.floor(Number(r.timestamp ?? "0") / 1000),
            open: Number(r.open ?? "0"),
            high: Number(r.high ?? "0"),
            low: Number(r.low ?? "0"),
            close: Number(r.close ?? "0"),
            volume: Number(r.base_volume ?? "0"),
          }))
          .filter((c) => c.time > 0 && Number.isFinite(c.close) && c.close > 0);
      }
    } catch {
      // Fall through cleanly
    }
  }

  return [];
}
