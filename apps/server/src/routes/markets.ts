import { computeDepthChart, fetchHorizonOrderbook } from "@astrodex/dex-aggregator";
import type { OhlcvTimeframe, ServerConfig } from "@astrodex/domain";
import { createOraclesAndChartsEngine } from "@astrodex/oracles-and-charts";
import { createStellarForensicScanner } from "@astrodex/stellar-scanner";
import type { KVNamespace } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { z } from "zod";
import type { DexServerRepository } from "../db/repository.js";
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

const TIMEFRAMES = new Set<OhlcvTimeframe>(["1m", "5m", "15m", "1h", "4h", "1d"]);

export type MarketRouteEnv = {
  Bindings: {
    CACHE?: KVNamespace;
  };
  Variables: {
    config: ServerConfig;
    repo: DexServerRepository;
  };
};

export function createMarketRoutes(deps: { fetchFn?: FetchLike | undefined } = {}): Hono<MarketRouteEnv> {
  const router = new Hono<MarketRouteEnv>();
  const rawFetchFn = deps.fetchFn ?? fetch;
  const fetchFn = adaptFetch(rawFetchFn);

  router.get("/markets/overview", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const [tokens, pairs, oracle] = await Promise.all([
      repo.listTokens(40),
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

    return c.json({
      ok: true,
      network: config.network,
      xlmUsd: oracle,
      tokens,
      pairs,
      launchpadTokens,
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
    const scanner = createStellarForensicScanner({
      network: config.network,
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      horizonUrls: config.horizonUrls,
      sep42AssetListUrls: config.sep42AssetListUrls,
      stellarExpertApiBase: config.stellarExpertApiBase,
      astroGateApiBaseUrl: config.astroGateApiBaseUrl,
      stellarRegistryApiBase: config.stellarRegistryApiBase,
      stellarTomlProxyFetcher: async (domain) => {
        const res = await fetchStellarTomlSafe(domain, c.env.CACHE, rawFetchFn);
        return res.ok ? res.toml : null;
      },
      fetchFn,
    });

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

  return router;
}
