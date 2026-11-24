import { describe, expect, it } from "vitest";
import {
  buildAstroWalletIntentLink,
  buildCrossAppIntentEnvelope,
  computeTelegramInitDataHash,
  createAstroIdResolver,
  formatScanCard,
  parseAstroDexStartAppParam,
  signIntentToken,
  signMiniAppSessionToken,
  verifyIntentToken,
  verifyMiniAppSessionToken,
  verifyTelegramInitData,
} from "./index.js";

const BOT_TOKEN = "123456789:test-telegram-bot-token-for-unit-tests";
const HMAC_SECRET = "super-secret-astrodex-hmac-key-at-least-32-chars";

describe("@astrodex/tg-protocol", () => {
  it("verifies Telegram WebApp initData HMAC and rejects expired payloads", async () => {
    const now = 1_700_000_000;
    const userJson = JSON.stringify({ id: 987654321, username: "AstroTrader", first_name: "Ana" });
    const params = new URLSearchParams({
      auth_date: String(now),
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      start_param: "token_ASTRO",
      user: userJson,
    });
    const pairs = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const checkString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
    const hash = await computeTelegramInitDataHash(checkString, BOT_TOKEN);
    params.set("hash", hash);

    const valid = await verifyTelegramInitData(params.toString(), BOT_TOKEN, {
      nowUnixSeconds: now + 30,
    });
    expect(valid.valid).toBe(true);
    if (valid.valid) {
      expect(valid.data.user.id).toBe("987654321");
      expect(valid.data.user.usernameLower).toBe("astrotrader");
      expect(valid.data.startParam).toBe("token_ASTRO");
    }

    const expired = await verifyTelegramInitData(params.toString(), BOT_TOKEN, {
      nowUnixSeconds: now + 301,
    });
    expect(expired).toEqual({ valid: false, reason: "expired" });
  });

  it("produces bit-exact 4-field intent HMAC tokens matching AstroWallet and builds CrossAppIntentEnvelope v1", async () => {
    const now = 1_700_000_000;
    const claims = {
      intentId: "it_abcdef123456",
      network: "testnet" as const,
      telegramUserId: "987654321",
      expiresAt: now + 300,
    };
    const sig = await signIntentToken(claims, HMAC_SECRET);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);

    const ok = await verifyIntentToken(claims, sig, HMAC_SECRET, now + 10);
    expect(ok).toEqual({ valid: true });

    const crossNet = await verifyIntentToken(
      { ...claims, network: "mainnet" },
      sig,
      HMAC_SECRET,
      now + 10,
    );
    expect(crossNet).toEqual({ valid: false, reason: "invalid_signature" });

    const env = await buildCrossAppIntentEnvelope({
      subAction: "dex_swap",
      humanSummary: "Swap 100 XLM for ASTRO via AstroGate Curve",
      unsignedXdr: "AAAAAgAAAABtestXdrPayloadBase64String==",
      fromAsset: "XLM",
      toAsset: "CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE",
      amount: "100",
      expectedOutputAmount: "5000",
      provider: "astrogate_curve",
      returnStartAppParam: "token_CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE",
    });
    expect(env.originApp).toBe("astrodex");
    expect(env.xdrSha256).toMatch(/^[a-f0-9]{64}$/);

    const link = buildAstroWalletIntentLink({
      astroWalletBotUsername: "AstroWalletAppBot",
      astroWalletMiniAppShortName: "wallet",
      intentId: claims.intentId,
      sig,
    });
    expect(link).toBe(
      `https://t.me/AstroWalletAppBot/wallet?startapp=i-${claims.intentId}-${sig}`,
    );
    expect(parseAstroDexStartAppParam(`i-${claims.intentId}-${sig}`)).toEqual({
      kind: "intent",
      intentId: claims.intentId,
      sig,
    });
  });

  it("mints and verifies Mini App session tokens and parses startapp params", async () => {
    const now = 1_700_000_000;
    const token = await signMiniAppSessionToken(
      {
        telegramUserId: "987654321",
        usernameLower: "astrotrader",
        network: "testnet",
        issuedAt: now,
        expiresAt: now + 900,
      },
      HMAC_SECRET,
    );
    const verified = await verifyMiniAppSessionToken(token, "testnet", HMAC_SECRET, now + 60);
    expect(verified.valid).toBe(true);

    const wrongNet = await verifyMiniAppSessionToken(token, "mainnet", HMAC_SECRET, now + 60);
    expect(wrongNet).toEqual({ valid: false, reason: "wrong_network" });

    expect(parseAstroDexStartAppParam("token_USDC:G123")).toEqual({
      kind: "token",
      assetId: "USDC:G123",
    });
    expect(parseAstroDexStartAppParam("scan_CAB")).toEqual({
      kind: "scan",
      assetId: "CAB",
    });
  });

  it("resolves AstroID via AstroWallet primary with AstroGate fallback and strips non-public data", async () => {
    const validPub = "GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE";
    const resolver = createAstroIdResolver({
      astroWalletApiBaseUrl: "https://wallet.example.com",
      astroGateApiBaseUrl: "https://gate.example.com",
      fetchFn: (async (url: string | URL | Request) => {
        const target = typeof url === "string" ? url : url.toString();
        if (target.includes("wallet.example.com")) {
          return new Response(
            JSON.stringify({
              ok: true,
              found: true,
              telegramUserId: "987654321",
              username: "astrotrader",
              primaryAddress: validPub,
              accounts: [{ address: validPub, kind: "classic", label: "Main", isDefault: true }],
              encryptedVaultBundle: "AGVAULT1:should_never_leak",
            }),
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch,
    });

    const profile = await resolver.resolveIdentity("@astrotrader");
    expect(profile.found).toBe(true);
    expect(profile.source).toBe("astrowallet");
    expect(profile.primaryAddress).toBe(validPub);
    expect((profile as Record<string, unknown>).encryptedVaultBundle).toBeUndefined();

    const card = formatScanCard({
      assetKey: "XLM",
      kind: "native",
      code: "XLM",
      decimals: 7,
      astroShieldScore: 100,
      verdict: "safe",
      trustTier: "official",
      basicSummary: [],
      findings: [],
      directoryTags: [],
      auditedAtUnix: 1_700_000_000,
    });
    expect(card).toContain("AstroDex X-Ray Scan");
  });

  it("parses compact mainnet/testnet token, scan, and legacy tab_ startapp deep-links", () => {
    expect(parseAstroDexStartAppParam("m_t_CCNOV6XVI2O5BSTA3232GIRUQULDEBV7IWGKM6QKI6II5OIIQTU24JJN")).toEqual({
      kind: "token",
      assetId: "CCNOV6XVI2O5BSTA3232GIRUQULDEBV7IWGKM6QKI6II5OIIQTU24JJN",
    });
    expect(parseAstroDexStartAppParam("t_s_XLM")).toEqual({
      kind: "scan",
      assetId: "XLM",
    });
    expect(parseAstroDexStartAppParam("tab_book")).toEqual({
      kind: "tab",
      tab: "book",
    });
    expect(parseAstroDexStartAppParam("t-watchlist")).toEqual({
      kind: "tab",
      tab: "watchlist",
    });
  });
});
