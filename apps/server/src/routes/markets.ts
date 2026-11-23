import {
  computeDepthChart,
  fetchHorizonOrderbook,
  listClassicOpenOffers,
} from "@astrodex/dex-aggregator";
import {
  normalizeAssetIdentifier,
  StellarAddressSchema,
  type OhlcvTimeframe,
  type ServerConfig,
  type TokenForensicAudit,
  type TokenReviewStatus,
} from "@astrodex/domain";
import { createOraclesAndChartsEngine } from "@astrodex/oracles-and-charts";
import { createStellarForensicScanner } from "@astrodex/stellar-scanner";
import type { KVNamespace } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { z } from "zod";
import type { WorkersAiBinding } from "../app.js";
import type { DexServerRepository, DexTokenRecord } from "../db/repository.js";
import { checkRateLimit, clientKeyFromHeaders } from "../rate-limit.js";
import {
  buildUnifiedCatalog,
  fetchTokenAmmPools,
  fetchTokenRecentTrades,
  fetchTokenTopHolders,
  fetchWalletPortfolio,
  loadLiveAmmOrderbookAndSpot,
  resolveAssetTarget,
  resolveReadFeedConfig,
  searchCatalogAndNetworkAssets,
} from "../services/catalog.js";
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
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const cacheKey = `markets:overview:${config.network}`;
    const nowMs = Date.now();
    if (c.env.CACHE) {
      const cachedRaw = await c.env.CACHE.get(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as {
            cachedAt?: number;
            payload?: Record<string, unknown>;
          };
          if (
            cached.payload &&
            typeof cached.cachedAt === "number" &&
            nowMs - cached.cachedAt < 25_000
          ) {
            c.header("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
            c.header("X-AstroDex-Cache", "HIT");
            return c.json(cached.payload);
          }
        } catch {
          // Ignore corrupt cache entry
        }
      }
    }

    const includeRepoTokens = config.network === baseConfig.network;
    const repo = c.get("repo");
    const snapshot = await buildUnifiedCatalog(config, repo, fetchFn, { includeRepoTokens });
    const usdcIssuer = snapshot.sep42Assets.find(
      (a) => a.code.toUpperCase() === "USDC" && a.issuer,
    )?.issuer;

    let oracle = await createOraclesAndChartsEngine({
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      horizonUrls: config.horizonUrls,
      chainlinkPriceProxyContractId: config.chainlinkPriceProxyContractId,
      reflectorDexOracleContractId: config.reflectorDexOracleContractId,
      xlmSacContractId: config.xlmSacContractId,
      stellarPricesApiBase: config.stellarPricesApiBase,
      stellarPricesApiKey: config.stellarPricesApiKey,
      usdcIssuer,
      fetchFn,
    })
      .getXlmUsdPrice()
      .catch(() => null);

    if ((!oracle || oracle.priceUsd <= 0) && usdcIssuer) {
      const usdcAsset = snapshot.catalog.find(
        (t) => t.code.toUpperCase() === "USDC" && t.issuer === usdcIssuer,
      );
      if (usdcAsset) {
        const [{ target: baseT }, { target: quoteT }] = await Promise.all([
          resolveAssetTarget({ config, repo, fetchFn, rawAsset: "XLM", snapshot }),
          resolveAssetTarget({ config, repo, fetchFn, rawAsset: usdcAsset.assetKey, snapshot }),
        ]);
        const amm = await loadLiveAmmOrderbookAndSpot({
          config,
          snapshot,
          baseTarget: baseT,
          quoteTarget: quoteT,
          fetchFn,
        }).catch(() => null);
        if (amm?.ammPairInfo && amm.ammPairInfo.spotPriceQuotePerBase > 0 && amm.ammPairInfo.spotPriceQuotePerBase < 100) {
          oracle = {
            assetKey: "XLM",
            priceUsd: Number(amm.ammPairInfo.spotPriceQuotePerBase.toFixed(6)),
            source: "horizon_spot",
            updatedAtUnix: Math.floor(Date.now() / 1000),
          };
        }
      }
    }

    const payload = {
      ok: true,
      network: config.network,
      xlmUsd: oracle,
      tokens: snapshot.tokens,
      pairs: snapshot.pairs,
      launchpadTokens: snapshot.launchpadTokens,
      catalog: snapshot.catalog,
    };
    if (c.env.CACHE) {
      await c.env.CACHE.put(
        cacheKey,
        JSON.stringify({ cachedAt: Date.now(), payload }),
        { expirationTtl: 60 },
      );
    }
    c.header("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    c.header("X-AstroDex-Cache", "MISS");
    return c.json(payload);
  });

  router.get("/markets/search", async (c) => {
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const includeRepoTokens = config.network === baseConfig.network;
    const repo = c.get("repo");
    const q = (c.req.query("q") ?? "").trim();
    const limitParam = Number(c.req.query("limit") ?? "15");
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(30, Math.trunc(limitParam))) : 15;
    const cacheKey =
      q.length <= 24 ? `markets:search:${config.network}:${q.toLowerCase()}:${limit}` : null;
    if (cacheKey && c.env.CACHE) {
      const cachedRaw = await c.env.CACHE.get(cacheKey);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw) as {
            cachedAt?: number;
            payload?: Record<string, unknown>;
          };
          if (
            cached.payload &&
            typeof cached.cachedAt === "number" &&
            Date.now() - cached.cachedAt < 20_000
          ) {
            c.header("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
            return c.json(cached.payload);
          }
        } catch {
          // Ignore corrupt cache entry
        }
      }
    }
    const { results } = await searchCatalogAndNetworkAssets({
      config,
      repo,
      fetchFn,
      query: q,
      limit,
      includeRepoTokens,
    });
    const payload = { ok: true, network: config.network, query: q, results };
    if (cacheKey && c.env.CACHE) {
      await c.env.CACHE.put(
        cacheKey,
        JSON.stringify({ cachedAt: Date.now(), payload }),
        { expirationTtl: 60 },
      );
    }
    c.header("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    return c.json(payload);
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

    const { target } = await resolveAssetTarget({
      config,
      repo,
      fetchFn,
      rawAsset: body.assetId,
    });

    const scanner = createConfiguredScanner(config, c.env.CACHE, rawFetchFn, fetchFn);
    let audit: TokenForensicAudit;
    try {
      audit = await scanner.auditToken(target.resolvedKey);
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
    const pairId = body.pairId?.trim() || audit.sorobanAudit?.astroGate?.pairId || target.pairId || undefined;

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
    if (c.env.CACHE) {
      await c.env.CACHE.delete(`markets:overview:${config.network}`).catch(() => undefined);
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
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const includeRepoTokens = config.network === baseConfig.network;
    const repo = c.get("repo");
    const rawAssetId = decodeURIComponent(c.req.param("assetId"));
    const { target } = await resolveAssetTarget({
      config,
      repo,
      fetchFn,
      rawAsset: rawAssetId,
      includeRepoTokens,
    });
    const scanner = createConfiguredScanner(config, c.env.CACHE, rawFetchFn, fetchFn);

    try {
      const audit = await scanner.auditToken(target.resolvedKey);
      return c.json({ ok: true, network: config.network, audit, resolvedFrom: rawAssetId });
    } catch (err) {
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : "Failed to scan asset" },
        400,
      );
    }
  });

  router.get("/orderbook/:pair", async (c) => {
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const includeRepoTokens = config.network === baseConfig.network;
    const repo = c.get("repo");
    const rawPair = decodeURIComponent(c.req.param("pair"));
    const [rawBase = "XLM", rawQuote = "XLM"] = rawPair.split("-");
    const snapshot = await buildUnifiedCatalog(config, repo, fetchFn, { includeRepoTokens });
    const [{ target: baseTarget }, { target: quoteTarget }] = await Promise.all([
      resolveAssetTarget({ config, repo, fetchFn, rawAsset: rawBase, snapshot }),
      resolveAssetTarget({ config, repo, fetchFn, rawAsset: rawQuote, snapshot }),
    ]);

    const horizonBase = baseTarget.classicAsset ?? baseTarget.resolvedKey;
    const horizonQuote = quoteTarget.classicAsset ?? quoteTarget.resolvedKey;

    const [horizonSnapshot, ammResult] = await Promise.all([
      fetchHorizonOrderbook(config.horizonUrls, horizonBase, horizonQuote, 20, fetchFn),
      loadLiveAmmOrderbookAndSpot({
        config,
        snapshot,
        baseTarget,
        quoteTarget,
        fetchFn,
      }).catch(() => ({ ammPairInfo: null, syntheticSnapshot: null })),
    ]);

    const hasHorizonDepth =
      horizonSnapshot.bids.length > 0 || horizonSnapshot.asks.length > 0;
    const effectiveSnapshot =
      !hasHorizonDepth && ammResult.syntheticSnapshot
        ? ammResult.syntheticSnapshot
        : horizonSnapshot;
    const depth = computeDepthChart(effectiveSnapshot);
    return c.json({
      ok: true,
      network: config.network,
      snapshot: effectiveSnapshot,
      depth,
      ammPair: ammResult.ammPairInfo,
    });
  });

  router.get("/candles/:pair", async (c) => {
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const includeRepoTokens = config.network === baseConfig.network;
    const repo = c.get("repo");
    const rawPair = decodeURIComponent(c.req.param("pair"));
    const tfParam = (c.req.query("tf") ?? "1h") as OhlcvTimeframe;
    const timeframe: OhlcvTimeframe = TIMEFRAMES.has(tfParam) ? tfParam : "1h";
    const [rawBase = "XLM", rawQuoteParam = "XLM"] = rawPair.split("-");
    const rawQuote =
      rawBase.toUpperCase() === "XLM" && rawQuoteParam.toUpperCase() === "XLM"
        ? config.network === "mainnet"
          ? "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
          : "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        : rawQuoteParam;

    const snapshot = await buildUnifiedCatalog(config, repo, fetchFn, { includeRepoTokens });
    const [{ target: baseTarget }, { target: quoteTarget }] = await Promise.all([
      resolveAssetTarget({ config, repo, fetchFn, rawAsset: rawBase, snapshot }),
      resolveAssetTarget({ config, repo, fetchFn, rawAsset: rawQuote, snapshot }),
    ]);

    const oracleEngine = createOraclesAndChartsEngine({
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      horizonUrls: config.horizonUrls,
      fallbackContractId: baseTarget.sorobanContractId ?? baseTarget.catalogItem?.sacId,
      sorobanCandlesLoader: includeRepoTokens
        ? async (pairId, tf, limit) => [...(await repo.listCandles(pairId, tf, limit))]
        : undefined,
      spotMidPriceLoader: async () => {
        const amm = await loadLiveAmmOrderbookAndSpot({
          config,
          snapshot,
          baseTarget,
          quoteTarget,
          fetchFn,
        });
        return amm.ammPairInfo?.spotPriceQuotePerBase ?? null;
      },
      fetchFn,
    });
    const candles = await oracleEngine.getOhlcvCandles({
      pairId: rawPair,
      baseAsset: baseTarget.classicAsset ?? baseTarget.resolvedKey,
      quoteAsset: quoteTarget.classicAsset ?? quoteTarget.resolvedKey,
      timeframe,
      limit: 120,
    });
    return c.json({ ok: true, network: config.network, pair: rawPair, timeframe, candles });
  });

  router.get("/token-hub/:assetId", async (c) => {
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const includeRepoTokens = config.network === baseConfig.network;
    const repo = c.get("repo");
    const rawAssetId = decodeURIComponent(c.req.param("assetId"));
    const quoteParam = c.req.query("quote");

    const snapshot = await buildUnifiedCatalog(config, repo, fetchFn, { includeRepoTokens });
    const { target } = await resolveAssetTarget({
      config,
      repo,
      fetchFn,
      rawAsset: rawAssetId,
      snapshot,
    });

    const defaultQuote =
      quoteParam ??
      (target.resolvedKey === "XLM"
        ? config.network === "mainnet"
          ? "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
          : "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        : "XLM");

    const { target: quoteTarget } = await resolveAssetTarget({
      config,
      repo,
      fetchFn,
      rawAsset: defaultQuote,
      snapshot,
    });

    const scanner = createConfiguredScanner(config, c.env.CACHE, rawFetchFn, fetchFn);
    const targetNorm = normalizeAssetIdentifier(target.resolvedKey);
    const catalogItem =
      snapshot.catalog.find(
        (item) =>
          item.assetKey.toUpperCase() === target.resolvedKey.toUpperCase() ||
          item.sacId?.toUpperCase() === target.resolvedKey.toUpperCase() ||
          (target.classicAsset && item.assetKey.toUpperCase() === target.classicAsset.toUpperCase()) ||
          item.code.toUpperCase() === targetNorm.code.toUpperCase(),
      ) ?? null;

    const [ammPools, recentTrades, orderbookRes, ammInfo, audit, topHolders] = await Promise.all([
      fetchTokenAmmPools({ config, target, snapshot, fetchFn, limit: 20 }),
      fetchTokenRecentTrades({
        config,
        baseTarget: target,
        quoteTarget,
        fetchFn,
        limit: 15,
      }),
      fetchHorizonOrderbook(
        config.horizonUrls,
        target.classicAsset ?? target.resolvedKey,
        quoteTarget.classicAsset ?? quoteTarget.resolvedKey,
        20,
        fetchFn,
      ).catch(() => null),
      loadLiveAmmOrderbookAndSpot({
        config,
        snapshot,
        baseTarget: target,
        quoteTarget,
        fetchFn,
      }).catch(() => ({ ammPairInfo: null, syntheticSnapshot: null })),
      scanner
        .auditToken(target.classicAsset ?? target.sorobanContractId ?? target.resolvedKey)
        .catch(() => null),
      fetchTokenTopHolders({ config, target, fetchFn, limit: 15 }).catch(() => []),
    ]);

    const orderbook =
      orderbookRes && (orderbookRes.bids.length > 0 || orderbookRes.asks.length > 0)
        ? orderbookRes
        : ammInfo.syntheticSnapshot;
    const depth = orderbook ? computeDepthChart(orderbook) : null;

    const marketStats = {
      priceUsd: catalogItem?.priceUsd ?? null,
      change24hPct: catalogItem?.change24hPct ?? null,
      change7dPct: catalogItem?.change7dPct ?? null,
      volume7dUsd: catalogItem?.volume7dUsd ?? null,
      marketCapUsd: catalogItem?.marketCapUsd ?? null,
      holdersCount: catalogItem?.holdersCount ?? null,
      tradesCount: catalogItem?.tradesCount ?? null,
      rating: catalogItem?.rating ?? null,
      domain: catalogItem?.domain ?? null,
      sparkline7d: catalogItem?.sparkline7d ?? null,
    };

    return c.json({
      ok: true,
      network: config.network,
      assetId: target.resolvedKey,
      quoteAssetId: quoteTarget.resolvedKey,
      catalogItem,
      target,
      marketStats,
      topHolders,
      ammPools,
      ammPairInfo: ammInfo.ammPairInfo,
      orderbook,
      depth,
      recentTrades,
      audit,
    });
  });

  router.get("/portfolio/:address", async (c) => {
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const address = decodeURIComponent(c.req.param("address"));
    const parsedAddr = StellarAddressSchema.safeParse(address);
    if (!parsedAddr.success) {
      return c.json({ error: "Invalid Stellar G... address" }, 400);
    }

    const [portfolio, openOffers] = await Promise.all([
      fetchWalletPortfolio({ config, address: parsedAddr.data, fetchFn }),
      listClassicOpenOffers(config.horizonUrls, parsedAddr.data, fetchFn).catch(() => []),
    ]);

    return c.json({
      ok: true,
      network: config.network,
      address: parsedAddr.data,
      balances: portfolio.balances,
      lpPositions: portfolio.lpPositions,
      openOffers,
    });
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
    const baseConfig = c.get("config");
    const config = resolveReadFeedConfig(baseConfig, c.req.query("net"));
    const rawAddress = decodeURIComponent(c.req.param("address")).trim();
    const parsed = StellarAddressSchema.safeParse(rawAddress);
    if (!parsed.success || !parsed.data.startsWith("G")) {
      return c.json({ ok: true, network: config.network, accountFunded: false, offers: [] });
    }
    const checkAccountFunded = async (): Promise<boolean> => {
      for (const base of config.horizonUrls) {
        const clean = base.replace(/\/+$/, "");
        try {
          const res = await fetchFn(`${clean}/accounts/${encodeURIComponent(parsed.data)}`, {
            headers: { Accept: "application/json" },
          });
          if (res.ok) return true;
          if (res.status === 404) return false;
        } catch {
          // Fail over to next Horizon URL
        }
      }
      return true;
    };
    const [offers, accountFunded] = await Promise.all([
      listClassicOpenOffers(config.horizonUrls, parsed.data, fetchFn),
      checkAccountFunded(),
    ]);
    return c.json({ ok: true, network: config.network, accountFunded, offers });
  });

  return router;
}
