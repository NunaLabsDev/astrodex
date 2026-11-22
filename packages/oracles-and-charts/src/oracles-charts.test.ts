import { describe, expect, it } from "vitest";
import { createOraclesAndChartsEngine, mergeOhlcvCandles } from "./index.js";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("@astrodex/oracles-and-charts", () => {
  it("falls back cleanly from Chainlink/RumbleFish to Horizon USDC/XLM spot", async () => {
    const engine = createOraclesAndChartsEngine({
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrls: ["https://rpc.example.com"],
      horizonUrls: ["https://horizon.example.com"],
      usdcIssuer: USDC_ISSUER,
      fetchFn: async (url) => {
        if (url.includes("/order_book")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              bids: [{ price: "0.2400000" }],
              asks: [{ price: "0.2500000" }],
            }),
          };
        }
        return { ok: false, status: 503, json: async () => ({}) };
      },
    });

    const price = await engine.getXlmUsdPrice();
    expect(price.source).toBe("horizon_spot");
    expect(price.priceUsd).toBe(0.245);
  });

  it("merges D1 Soroban candles and Horizon trade_aggregations in ascending time order", async () => {
    const merged = mergeOhlcvCandles(
      [{ time: 2000, open: 1.1, high: 1.3, low: 1.0, close: 1.25, volume: 500 }],
      [
        { time: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 200 },
        { time: 2000, open: 1.0, high: 1.2, low: 1.0, close: 1.1, volume: 100 },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.time).toBe(1000);
    expect(merged[1]?.close).toBe(1.25);

    const engine = createOraclesAndChartsEngine({
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrls: ["https://rpc.example.com"],
      horizonUrls: ["https://horizon.example.com"],
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          _embedded: {
            records: [
              {
                timestamp: "1700000000000",
                open: "0.20",
                high: "0.22",
                low: "0.19",
                close: "0.21",
                base_volume: "1200",
              },
            ],
          },
        }),
      }),
    });

    const candles = await engine.getOhlcvCandles({
      pairId: `USDC:${USDC_ISSUER}`,
      baseAsset: `USDC:${USDC_ISSUER}`,
      quoteAsset: "XLM",
      timeframe: "1h",
    });
    expect(candles).toHaveLength(1);
    expect(candles[0]?.close).toBe(0.21);
  });
});
