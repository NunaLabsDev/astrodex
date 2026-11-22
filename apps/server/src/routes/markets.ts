import {
  computeDepthChart,
  fetchHorizonOrderbook,
  listClassicOpenOffers,
} from "@astrodex/dex-aggregator";
import {
  StellarAddressSchema,
  type CatalogTokenItem,
  type OhlcvTimeframe,
  type ServerConfig,
  type TokenForensicAudit,
  type TokenReviewStatus,
} from "@astrodex/domain";
import { createOraclesAndChartsEngine } from "@astrodex/oracles-and-charts";
import {
  createStellarForensicScanner,
  fetchSep42VerifiedAssets,
} from "@astrodex/stellar-scanner";
import type { KVNamespace } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { z } from "zod";
import type { WorkersAiBinding } from "../app.js";
import type { DexServerRepository, DexTokenRecord } from "../db/repository.js";
import { checkRateLimit, clientKeyFromHeaders } from "../rate-limit.js";
import { adaptFetch, type FetchLike } from "../stellar-verifier.js";
import { fetchStellarTomlSafe } from "./proxy.js";
import { authenticateMiniAppSession } from "./tg-auth.js";

const WatchlistBodySchema = z.object({
  assetKey: z.string().trim().min(1).max(100),
});

const AlertBodySchema = z.object({
  assetKey: z.string().trim().min(1).max(100),
  condition: z.enum(["above", "below"]),
  threshold: z.number().positive(),
});

const ListingRequestSchema = z.object({
  assetId: z.string().trim().min(1).max(120),
  ammVenue: z
    .enum(["soroswap", "aquarius", "phoenix", "sdex_pool", "astrogate_curve"])
    .default("soroswap"),
  pairId: z.string().trim().max(120).optional(),
  communityUrl: z.string().trim().max(160).optional(),
});

const TIMEFRAMES = new Set<OhlcvTimeframe>(["1m", "5m", "15m", "1h", "4h", "1d"]);

export type MarketRouteEnv = {
  Bindings: {
    CACHE?: KVNamespace;
    AI?: WorkersAiBinding;
  };
  Variables: {
    config: ServerConfig;
    repo: DexServerRepository;
  };
};

function createConfiguredScanner(
  config: ServerConfig,
  cache: KVNamespace | undefined,
  rawFetchFn: FetchLike,
  fetchFn: ReturnType<typeof adaptFetch>,
) {
  return createStellarForensicScanner({
    network: config.network,
    networkPassphrase: config.networkPassphrase,
    rpcUrls: config.rpcUrls,
    horizonUrls: config.horizonUrls,
    sep42AssetListUrls: config.sep42AssetListUrls,
    stellarExpertApiBase: config.stellarExpertApiBase,
    astroGateApiBaseUrl: config.astroGateApiBaseUrl,
    stellarRegistryApiBase: config.stellarRegistryApiBase,
    stellarTomlProxyFetcher: async (domain) => {
      const res = await fetchStellarTomlSafe(domain, cache, rawFetchFn);
      return res.ok ? res.toml : null;
    },
    fetchFn,
  });
}

function normalizeOptionalCommunityUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^t\.me\/[A-Za-z0-9_/+]{3,100}$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  if (/^@[A-Za-z0-9_]{4,32}$/.test(trimmed)) {
    return `https://t.me/${trimmed.slice(1)}`;
  }
  if (/^https:\/\/[A-Za-z0-9.-]+/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

async function summarizeAnomalyWithOptionalAi(
  ai: WorkersAiBinding | undefined,
  audit: TokenForensicAudit,
  fallbackText: string,
): Promise<string> {
  if (!ai) return fallbackText;
  const findingSummary =
    audit.findings.map((f) => f.title).join(", ") || "Limited metadata or unlocked issuer";
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500));
    const aiCall = ai.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages: [
        {
          role: "system",
          content:
            "Summarize Stellar token safety risk in one concise English sentence under 140 characters.",
        },
        {
          role: "user",
          content: `Token ${audit.code} (${audit.kind}), Astro Shield ${audit.astroShieldScore}/100, findings: ${findingSummary}`,
        },
      ],
      max_tokens: 60,
    });
    const res = (await Promise.race([aiCall, timeout])) as { response?: unknown } | null;
    if (res && typeof res.response === "string" && res.response.trim().length > 8) {
      return `Not yet reviewed: ${res.response.trim().replace(/\s+/g, " ").slice(0, 160)}`;
    }
  } catch {
    // Fall back cleanly to deterministic Astro Shield summary
  }
  return fallbackText;
}

export function createMarketRoutes(deps: { fetchFn?: FetchLike | undefined } = {}): Hono<MarketRouteEnv> {
  const router = new Hono<MarketRouteEnv>();
  const rawFetchFn = deps.fetchFn ?? fetch;
  const fetchFn = adaptFetch(rawFetchFn);

  router.get("/markets/overview", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const [tokens, pairs, oracle, sep42Assets] = await Promise.all([
      repo.listTokens(60),
      repo.listPairs(40),
      createOraclesAndChartsEngine({
        networkPassphrase: config.networkPassphrase,
        rpcUrls: config.rpcUrls,
        horizonUrls: config.horizonUrls,
        chainlinkPriceProxyContractId: config.chainlinkPriceProxyContractId,
        stellarPricesApiBase: config.stellarPricesApiBase,
        stellarPricesApiKey: config.stellarPricesApiKey,
        fetchFn,
      })
        .getXlmUsdPrice()
        .catch(() => null),
      fetchSep42VerifiedAssets(config.sep42AssetListUrls, fetchFn).catch(() => []),
    ]);

    let launchpadTokens: unknown[] = [];
    if (config.astroGateApiBaseUrl) {
      const base = config.astroGateApiBaseUrl.replace(/\/+$/, "");
      const res = await fetchFn(`${base}/api/v1/tokens`, {
        headers: { Accept: "application/json" },
      }).catch(() => null);
      if (res?.ok) {
        const json = (await res.json().catch(() => null)) as { tokens?: unknown[] } | null;
        if (Array.isArray(json?.tokens)) {
          launchpadTokens = json.tokens;
        }
      }
    }

    const catalogMap = new Map<string, CatalogTokenItem>();
    catalogMap.set("XLM", {
      assetKey: "XLM",
      kind: "native",
      code: "XLM",
      name: "Stellar Lumens",
      sacId: config.xlmSacContractId,
      decimals: 7,
      shieldScore: 100,
      reviewStatus: "official",
      ammVenue: "sdex_pool",
    });

    for (const item of sep42Assets) {
      const assetKey = item.contract
        ? item.contract.toUpperCase()
        : item.issuer
          ? `${item.code}:${item.issuer.toUpperCase()}`
          : "";
      if (!assetKey || assetKey === "XLM" || catalogMap.has(assetKey)) continue;
      catalogMap.set(assetKey, {
        assetKey,
        kind: item.contract ? "soroban" : "classic",
        code: item.code,
        name: item.name,
        issuer: item.issuer,
        sacId: item.contract,
        decimals: 7,
        logoUrl: item.icon,
        shieldScore: 95,
        reviewStatus: "official",
        ammVenue: item.contract ? "soroswap" : "sdex_pool",
      });
    }

    for (const rawLaunch of launchpadTokens) {
      if (!rawLaunch || typeof rawLaunch !== "object") continue;
      const item = rawLaunch as {
        id?: unknown;
        symbol?: unknown;
        name?: unknown;
        logoUrl?: unknown;
        graduated?: unknown;
        pairId?: unknown;
      };
      if (typeof item.id !== "string" || !item.id.trim()) continue;
      const assetKey = item.id.trim().toUpperCase();
      if (catalogMap.has(assetKey)) continue;
      catalogMap.set(assetKey, {
        assetKey,
        kind: "soroban",
        code: typeof item.symbol === "string" && item.symbol ? item.symbol : "TOKEN",
        name: typeof item.name === "string" ? item.name : undefined,
        sacId: assetKey,
        decimals: 7,
        logoUrl: typeof item.logoUrl === "string" ? item.logoUrl : undefined,
        shieldScore: 85,
        reviewStatus: "verified",
        ammVenue: item.graduated ? "soroswap" : "astrogate_curve",
        pairId: typeof item.pairId === "string" ? item.pairId : undefined,
      });
    }

    for (const t of tokens) {
      const existing = catalogMap.get(t.assetKey);
      const reviewStatus: TokenReviewStatus =
        existing?.reviewStatus === "official"
          ? "official"
          : (t.reviewStatus ?? (t.shieldScore >= 75 ? "verified" : "unreviewed_warning"));
      catalogMap.set(t.assetKey, {
        assetKey: t.assetKey,
        kind: t.kind,
        code: t.code,
        name: t.name ?? existing?.name,
        issuer: t.issuer ?? existing?.issuer,
        sacId: t.sacId ?? existing?.sacId,
        decimals: t.decimals,
        logoUrl: t.logoUrl ?? existing?.logoUrl,
        shieldScore: existing ? Math.max(existing.shieldScore, t.shieldScore) : t.shieldScore,
        reviewStatus,
        reviewNote: t.reviewNote ?? existing?.reviewNote,
        ammVenue: t.ammVenue ?? existing?.ammVenue,
        pairId: t.pairId ?? existing?.pairId,
        communityUrl: t.communityUrl ?? existing?.communityUrl,
      });
    }

    return c.json({
      ok: true,
      network: config.network,
      xlmUsd: oracle,
      tokens,
      pairs,
      launchpadTokens,
      catalog: Array.from(catalogMap.values()),
    });
  });

  router.post("/markets/listings", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const rl = await checkRateLimit({
      repository: repo,
      cache: c.env.CACHE,
      scope: "listings",
      clientKey: clientKeyFromHeaders(c.req.raw.headers),
      limitPerMin: Math.max(10, Math.floor(config.quoteRateLimitPerMin / 2)),
    });
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSeconds));
      return c.json({ ok: false, error: "Listing rate limit exceeded" }, 429);
    }

    let body: z.infer<typeof ListingRequestSchema>;
    try {
      body = ListingRequestSchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: "Invalid listing request",
          details: err instanceof Error ? err.message : undefined,
        },
        400,
      );
    }

    const scanner = createConfiguredScanner(config, c.env.CACHE, rawFetchFn, fetchFn);
    let audit: TokenForensicAudit;
    try {
      audit = await scanner.auditToken(body.assetId);
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to inspect token for listing",
        },
        400,
      );
    }

    if (audit.verdict === "malicious" || audit.trustTier === "spoof_blocked") {
      return c.json(
        {
          ok: false,
          error: "Blocked by Astro Shield: spoofed or malicious token cannot be listed.",
          audit,
        },
        403,
      );
    }

    const hasFindings = audit.findings.length > 0;
    const isClean = audit.astroShieldScore >= 75 && audit.verdict === "safe" && !hasFindings;
    const reviewStatus: TokenReviewStatus = isClean ? "verified" : "unreviewed_warning";

    let reviewNote = "Passed automated Astro Shield forensic check.";
    if (!isClean) {
      const findingTitles = audit.findings.map((f) => f.title).join(", ");
      const deterministicWarning = findingTitles
        ? `Community-listed (not yet reviewed): ${findingTitles}. Verify before trading.`
        : `Community-listed (not yet reviewed): Shield score ${audit.astroShieldScore}/100. Verify before trading.`;
      reviewNote = await summarizeAnomalyWithOptionalAi(c.env.AI, audit, deterministicWarning);
    }

    const now = Math.floor(Date.now() / 1000);
    const communityUrl = normalizeOptionalCommunityUrl(body.communityUrl);
    const pairId = body.pairId?.trim() || undefined;

    const record: DexTokenRecord = {
      assetKey: audit.assetKey,
      kind: audit.kind,
      sacId: audit.sacContractId ?? audit.contractId,
      code: audit.code,
      name: audit.name,
      issuer: audit.issuer,
      decimals: audit.decimals,
      logoUrl: audit.logoUrl,
      shieldScore: audit.astroShieldScore,
      verifiedLaunchpad: Boolean(audit.sorobanAudit?.astroGate?.isLaunchpadToken),
      reviewStatus,
      reviewNote,
      ammVenue: body.ammVenue,
      pairId,
      communityUrl,
      updatedAt: now,
    };

    const savedToken = await repo.upsertToken(record);
    if (pairId) {
      await repo.upsertPair({
        pairId,
        venue: body.ammVenue,
        baseAssetKey: audit.assetKey,
        quoteAssetKey: "XLM",
        reserveBase: "0",
        reserveQuote: "0",
        lpLockKind: audit.sorobanAudit?.astroGate?.lpProtection ?? "community_submitted",
        lastLedger: 0,
        updatedAt: now,
      });
    }

    return c.json({
      ok: true,
      published: true,
      reviewStatus: savedToken.reviewStatus ?? reviewStatus,
      reviewNote: savedToken.reviewNote ?? reviewNote,
      token: savedToken,
      audit,
    });
  });

  router.get("/markets/whales", async (c) => {
    const repo = c.get("repo");
    const trades = await repo.listWhaleTrades(30);
    return c.json({ ok: true, trades });
  });

  router.get("/scanner/:assetId", async (c) => {
    const config = c.get("config");
    const assetId = decodeURIComponent(c.req.param("assetId"));
    const scanner = createConfiguredScanner(config, c.env.CACHE, rawFetchFn, fetchFn);

    try {
      const audit = await scanner.auditToken(assetId);
      return c.json({ ok: true, audit });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : "Failed to scan asset" },
        400,
      );
    }
  });

  router.get("/orderbook/:pair", async (c) => {
    const config = c.get("config");
    const rawPair = decodeURIComponent(c.req.param("pair"));
    const [baseAsset = "XLM", quoteAsset = "XLM"] = rawPair.split("-");
    const snapshot = await fetchHorizonOrderbook(
      config.horizonUrls,
      baseAsset,
      quoteAsset,
      20,
      fetchFn,
    );
    const depth = computeDepthChart(snapshot);
    return c.json({ ok: true, snapshot, depth });
  });

  router.get("/candles/:pair", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const rawPair = decodeURIComponent(c.req.param("pair"));
    const tfParam = (c.req.query("tf") ?? "1h") as OhlcvTimeframe;
    const timeframe: OhlcvTimeframe = TIMEFRAMES.has(tfParam) ? tfParam : "1h";
    const [baseAsset = "XLM", quoteAsset = "XLM"] = rawPair.split("-");

    const oracleEngine = createOraclesAndChartsEngine({
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      horizonUrls: config.horizonUrls,
      sorobanCandlesLoader: async (pairId, tf, limit) => [
        ...(await repo.listCandles(pairId, tf, limit)),
      ],
      fetchFn,
    });
    const candles = await oracleEngine.getOhlcvCandles({
      pairId: rawPair,
      baseAsset,
      quoteAsset,
      timeframe,
      limit: 120,
    });
    return c.json({ ok: true, pair: rawPair, timeframe, candles });
  });

  router.get("/watchlists", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) return c.json({ error: session.error }, session.status);
    const repo = c.get("repo");
    const items = await repo.listWatchlist(session.claims.telegramUserId);
    return c.json({ ok: true, items });
  });

  router.post("/watchlists", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) return c.json({ error: session.error }, session.status);
    const body = WatchlistBodySchema.parse(await c.req.json());
    const repo = c.get("repo");
    await repo.addWatchlist(session.claims.telegramUserId, body.assetKey);
    return c.json({ ok: true, items: await repo.listWatchlist(session.claims.telegramUserId) });
  });

  router.delete("/watchlists/:assetKey", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) return c.json({ error: session.error }, session.status);
    const repo = c.get("repo");
    const removed = await repo.removeWatchlist(
      session.claims.telegramUserId,
      decodeURIComponent(c.req.param("assetKey")),
    );
    return c.json({ ok: true, removed });
  });

  router.get("/alerts", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) return c.json({ error: session.error }, session.status);
    const repo = c.get("repo");
    const alerts = await repo.listPriceAlerts(session.claims.telegramUserId);
    return c.json({ ok: true, alerts });
  });

  router.post("/alerts", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) return c.json({ error: session.error }, session.status);
    const body = AlertBodySchema.parse(await c.req.json());
    const repo = c.get("repo");
    const alert = await repo.createPriceAlert({
      id: `al_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
      telegramUserId: session.claims.telegramUserId,
      assetKey: body.assetKey,
      condition: body.condition,
      threshold: body.threshold,
      active: true,
      createdAt: Math.floor(Date.now() / 1000),
    });
    return c.json({ ok: true, alert });
  });

  router.delete("/alerts/:alertId", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) return c.json({ error: session.error }, session.status);
    const repo = c.get("repo");
    const alertId = decodeURIComponent(c.req.param("alertId"));
    const deactivated = await repo.deactivatePriceAlert(
      session.claims.telegramUserId,
      alertId,
    );
    return c.json({ ok: true, deactivated });
  });

  router.get("/orders/:address", async (c) => {
    const config = c.get("config");
    const rawAddress = decodeURIComponent(c.req.param("address")).trim();
    const parsed = StellarAddressSchema.safeParse(rawAddress);
    if (!parsed.success || !parsed.data.startsWith("G")) {
      return c.json({ ok: true, offers: [] });
    }
    const offers = await listClassicOpenOffers(config.horizonUrls, parsed.data, fetchFn);
    return c.json({ ok: true, offers });
  });

  return router;
}
