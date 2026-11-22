import {
  buildCanonicalIntentMessage,
  computeTelegramInitDataHash,
  verifyIntentToken,
} from "@astrodex/tg-protocol";
import { Account, Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createInMemoryRepository } from "./db/repository.js";

const TESTNET_PASS = "Test SDF Network ; September 2015";
const BOT_TOKEN = "987654321:harmony-test-bot-token-for-vitest-run";
const WEBHOOK_SECRET = "harmony-webhook-secret-1234567890";
const HMAC_SECRET = "shared-ecosystem-hmac-secret-at-least-32-chars";
const ECO_SECRET = "shared-cross-app-intent-secret-32-chars!!";

const CLASSIC_G = "GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE";
const SMART_C = "CAA637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE";
const OFFICIAL_USDC = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SPOOF_USDC = "GB6CISIU2PAG7MVCR4HKA27VY5OBBJ4P2L5IDEOH7UL34TU66OOFCNZA";
const ASTRO_TOKEN_C = "CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE";
const LOGO_SHA256 = "b".repeat(64);

function makeHarmonyEnv() {
  return {
    STELLAR_NETWORK: "testnet",
    STELLAR_NETWORK_PASSPHRASE: TESTNET_PASS,
    STELLAR_RPC_URLS: "https://rpc.harmony.example",
    HORIZON_URLS: "https://horizon.harmony.example",
    TMA_ORIGIN: "https://astrodex.harmony.example",
    ALLOWED_ORIGINS: "https://astrodex.harmony.example",
    ASTROWALLET_BOT_USERNAME: "AstroWalletAppBot",
    ASTROWALLET_MINI_APP_SHORT_NAME: "wallet",
    ASTROWALLET_API_BASE_URL: "https://astrowallet.harmony.example",
    ASTROGATE_BOT_USERNAME: "AstroGateSorobanBot",
    ASTROGATE_API_BASE_URL: "https://astrogate.harmony.example",
    ASTROGATE_LAUNCHPAD_CONTRACT_ID: "CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK",
    SEP42_ASSET_LIST_URLS: "https://sep42.harmony.example/list.json",
    TG_BOT_TOKEN: BOT_TOKEN,
    TG_WEBHOOK_SECRET: WEBHOOK_SECRET,
    INTENT_HMAC_SECRET: HMAC_SECRET,
    ECOSYSTEM_SHARED_INTENT_SECRET: ECO_SECRET,
  };
}

async function makeSignedInitData(tgUserId = 889900, username = "harmony_pilot") {
  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    auth_date: String(now),
    user: JSON.stringify({ id: tgUserId, username, first_name: "Harmony" }),
  });
  const pairs = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const hash = await computeTelegramInitDataHash(
    pairs.map(([k, v]) => `${k}=${v}`).join("\n"),
    BOT_TOKEN,
  );
  params.set("hash", hash);
  return params.toString();
}

describe("3-Pillar Ecosystem Harmony E2E (AstroWallet SSO <-> AstroGate v4.5 <-> AstroDex)", () => {
  it("completes auth -> AstroID resolve -> AstroGate v4.5 scan -> honest G/C & spoof quote -> intent federation -> HMAC parity -> anti-replay confirm", async () => {
    const repo = createInMemoryRepository();
    let capturedExternalHeader = "";
    let capturedExternalBody: {
      intentId?: string;
      telegramUserId?: string;
      actionType?: string;
      envelope?: {
        version?: number;
        originApp?: string;
        subAction?: string;
        xdrSha256?: string;
      };
      expiresAt?: number;
    } | null = null;

    const app = createApp({
      createRepo: () => repo,
      verifyTxFn: async () => ({ confirmed: true, ledger: 710_250 }),
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();

        // 1. AstroWallet AstroID directory (strictly public accounts, zero vault ciphertext)
        if (u.includes("astrowallet.harmony.example/v1/identity/resolve")) {
          return new Response(
            JSON.stringify({
              ok: true,
              found: true,
              telegramUserId: "889900",
              username: "harmony_pilot",
              primaryAddress: CLASSIC_G,
              accounts: [
                { address: CLASSIC_G, kind: "classic", label: "Primary", isDefault: true },
                { address: SMART_C, kind: "smart", label: "Smart Vault", isDefault: false },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        // 2. AstroWallet external intent federation endpoint
        if (u.includes("astrowallet.harmony.example/v1/intents/external") && init?.method === "POST") {
          const headers = new Headers(init.headers);
          capturedExternalHeader = headers.get("X-Ecosystem-Secret") ?? "";
          capturedExternalBody = JSON.parse(String(init.body ?? "{}")) as typeof capturedExternalBody;
          return new Response(
            JSON.stringify({
              ok: true,
              intentId: capturedExternalBody?.intentId,
              deepLink: `https://t.me/AstroWalletAppBot/wallet?startapp=i-${capturedExternalBody?.intentId}-fed`,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        // 3. AstroGate v4.5 token metadata & SHA-256 logo CDN
        if (u.includes(`astrogate.harmony.example/api/v1/tokens/${ASTRO_TOKEN_C}`)) {
          return new Response(
            JSON.stringify({
              ok: true,
              token: {
                id: ASTRO_TOKEN_C,
                symbol: "ASTRO",
                name: "AstroGate",
                logoSha256: LOGO_SHA256,
                logoUrl: `https://astrogate.harmony.example/api/v1/logos/${LOGO_SHA256}.png`,
                graduated: true,
                poolReserveXlm: "10000000000",
                timelockHours: 48,
                lpLockYears: 7,
              },
            }),
            { status: 200 },
          );
        }

        // 4. SEP-42 verified asset list (guards against spoofed USDC)
        if (u.includes("sep42.harmony.example/list.json")) {
          return new Response(
            JSON.stringify({ assets: [{ code: "USDC", issuer: OFFICIAL_USDC }] }),
            { status: 200 },
          );
        }

        // 5. Horizon path payment discovery (Classic G... only)
        if (u.includes("horizon.harmony.example/paths/strict-send")) {
          return new Response(
            JSON.stringify({
              _embedded: {
                records: [
                  {
                    source_amount: "10.0000000",
                    destination_amount: "2.4500000",
                    path: [],
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }

        // 6. Horizon orderbook fallback
        if (u.includes("horizon.harmony.example/order_book")) {
          return new Response(
            JSON.stringify({
              bids: [{ price: "0.24", amount: "500.0000000" }],
              asks: [{ price: "0.25", amount: "500.0000000" }],
            }),
            { status: 200 },
          );
        }

        // 7. Soroban RPC simulateTransaction & getLedgerEntries
        if (u.includes("rpc.harmony.example")) {
          const rpcReq = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method?: string };
          if (rpcReq.method === "getLatestLedger") {
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpcReq.id, result: { sequence: 1000 } }), {
              status: 200,
            });
          }
          if (rpcReq.method === "simulateTransaction") {
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id: rpcReq.id,
                result: { minResourceFee: "15000", results: [{ xdr: "" }] },
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: rpcReq.id, result: { entries: [] } }),
            { status: 200 },
          );
        }

        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    // Step 1: Telegram initData auth + automatic AstroID SSO resolution
    const initData = await makeSignedInitData();
    const authRes = await app.request(
      "/v1/tg/auth",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      },
      makeHarmonyEnv(),
    );
    expect(authRes.status).toBe(200);
    const authJson = (await authRes.json()) as {
      sessionToken: string;
      astroId: {
        found: boolean;
        source: string;
        primaryAddress: string;
        accounts: Array<{ address: string; kind: string }>;
      };
    };
    expect(authJson.astroId.found).toBe(true);
    expect(authJson.astroId.source).toBe("astrowallet");
    expect(authJson.astroId.primaryAddress).toBe(CLASSIC_G);
    expect(authJson.astroId.accounts).toHaveLength(2);

    // Step 2: Explicit /v1/wallet/resolve check
    const resolveRes = await app.request("/v1/wallet/resolve?q=@harmony_pilot", {}, makeHarmonyEnv());
    expect(resolveRes.status).toBe(200);
    const resolvedText = await resolveRes.text();
    expect(resolvedText).not.toContain("AGVAULT");
    expect(resolvedText).toContain(CLASSIC_G);

    // Step 3: Forensic scan of AstroGate v4.5 token
    const scanRes = await app.request(`/v1/scanner/${ASTRO_TOKEN_C}`, {}, makeHarmonyEnv());
    expect(scanRes.status).toBe(200);
    const scanJson = (await scanRes.json()) as {
      ok: boolean;
      audit: {
        assetKey: string;
        astroShieldScore: number;
        sorobanAudit?: { astroGate?: { isLaunchpadToken: boolean; logoSha256Url?: string } };
      };
    };
    expect(scanJson.ok).toBe(true);
    expect(scanJson.audit.assetKey).toBe(ASTRO_TOKEN_C);
    expect(scanJson.audit.astroShieldScore).toBeGreaterThanOrEqual(0);

    // Step 4A: Quote spoofed USDC -> hard-blocked by anti-spoof guard
    const spoofQuoteRes = await app.request(
      "/v1/quote",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAsset: "XLM",
          toAsset: `USDC:${SPOOF_USDC}`,
          amount: "10.0000000",
          accountKind: "classic",
        }),
      },
      makeHarmonyEnv(),
    );
    expect(spoofQuoteRes.status).toBe(200);
    const spoofQuote = (await spoofQuoteRes.json()) as {
      quote: { blockedReason?: string; bestRoute: unknown };
    };
    expect(spoofQuote.quote.blockedReason).toMatch(/spoof|USDC/i);
    expect(spoofQuote.quote.bestRoute).toBeNull();

    // Step 4B: Honest G... vs C... filtering on verified USDC
    const classicQuoteRes = await app.request(
      "/v1/quote",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAsset: "XLM",
          toAsset: `USDC:${OFFICIAL_USDC}`,
          amount: "10.0000000",
          accountKind: "classic",
        }),
      },
      makeHarmonyEnv(),
    );
    const classicQuote = (await classicQuoteRes.json()) as {
      quote: { routes: Array<{ venue: string }> };
    };
    expect(classicQuote.quote.routes.some((r) => r.venue === "sdex_horizon")).toBe(true);

    const smartQuoteRes = await app.request(
      "/v1/quote",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAsset: "XLM",
          toAsset: `USDC:${OFFICIAL_USDC}`,
          amount: "10.0000000",
          accountKind: "smart",
        }),
      },
      makeHarmonyEnv(),
    );
    const smartQuote = (await smartQuoteRes.json()) as {
      quote: {
        routes: Array<{ venue: string }>;
        skippedVenues: Array<{ venue: string; reason: string }>;
      };
    };
    expect(smartQuote.quote.routes.some((r) => r.venue === "sdex_horizon")).toBe(false);
    expect(smartQuote.quote.skippedVenues.some((s) => s.venue === "sdex_horizon")).toBe(true);

    // Step 5: Create & pre-scan swap XDR intent -> federate to AstroWallet -> verify 4-field HMAC parity
    const benignSwapTx = new TransactionBuilder(new Account(CLASSIC_G, "10"), {
      fee: "100",
      networkPassphrase: TESTNET_PASS,
    })
      .addOperation(
        Operation.payment({
          destination: CLASSIC_G,
          asset: Asset.native(),
          amount: "1.0000000",
        }),
      )
      .setTimeout(60)
      .build();

    const intentRes = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authJson.sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "dex_swap",
          sourceAddress: CLASSIC_G,
          unsignedXdr: benignSwapTx.toXDR(),
          humanSummary: "Swap 10 XLM -> 2.45 USDC via Horizon Path",
          fromAsset: "XLM",
          toAsset: `USDC:${OFFICIAL_USDC}`,
          amount: "10.0000000",
          expectedOutputAmount: "2.4500000",
          provider: "horizon-path",
          returnStartAppParam: "token_USDC",
        }),
      },
      makeHarmonyEnv(),
    );
    expect(intentRes.status).toBe(200);
    const createdIntent = (await intentRes.json()) as {
      ok: boolean;
      intentId: string;
      actionType: string;
      sig: string;
      expiresAt: number;
      federatedToAstroWallet: boolean;
      deepLink: string;
    };

    expect(createdIntent.ok).toBe(true);
    expect(createdIntent.actionType).toBe("swap");
    expect(createdIntent.federatedToAstroWallet).toBe(true);
    expect(capturedExternalHeader).toBe(ECO_SECRET);
    expect(capturedExternalBody?.envelope?.originApp).toBe("astrodex");
    expect(capturedExternalBody?.envelope?.subAction).toBe("dex_swap");
    expect(capturedExternalBody?.envelope?.xdrSha256).toMatch(/^[a-f0-9]{64}$/);

    // Bit-exact 4-field HMAC verification (${network}:${intentId}:${telegramUserId}:${expiresAt})
    const claims = {
      intentId: createdIntent.intentId,
      network: "testnet" as const,
      telegramUserId: "889900",
      expiresAt: createdIntent.expiresAt,
    };
    expect(buildCanonicalIntentMessage(claims)).toBe(
      `testnet:${createdIntent.intentId}:889900:${createdIntent.expiresAt}`,
    );
    const verifyRes = await verifyIntentToken(claims, createdIntent.sig, HMAC_SECRET);
    expect(verifyRes).toEqual({ valid: true });

    // Step 6: Confirm settlement + enforce anti-replay on txHash
    const settledTxHash = "9".repeat(64);
    const confirmRes = await app.request(
      `/v1/intents/${createdIntent.intentId}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sig: createdIntent.sig, txHash: settledTxHash }),
      },
      makeHarmonyEnv(),
    );
    expect(confirmRes.status).toBe(200);

    const intentRes2 = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authJson.sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "dex_swap",
          sourceAddress: CLASSIC_G,
          unsignedXdr: benignSwapTx.toXDR(),
          humanSummary: "Second swap intent",
        }),
      },
      makeHarmonyEnv(),
    );
    const createdIntent2 = (await intentRes2.json()) as { intentId: string; sig: string };
    const replayRes = await app.request(
      `/v1/intents/${createdIntent2.intentId}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sig: createdIntent2.sig, txHash: settledTxHash }),
      },
      makeHarmonyEnv(),
    );
    expect(replayRes.status).toBe(409);

    // Step 7: Accept server-to-server Boomerang confirm authenticated by X-Ecosystem-Secret
    const intentRes3 = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authJson.sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "dex_swap",
          sourceAddress: CLASSIC_G,
          unsignedXdr: benignSwapTx.toXDR(),
          humanSummary: "Boomerang swap intent",
        }),
      },
      makeHarmonyEnv(),
    );
    const createdIntent3 = (await intentRes3.json()) as { intentId: string };
    const boomerangRes = await app.request(
      `/v1/intents/${createdIntent3.intentId}/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ecosystem-Secret": ECO_SECRET,
        },
        body: JSON.stringify({
          txHash: "8".repeat(64),
          payerAddress: CLASSIC_G,
        }),
      },
      makeHarmonyEnv(),
    );
    expect(boomerangRes.status).toBe(200);
    expect(((await boomerangRes.json()) as { status: string }).status).toBe("confirmed");
  });
});
