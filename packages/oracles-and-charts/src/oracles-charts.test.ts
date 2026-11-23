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

  it("queries Horizon 1h for 4h timeframe rollup and clamps dust outlier wicks", async () => {
    const requestedUrls: string[] = [];
    const engine = createOraclesAndChartsEngine({
      networkPassphrase: "Test SDF Network ; September 2015",
      rpcUrls: ["https://rpc.example.com"],
      horizonUrls: ["https://horizon-testnet.stellar.org"],
      fetchFn: async (url) => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            _embedded: {
              records: [
                {
                  timestamp: "1700006400000",
                  open: "0.150",
                  high: "1.000",
                  low: "0.148",
                  close: "0.152",
                  avg: "0.151",
                  base_volume: "5000",
                },
                {
                  timestamp: "1700010000000",
                  open: "0.152",
                  high: "0.155",
                  low: "0.149",
                  close: "0.154",
                  avg: "0.153",
                  base_volume: "6000",
                },
                {
                  timestamp: "1700013600000",
                  open: "0.154",
                  high: "0.156",
                  low: "0.150",
                  close: "0.153",
                  avg: "0.153",
                  base_volume: "4500",
                },
                {
                  timestamp: "1700017200000",
                  open: "0.153",
                  high: "0.157",
                  low: "0.151",
                  close: "0.155",
                  avg: "0.154",
                  base_volume: "5500",
                },
              ],
            },
          }),
        };
      },
    });

    const candles = await engine.getOhlcvCandles({
      pairId: `USDC:${USDC_ISSUER}`,
      baseAsset: `USDC:${USDC_ISSUER}`,
      quoteAsset: "XLM",
      timeframe: "4h",
      limit: 20,
    });
    expect(requestedUrls[0]).toContain("resolution=3600000");
    expect(requestedUrls[0]).not.toContain("resolution=14400000");
    expect(candles).toHaveLength(1);
    expect(candles[0]?.high).toBeLessThan(0.17);
  });

  it("decodes RedStone SEP-40 14-decimal price feeds for USDe", async () => {
    const { xdr } = await import("@stellar/stellar-sdk");
    const { fetchRedStoneSep40Price } = await import("./oracles/index.js");

    const priceVal = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("price"),
        val: xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            hi: xdr.Int64.fromString("0"),
            lo: xdr.Uint64.fromString("100050000000000"),
          }),
        ),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("timestamp"),
        val: xdr.ScVal.scvU64(xdr.Uint64.fromString("1763900000")),
      }),
    ]);

    const quote = await fetchRedStoneSep40Price({
      rpcUrls: ["https://mainnet.sorobanrpc.com"],
      redstoneOracleContractId: "CBMGLKUQZVSAIL5CPDDAWSUY7MAKXISHMOZEVLMBUWBMFGHRJSR4WYRF",
      tokenContractId: "CCNOV6XVI2O5BSTA3232GIRUQULDEBV7IWGKM6QKI6II5OIIQTU24JJN",
      assetCode: "USDE",
      assetKey: "USDE:GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          result: { results: [{ xdr: priceVal.toXDR("base64") }] },
        }),
      }),
    });

    expect(quote).not.toBeNull();
    expect(quote?.source).toBe("redstone");
    expect(quote?.priceUsd).toBeCloseTo(1.0005, 4);
  });
});
