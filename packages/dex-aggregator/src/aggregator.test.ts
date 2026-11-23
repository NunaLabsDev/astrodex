import { TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  buildAstroGateBuybackBountyXdr,
  buildClassicLimitOrderXdr,
  computeDepthChart,
  computeSoroswapAmountOut,
  createSmartLiquidityRouter,
  localCurveQuoteBuy,
  localCurveQuoteSell,
} from "./index.js";

const TESTNET_PASS = "Test SDF Network ; September 2015";
const SELLER = "GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const FAKE_ISSUER = "GB6CISIU2PAG7MVCR4HKA27VY5OBBJ4P2L5IDEOH7UL34TU66OOFCNZA";
const ASTRO_TOKEN = "CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE";
const LAUNCHPAD_ID = "CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK";

describe("@astrodex/dex-aggregator", () => {
  it("matches AstroGate v4.5 bonding curve buy/sell/bounty math and builds valid XDR", () => {
    const buyQ = localCurveQuoteBuy(0n, 0n, 100n * 10_000_000n);
    expect(buyQ).not.toBeNull();
    expect(buyQ!.total_fee_bps).toBe(30n);
    expect(buyQ!.tokens_out).toBeGreaterThan(0n);

    const sellQ = localCurveQuoteSell(
      buyQ!.net_xlm_to_curve,
      buyQ!.tokens_out,
      buyQ!.tokens_out / 2n,
    );
    expect(sellQ).not.toBeNull();
    expect(sellQ!.total_fee_bps).toBe(120n);
    expect(sellQ!.net_xlm_out).toBeGreaterThan(0n);

    const bountyXdr = buildAstroGateBuybackBountyXdr({
      sourceAddress: SELLER,
      launchpadContractId: LAUNCHPAD_ID,
      tokenContractId: ASTRO_TOKEN,
      networkPassphrase: TESTNET_PASS,
    });
    const decoded = TransactionBuilder.fromXDR(bountyXdr, TESTNET_PASS);
    expect(decoded.operations).toHaveLength(1);
  });

  it("hard-blocks spoofed USDC issuers and filters Classic SDEX on Smart Accounts C...", async () => {
    const router = createSmartLiquidityRouter({
      horizonUrls: ["https://horizon.example.com"],
      verifiedAssets: [{ code: "USDC", issuer: USDC_ISSUER }],
      directPairReservesLoader: async () => ({
        pairId: "CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP",
        reserveIn: 1_000n * 10_000_000n,
        reserveOut: 5_000n * 10_000_000n,
      }),
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          _embedded: {
            records: [{ destination_amount: "450.0000000", path: [] }],
          },
        }),
      }),
    });

    const spoof = await router.quoteBestRoutes({
      fromAsset: "XLM",
      toAsset: `USDC:${FAKE_ISSUER}`,
      amount: "10",
      slippageBps: 50,
      accountKind: "classic",
    });
    expect(spoof.bestRoute).toBeNull();
    expect(spoof.blockedReason).toContain("spoofed");

    const smartQuote = await router.quoteBestRoutes({
      fromAsset: "XLM",
      toAsset: ASTRO_TOKEN,
      amount: "100",
      slippageBps: 50,
      accountKind: "smart",
    });
    expect(smartQuote.bestRoute?.venue).toBe("soroswap_direct");
    expect(smartQuote.skippedVenues.some((v) => v.venue === "sdex_horizon")).toBe(true);
    expect(smartQuote.skippedVenues.some((v) => v.venue === "xoxno_aggregator")).toBe(true);
  });

  it("builds Classic SDEX limit order XDR with optional changeTrust and computes depth chart", () => {
    const xdr = buildClassicLimitOrderXdr(
      {
        seller: SELLER,
        side: "buy",
        baseAsset: `USDC:${USDC_ISSUER}`,
        quoteAsset: "XLM",
        amount: "50.0000000",
        price: "10.0000000",
        includeTrustlineIfMissing: true,
      },
      TESTNET_PASS,
    );
    const tx = TransactionBuilder.fromXDR(xdr, TESTNET_PASS);
    expect(tx.operations).toHaveLength(2);
    expect(tx.operations[0]?.type).toBe("changeTrust");
    expect(tx.operations[1]?.type).toBe("manageBuyOffer");

    expect(computeSoroswapAmountOut(100_000_000n, 1_000_000_000n, 5_000_000_000n)).toBeGreaterThan(
      0n,
    );

    const depth = computeDepthChart({
      baseAsset: `USDC:${USDC_ISSUER}`,
      quoteAsset: "XLM",
      bids: [
        { price: "9.8", amount: "10", totalQuote: "98", venue: "sdex" },
        { price: "9.5", amount: "20", totalQuote: "190", venue: "sdex" },
      ],
      asks: [{ price: "10.2", amount: "15", totalQuote: "153", venue: "sdex" }],
      bestBid: "9.8",
      bestAsk: "10.2",
      spreadPct: "3.92",
      timestampUnix: 1_700_000_000,
    });
    expect(depth).toHaveLength(3);
    expect(depth[0]?.side).toBe("bid");
    expect(depth[2]?.side).toBe("ask");
  });

  it("computes dynamic priceImpactPct and curve stage boundary quotes accurately", async () => {
    const lowQuote = localCurveQuoteBuy(249n * 10_000_000n, 0n, 5n * 10_000_000n);
    const midQuote = localCurveQuoteBuy(250n * 10_000_000n, 0n, 5n * 10_000_000n);
    const sprintQuote = localCurveQuoteBuy(500n * 10_000_000n, 0n, 5n * 10_000_000n);
    const gradQuote = localCurveQuoteBuy(995n * 10_000_000n, 0n, 20n * 10_000_000n);
    expect(lowQuote?.total_fee_bps).toBe(30n);
    expect(midQuote?.total_fee_bps).toBe(50n);
    expect(sprintQuote?.total_fee_bps).toBe(25n);
    expect(gradQuote?.will_graduate).toBe(true);

    const router = createSmartLiquidityRouter({
      horizonUrls: ["https://horizon.example.com"],
      directPairReservesLoader: async () => ({
        pairId: "CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP",
        reserveIn: 1_000n * 10_000_000n,
        reserveOut: 5_000n * 10_000_000n,
      }),
      fetchFn: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    });
    const smallTrade = await router.quoteBestRoutes({
      fromAsset: "XLM",
      toAsset: ASTRO_TOKEN,
      amount: "1",
      slippageBps: 50,
      accountKind: "smart",
    });
    const largeTrade = await router.quoteBestRoutes({
      fromAsset: "XLM",
      toAsset: ASTRO_TOKEN,
      amount: "500",
      slippageBps: 50,
      accountKind: "smart",
    });
    expect(Number(smallTrade.bestRoute?.priceImpactPct)).toBeLessThan(1);
    expect(Number(largeTrade.bestRoute?.priceImpactPct)).toBeGreaterThan(25);
  });

  it("queries XOXNO GET /api/v1/quote with canonical SAC IDs for Ethena USDe", async () => {
    const { quoteViaXoxno } = await import("./xoxno/index.js");
    let capturedUrl = "";
    const route = await quoteViaXoxno({
      xoxnoApiBase: "https://stellar-swap.xoxno.com",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      fromAsset: "XLM",
      toAsset: "USDE:GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47",
      amount: "10",
      slippageBps: 100,
      fetchFn: async (url) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            amountOut: "13142870",
            amountOutMin: "13011441",
            priceImpact: 0.001,
            hops: [{ dex: "AquariusClmm", feeBps: 10 }],
            transaction: "AAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          }),
        };
      },
    });
    expect(capturedUrl).toContain("/api/v1/quote?");
    expect(capturedUrl).toContain("from=CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA");
    expect(capturedUrl).toContain("to=CCNOV6XVI2O5BSTA3232GIRUQULDEBV7IWGKM6QKI6II5OIIQTU24JJN");
    expect(route?.venue).toBe("xoxno_aggregator");
    expect(route?.expectedOutputAmount).toBe("1.3142870");
    expect(route?.unsignedXdr).toBeTruthy();
  });
});
