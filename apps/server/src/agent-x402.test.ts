import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { parseServerConfig } from "@astrodex/domain";
import { createInMemoryRepository } from "./db/repository.js";
import { createApp } from "./app.js";
import { createAgentX402Routes } from "./routes/agent-x402.js";

const TEST_ENV = {
  STELLAR_NETWORK: "testnet",
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_RPC_URLS: "https://soroban-testnet.stellar.org",
  HORIZON_URLS: "https://horizon-testnet.stellar.org",
  TMA_ORIGIN: "https://astrodex-testnet.pages.dev",
  ALLOWED_ORIGINS: "https://astrodex-testnet.pages.dev",
  TG_BOT_USERNAME: "AstroDexBot",
  ASTROWALLET_BOT_USERNAME: "AstroWalletAppBot",
  TG_BOT_TOKEN: "123456:TEST_BOT_TOKEN_FOR_VITEST_ONLY",
  TG_WEBHOOK_SECRET: "test-webhook-secret-123456",
  INTENT_HMAC_SECRET: "test-intent-hmac-secret-at-least-32-chars",
  X402_PAY_TO_ADDRESS: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  X402_PRICE_STROOPS: "10000",
};

describe("x402 Forensic Alpha API (/v1/agent/forensic-alpha/:assetId)", () => {
  it("returns HTTP 402 with base64 PAYMENT-REQUIRED header when unpaid", async () => {
    const app = createApp({
      createRepo: () => createInMemoryRepository(),
    });
    const res = await app.request("/v1/agent/forensic-alpha/XLM", {}, TEST_ENV);
    expect(res.status).toBe(402);
    const hdr = res.headers.get("PAYMENT-REQUIRED");
    expect(hdr).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(hdr!, "base64").toString("utf8")) as {
      x402Version: number;
      accepts: Array<{ scheme: string; network: string; amount: string }>;
    };
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]?.scheme).toBe("exact");
    expect(decoded.accepts[0]?.network).toBe("stellar:testnet");
    expect(decoded.accepts[0]?.amount).toBe("10000");
  });

  it("rejects invalid X-PAYMENT proof with HTTP 402", async () => {
    const app = createApp({
      createRepo: () => createInMemoryRepository(),
    });
    const res = await app.request(
      "/v1/agent/forensic-alpha/XLM",
      { headers: { "X-PAYMENT": "not-valid" } },
      TEST_ENV,
    );
    expect(res.status).toBe(402);
  });

  it("returns 200 OK with PAYMENT-RESPONSE and forensic audit when payment is verified", async () => {
    const repo = createInMemoryRepository();
    const config = parseServerConfig(TEST_ENV);
    const subApp = new Hono();
    subApp.use("*", async (c, next) => {
      c.set("config" as never, config as never);
      c.set("repo" as never, repo as never);
      await next();
    });
    subApp.route(
      "/v1",
      createAgentX402Routes({
        verifyPaymentFn: async () => ({
          paid: true,
          payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        }),
        fetchFn: async () =>
          new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 }),
      }),
    );

    const res = await subApp.request("/v1/agent/forensic-alpha/XLM", {
      headers: { "X-PAYMENT": "valid-mock-proof" },
    });
    expect(res.status).toBe(200);
    const receiptHdr = res.headers.get("PAYMENT-RESPONSE");
    expect(receiptHdr).toBeTruthy();
    const receipt = JSON.parse(Buffer.from(receiptHdr!, "base64").toString("utf8")) as {
      success: boolean;
      payer: string;
    };
    expect(receipt.success).toBe(true);
    expect(receipt.payer).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

    const body = (await res.json()) as {
      ok: boolean;
      resolvedKey: string;
      audit: { assetKey: string; astroShieldScore: number } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.resolvedKey).toBe("XLM");
    expect(body.audit?.astroShieldScore).toBe(100);
  });
});
