import { computeTelegramInitDataHash } from "@astrodex/tg-protocol";
import { Account, Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createInMemoryRepository } from "./db/repository.js";

const TESTNET_PASS = "Test SDF Network ; September 2015";
const BOT_TOKEN = "123456789:test-astrodex-bot-token-for-vitest";
const WEBHOOK_SECRET = "test-webhook-secret-1234567890";
const HMAC_SECRET = "test-intent-hmac-secret-at-least-32-chars";
const ECO_SECRET = "test-ecosystem-shared-secret-32-chars";
const USER_PUB = "GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE";
const ATTACKER_PUB = "GB6CISIU2PAG7MVCR4HKA27VY5OBBJ4P2L5IDEOH7UL34TU66OOFCNZA";
const OFFICIAL_USDC = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function makeBaseEnv() {
  return {
    STELLAR_NETWORK: "testnet",
    STELLAR_NETWORK_PASSPHRASE: TESTNET_PASS,
    STELLAR_RPC_URLS: "https://rpc.example.com",
    HORIZON_URLS: "https://horizon.example.com",
    TMA_ORIGIN: "https://astrodex-testnet.pages.dev",
    ALLOWED_ORIGINS: "https://astrodex-testnet.pages.dev",
    ASTROWALLET_BOT_USERNAME: "AstroWalletAppBot",
    ASTROWALLET_MINI_APP_SHORT_NAME: "wallet",
    ASTROWALLET_API_BASE_URL: "https://astrowallet.example.com",
    ASTROGATE_BOT_USERNAME: "AstroGateSorobanBot",
    ASTROGATE_API_BASE_URL: "https://astrogate.example.com",
    SEP42_ASSET_LIST_URLS: "https://sep42.example.com/list.json",
    TG_BOT_TOKEN: BOT_TOKEN,
    TG_WEBHOOK_SECRET: WEBHOOK_SECRET,
    INTENT_HMAC_SECRET: HMAC_SECRET,
    ECOSYSTEM_SHARED_INTENT_SECRET: ECO_SECRET,
  };
}

async function makeSignedInitData(tgUserId = 424242, username = "astro_trader") {
  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    auth_date: String(now),
    user: JSON.stringify({ id: tgUserId, username, first_name: "Test" }),
  });
  const pairs = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const hash = await computeTelegramInitDataHash(
    pairs.map(([k, v]) => `${k}=${v}`).join("\n"),
    BOT_TOKEN,
  );
  params.set("hash", hash);
  return params.toString();
}

describe("@astrodex/server", () => {
  it("authenticates Telegram initData, resolves AstroID from AstroWallet, and rejects untrusted origins", async () => {
    const repo = createInMemoryRepository();
    const app = createApp({
      createRepo: () => repo,
      fetchFn: (async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("astrowallet.example.com/v1/identity/resolve")) {
          return new Response(
            JSON.stringify({
              ok: true,
              found: true,
              telegramUserId: "424242",
              username: "astro_trader",
              primaryAddress: USER_PUB,
              accounts: [{ address: USER_PUB, kind: "classic", label: "Primary", isDefault: true }],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    const badOrigin = await app.request(
      "/health",
      { headers: { Origin: "https://evil.example.com" } },
      makeBaseEnv(),
    );
    expect(badOrigin.status).toBe(403);

    const initData = await makeSignedInitData();
    const authRes = await app.request(
      "/v1/tg/auth",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      },
      makeBaseEnv(),
    );
    expect(authRes.status).toBe(200);
    const authJson = (await authRes.json()) as {
      sessionToken: string;
      astroId: { found: boolean; source: string; primaryAddress: string };
    };
    expect(authJson.sessionToken).toContain(".");
    expect(authJson.astroId.found).toBe(true);
    expect(authJson.astroId.source).toBe("astrowallet");
    expect(authJson.astroId.primaryAddress).toBe(USER_PUB);
  });

  it("blocks SSRF redirect traps on stellar.toml and blocks malicious XDR intents fail-closed", async () => {
    const repo = createInMemoryRepository();
    const app = createApp({
      createRepo: () => repo,
      fetchFn: (async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("redirect-trap.example/.well-known/stellar.toml")) {
          return new Response("", {
            status: 302,
            headers: { Location: "https://127.0.0.1/secret" },
          });
        }
        if (u.includes("sep42.example.com")) {
          return new Response(
            JSON.stringify({ assets: [{ code: "USDC", issuer: OFFICIAL_USDC }] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    const ssrfRes = await app.request(
      "/v1/proxy/stellar-toml?domain=redirect-trap.example",
      {},
      makeBaseEnv(),
    );
    expect(ssrfRes.status).toBe(403);

    const initData = await makeSignedInitData();
    const authRes = await app.request(
      "/v1/tg/auth",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      },
      makeBaseEnv(),
    );
    const { sessionToken } = (await authRes.json()) as { sessionToken: string };

    const drainerTx = new TransactionBuilder(new Account(USER_PUB, "1"), {
      fee: "100",
      networkPassphrase: TESTNET_PASS,
    })
      .addOperation(
        Operation.setOptions({
          masterWeight: 0,
          signer: { ed25519PublicKey: ATTACKER_PUB, weight: 1 },
        }),
      )
      .setTimeout(60)
      .build();

    const blockedIntent = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "sdex_limit_order_create",
          sourceAddress: USER_PUB,
          unsignedXdr: drainerTx.toXDR(),
          humanSummary: "Drainer attempt",
        }),
      },
      makeBaseEnv(),
    );
    expect(blockedIntent.status).toBe(403);
  });

  it("creates & federates valid SDEX limit order intents, verifies tx confirmation, and prevents txHash replay", async () => {
    const repo = createInMemoryRepository();
    let federatedCalled = false;
    const txHash = "a".repeat(64);

    const app = createApp({
      createRepo: () => repo,
      verifyTxFn: async () => ({ confirmed: true, ledger: 555_001 }),
      fetchFn: (async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("astrowallet.example.com/v1/intents/external")) {
          federatedCalled = true;
          return new Response(
            JSON.stringify({
              ok: true,
              deepLink: "https://t.me/AstroWalletAppBot/wallet?startapp=i-ad_federated",
            }),
            { status: 200 },
          );
        }
        if (u.includes("sep42.example.com")) {
          return new Response(
            JSON.stringify({ assets: [{ code: "USDC", issuer: OFFICIAL_USDC }] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    const initData = await makeSignedInitData();
    const authRes = await app.request(
      "/v1/tg/auth",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      },
      makeBaseEnv(),
    );
    const { sessionToken } = (await authRes.json()) as { sessionToken: string };

    const createRes = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "sdex_limit_order_create",
          sourceAddress: USER_PUB,
          limitOrder: {
            side: "buy",
            baseAsset: `USDC:${OFFICIAL_USDC}`,
            quoteAsset: "XLM",
            amount: "10.0000000",
            price: "4.0000000",
          },
          humanSummary: "Place SDEX Buy Limit 10 USDC @ 4 XLM",
          returnStartAppParam: "token_USDC",
        }),
      },
      makeBaseEnv(),
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      ok: boolean;
      intentId: string;
      sig: string;
      actionType: string;
      federatedToAstroWallet: boolean;
    };
    expect(created.actionType).toBe("sign_xdr");
    expect(created.federatedToAstroWallet).toBe(true);
    expect(federatedCalled).toBe(true);

    const confirmRes = await app.request(
      `/v1/intents/${created.intentId}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sig: created.sig, txHash }),
      },
      makeBaseEnv(),
    );
    expect(confirmRes.status).toBe(200);

    // Replay check with a second intent reusing the same txHash
    const createRes2 = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "sdex_limit_order_create",
          sourceAddress: USER_PUB,
          limitOrder: {
            side: "buy",
            baseAsset: `USDC:${OFFICIAL_USDC}`,
            quoteAsset: "XLM",
            amount: "5.0000000",
            price: "4.0000000",
          },
          humanSummary: "Second limit order",
        }),
      },
      makeBaseEnv(),
    );
    const created2 = (await createRes2.json()) as { intentId: string; sig: string };
    const replayRes = await app.request(
      `/v1/intents/${created2.intentId}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sig: created2.sig, txHash }),
      },
      makeBaseEnv(),
    );
    expect(replayRes.status).toBe(409);

    // Ensure Asset helper import is valid
    expect(Asset.native().isNative()).toBe(true);
  });

  it("serves MCP tools/list & scan_stellar_asset and verifies Telegram webhook secret + dedup", async () => {
    const repo = createInMemoryRepository();
    const app = createApp({ createRepo: () => repo });

    const mcpRes = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "scan_stellar_asset", arguments: { assetId: "XLM" } },
        }),
      },
      makeBaseEnv(),
    );
    expect(mcpRes.status).toBe(200);
    const mcpJson = (await mcpRes.json()) as {
      result: { content: Array<{ text: string }> };
    };
    expect(mcpJson.result.content[0]?.text).toContain("XLM");

    const badWebhook = await app.request(
      "/tg/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "wrong-secret",
        },
        body: JSON.stringify({ update_id: 1001 }),
      },
      makeBaseEnv(),
    );
    expect(badWebhook.status).toBe(401);

    expect(await repo.claimTelegramUpdateId(5001)).toBe(true);
    expect(await repo.claimTelegramUpdateId(5001)).toBe(false);
  });

  it("hydrates official SEP-42 catalog, handles instant community listings with warning flags, and builds dex_swap intents", async () => {
    const repo = createInMemoryRepository();
    const UNLOCKED_ISSUER = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";
    const app = createApp({
      createRepo: () => repo,
      fetchFn: (async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("sep42.example.com")) {
          return new Response(
            JSON.stringify({
              assets: [{ code: "USDC", issuer: OFFICIAL_USDC, name: "USD Coin" }],
            }),
            { status: 200 },
          );
        }
        if (u.includes(`accounts/${UNLOCKED_ISSUER}`)) {
          return new Response(
            JSON.stringify({
              thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
              signers: [{ key: UNLOCKED_ISSUER, weight: 1, type: "ed25519_public_key" }],
              flags: {},
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    // 1. Overview auto-hydrates XLM + SEP-42 USDC
    const overviewRes = await app.request("/v1/markets/overview", {}, makeBaseEnv());
    expect(overviewRes.status).toBe(200);
    const overviewJson = (await overviewRes.json()) as {
      catalog: Array<{ assetKey: string; code: string; reviewStatus: string }>;
    };
    expect(overviewJson.catalog.some((t) => t.assetKey === "XLM" && t.reviewStatus === "official")).toBe(true);
    expect(
      overviewJson.catalog.some(
        (t) => t.assetKey === `USDC:${OFFICIAL_USDC}` && t.reviewStatus === "official",
      ),
    ).toBe(true);

    // 2. Spoofed USDC listing must be blocked (403)
    const spoofListing = await app.request(
      "/v1/markets/listings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: `USDC:${ATTACKER_PUB}`, ammVenue: "soroswap" }),
      },
      makeBaseEnv(),
    );
    expect(spoofListing.status).toBe(403);

    // 3. Community token with unlocked issuer publishes immediately with unreviewed_warning
    const communityListing = await app.request(
      "/v1/markets/listings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: `ACT:${UNLOCKED_ISSUER}`,
          ammVenue: "sdex_pool",
          communityUrl: "t.me/EarnACT",
        }),
      },
      makeBaseEnv(),
    );
    expect(communityListing.status).toBe(200);
    const communityJson = (await communityListing.json()) as {
      published: boolean;
      reviewStatus: string;
      reviewNote: string;
    };
    expect(communityJson.published).toBe(true);
    expect(communityJson.reviewStatus).toBe("unreviewed_warning");
    expect(communityJson.reviewNote.length).toBeGreaterThan(10);

    // 4. End-to-end dex_swap intent builder via swapSpec
    const initData = await makeSignedInitData();
    const authRes = await app.request(
      "/v1/tg/auth",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      },
      makeBaseEnv(),
    );
    const { sessionToken } = (await authRes.json()) as { sessionToken: string };

    const swapIntentRes = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "dex_swap",
          sourceAddress: USER_PUB,
          swapSpec: {
            venue: "sdex_horizon",
            fromAsset: "XLM",
            toAsset: `USDC:${OFFICIAL_USDC}`,
            amount: "10.0000000",
            minOutputAmount: "1.0000000",
          },
          humanSummary: "Swap 10 XLM to USDC via Classic SDEX",
          returnStartAppParam: `token_USDC:${OFFICIAL_USDC}`,
        }),
      },
      makeBaseEnv(),
    );
    expect(swapIntentRes.status).toBe(200);
    const swapIntentJson = (await swapIntentRes.json()) as { actionType: string; deepLink: string };
    expect(swapIntentJson.actionType).toBe("swap");
    expect(swapIntentJson.deepLink).toContain("AstroWalletAppBot");

    // 5. Existing community metadata (communityUrl) cannot be hijacked by subsequent listing calls
    const overwriteAttempt = await app.request(
      "/v1/markets/listings",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: `ACT:${UNLOCKED_ISSUER}`,
          ammVenue: "soroswap",
          communityUrl: "https://phishing.example.com",
        }),
      },
      makeBaseEnv(),
    );
    expect(overwriteAttempt.status).toBe(200);
    const overwriteJson = (await overwriteAttempt.json()) as {
      token: { communityUrl?: string; ammVenue?: string };
    };
    expect(overwriteJson.token.communityUrl).toBe("https://t.me/EarnACT");
    expect(overwriteJson.token.ammVenue).toBe("sdex_pool");

    // 6. Source account mismatch on unsignedXdr is blocked fail-closed (403)
    const mismatchedTx = new TransactionBuilder(new Account(ATTACKER_PUB, "1"), {
      fee: "100",
      networkPassphrase: TESTNET_PASS,
    })
      .addOperation(
        Operation.payment({
          destination: USER_PUB,
          asset: Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(60)
      .build();
    const mismatchRes = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "dex_swap",
          sourceAddress: USER_PUB,
          unsignedXdr: mismatchedTx.toXDR(),
          humanSummary: "Mismatched source attempt",
        }),
      },
      makeBaseEnv(),
    );
    expect(mismatchRes.status).toBe(403);

    // 7. Protocol 23 soroban_extend_ttl intent builder + Alerts CRUD + Orders endpoint
    const CONTRACT_ID = "CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE";
    const ttlRes = await app.request(
      "/v1/intents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "soroban_extend_ttl",
          sourceAddress: USER_PUB,
          extendTtlContractId: CONTRACT_ID,
          humanSummary: "Extend Protocol 23 TTL",
        }),
      },
      makeBaseEnv(),
    );
    expect(ttlRes.status).toBe(200);

    const createAlertRes = await app.request(
      "/v1/alerts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ assetKey: "XLM", condition: "above", threshold: 0.5 }),
      },
      makeBaseEnv(),
    );
    expect(createAlertRes.status).toBe(200);
    const createdAlert = (await createAlertRes.json()) as { alert: { id: string } };

    const deleteAlertRes = await app.request(
      `/v1/alerts/${createdAlert.alert.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionToken}` },
      },
      makeBaseEnv(),
    );
    expect(deleteAlertRes.status).toBe(200);

    const ordersRes = await app.request(`/v1/orders/${USER_PUB}`, {}, makeBaseEnv());
    expect(ordersRes.status).toBe(200);
  });

  it("supports ticker search (/v1/markets/search), ticker-resolved /v1/scanner/:assetId, and safe Soroban C... /v1/orderbook/:pair", async () => {
    const repo = createInMemoryRepository();
    const ASTRO_CONTRACT = "CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE";
    const ASTRO_PAIR = "CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP";
    const USDC_CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

    await repo.upsertToken({
      assetKey: ASTRO_CONTRACT,
      kind: "soroban",
      sacId: ASTRO_CONTRACT,
      code: "ASTRO",
      name: "Astro Test",
      decimals: 7,
      shieldScore: 90,
      verifiedLaunchpad: true,
      reviewStatus: "verified",
      ammVenue: "soroswap",
      pairId: ASTRO_PAIR,
      updatedAt: Math.floor(Date.now() / 1000),
    });

    const app = createApp({
      createRepo: () => repo,
      fetchFn: (async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("sep42.example.com")) {
          return new Response(
            JSON.stringify({
              assets: [
                {
                  code: "USDC",
                  issuer: OFFICIAL_USDC,
                  contract: USDC_CONTRACT,
                  name: "USD Coin",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });

    const searchRes = await app.request("/v1/markets/search?q=astro", {}, makeBaseEnv());
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as {
      ok: boolean;
      results: Array<{ assetKey: string; code: string }>;
    };
    expect(searchJson.ok).toBe(true);
    expect(searchJson.results[0]?.assetKey).toBe(ASTRO_CONTRACT);
    expect(searchJson.results[0]?.code).toBe("ASTRO");

    const scanRes = await app.request("/v1/scanner/astro", {}, makeBaseEnv());
    expect(scanRes.status).toBe(200);
    const scanJson = (await scanRes.json()) as {
      ok: boolean;
      audit: { assetKey: string };
    };
    expect(scanJson.ok).toBe(true);
    expect(scanJson.audit.assetKey).toBe(ASTRO_CONTRACT);

    // Soroban C... orderbook request must never throw 500 Internal Server Error
    // Dual SEP-42 token resolves to Classic CODE:G... for Horizon SDEX lookup
    const bookRes = await app.request(`/v1/orderbook/${USDC_CONTRACT}-XLM`, {}, makeBaseEnv());
    expect(bookRes.status).toBe(200);
    const bookJson = (await bookRes.json()) as { ok: boolean; snapshot: { baseAsset: string } };
    expect(bookJson.ok).toBe(true);
    expect(bookJson.snapshot.baseAsset).toBe(`USDC:${OFFICIAL_USDC}`);

    // Pure Soroban C... token orderbook also returns 200 safely without throwing
    const sorobanBookRes = await app.request(`/v1/orderbook/${ASTRO_CONTRACT}-XLM`, {}, makeBaseEnv());
    expect(sorobanBookRes.status).toBe(200);
  });
});
