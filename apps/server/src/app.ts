import { AsyncLocalStorage } from "node:async_hooks";
import { parseServerConfig, type ServerConfig } from "@astrodex/domain";
import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
} from "@cloudflare/workers-types";
import { webhookCallback } from "grammy";
import { Hono, type Context, type Next } from "hono";
import { createAstroDexBot } from "./bot.js";
import { createD1Repository, type DexServerRepository } from "./db/repository.js";
import { createMarketRoutes } from "./routes/markets.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createProxyRoutes } from "./routes/proxy.js";
import { createTgAuthRoutes } from "./routes/tg-auth.js";
import { createTradingRoutes, type TradingRoutesDeps } from "./routes/trading.js";
import type { FetchLike } from "./stellar-verifier.js";

export interface ServiceFetcher {
  fetch: (request: Request | string, init?: RequestInit) => Promise<Response>;
}

export interface WorkersAiBinding {
  run: (model: string, input: unknown) => Promise<unknown>;
}

export interface WorkerBindings {
  DB?: D1Database;
  CACHE?: KVNamespace;
  DEX_INDEXER?: DurableObjectNamespace;
  ASTROWALLET?: ServiceFetcher;
  ASTROGATE?: ServiceFetcher;
  AI?: WorkersAiBinding;
  [key: string]: unknown;
}

const ecosystemFetchStorage = new AsyncLocalStorage<FetchLike>();

function createEcosystemFetch(
  env: WorkerBindings,
  config: ServerConfig,
  baseFetch: FetchLike,
): FetchLike {
  const walletBase = config.astroWalletApiBaseUrl?.replace(/\/+$/, "");
  const gateBase = config.astroGateApiBaseUrl?.replace(/\/+$/, "");

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (walletBase && env.ASTROWALLET && rawUrl.startsWith(walletBase)) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const requestedNet = headers.get("X-Astro-Network")?.trim().toLowerCase();
      if (requestedNet !== "testnet") {
        const pathAndQuery = rawUrl.slice(walletBase.length) || "/";
        const targetUrl = `https://astrowallet.internal${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`;
        const req =
          input instanceof Request
            ? new Request(targetUrl, input)
            : new Request(targetUrl, init);
        return env.ASTROWALLET.fetch(req);
      }
    }

    if (gateBase && env.ASTROGATE && rawUrl.startsWith(gateBase)) {
      const pathAndQuery = rawUrl.slice(gateBase.length) || "/";
      const targetUrl = `https://astrogate.internal${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`;
      const req =
        input instanceof Request
          ? new Request(targetUrl, input)
          : new Request(targetUrl, init);
      return env.ASTROGATE.fetch(req);
    }

    return baseFetch(input, init);
  }) as FetchLike;
}

export interface ServerDeps extends TradingRoutesDeps {
  createRepo?: ((env: WorkerBindings) => DexServerRepository) | undefined;
  fetchFn?: FetchLike | undefined;
}

type AppEnv = {
  Bindings: WorkerBindings;
  Variables: {
    config: ServerConfig;
    repo: DexServerRepository;
  };
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function createApp(deps: ServerDeps = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const effectiveFetch: FetchLike =
    deps.fetchFn ??
    (((input: RequestInfo | URL, init?: RequestInit) => {
      const scoped = ecosystemFetchStorage.getStore() ?? fetch;
      return scoped(input, init);
    }) as FetchLike);

  app.use("*", async (c, next) => {
    let config: ServerConfig;
    try {
      config = parseServerConfig(c.env as Record<string, unknown>);
    } catch (err) {
      return c.json(
        {
          error: "Server environment misconfigured",
          message: err instanceof Error ? err.message : "Invalid configuration",
        },
        500,
      );
    }
    c.set("config", config);

    const origin = c.req.header("Origin");
    const isOpenMetrics = c.req.path.startsWith("/v1/metrics/");
    if (origin) {
      if (isOpenMetrics) {
        c.header("Access-Control-Allow-Origin", "*");
        c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type");
      } else {
        if (!config.allowedOrigins.includes(origin)) {
          return c.json({ error: "Origin not allowed" }, 403);
        }
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Vary", "Origin");
        c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      }
      if (c.req.method === "OPTIONS") {
        return c.body(null, 204);
      }
    }

    if (!deps.fetchFn && (c.env.ASTROWALLET || c.env.ASTROGATE)) {
      const ecoFetch = createEcosystemFetch(c.env, config, fetch);
      await ecosystemFetchStorage.run(ecoFetch, () => next());
      return undefined;
    }

    await next();
    return undefined;
  });

  app.get("/health", (c) => {
    const config = c.get("config");
    return c.json({
      status: "ok",
      service: "astrodex-server",
      network: config.network,
      timestamp: new Date().toISOString(),
    });
  });

  const attachRepo = async (c: Context<AppEnv>, next: Next) => {
    if (deps.createRepo) {
      c.set("repo", deps.createRepo(c.env));
    } else if (c.env.DB) {
      c.set("repo", createD1Repository(c.env.DB));
    } else {
      return c.json({ error: "D1 binding DB is not configured" }, 500);
    }
    await next();
    return undefined;
  };

  const attachOptionalRepo = async (c: Context<AppEnv>, next: Next) => {
    if (deps.createRepo) {
      c.set("repo", deps.createRepo(c.env));
    } else if (c.env.DB) {
      c.set("repo", createD1Repository(c.env.DB));
    }
    await next();
    return undefined;
  };

  app.use("/tg/webhook", attachRepo);
  app.use("/v1/*", attachRepo);
  app.use("/v1/proxy/*", attachOptionalRepo);
  app.use("/mcp", attachOptionalRepo);

  app.use("/v1/markets/overview", async (c, next) => {
    const config = c.get("config");
    if (c.env.DEX_INDEXER) {
      try {
        const id = c.env.DEX_INDEXER.idFromName(`dex:${config.network}`);
        const stub = c.env.DEX_INDEXER.get(id);
        c.executionCtx.waitUntil(
          stub.fetch("https://dex-indexer.internal/ensure", { method: "POST" }).catch(() => {}),
        );
      } catch {
        // Ignore when running outside Cloudflare Worker ExecutionContext (e.g. Vitest)
      }
    }
    await next();
    return undefined;
  });

  app.post("/tg/webhook", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const secretHeader = c.req.header("X-Telegram-Bot-Api-Secret-Token");
    if (!secretHeader || !constantTimeEqual(secretHeader, config.tgWebhookSecret)) {
      return c.json({ error: "Unauthorized Telegram webhook request" }, 401);
    }

    if (c.env.DEX_INDEXER) {
      const id = c.env.DEX_INDEXER.idFromName(`dex:${config.network}`);
      const stub = c.env.DEX_INDEXER.get(id);
      c.executionCtx.waitUntil(
        stub.fetch("https://dex-indexer.internal/ensure", { method: "POST" }).catch(() => {}),
      );
    }

    let updateId: number | undefined;
    try {
      const bodyCopy = (await c.req.raw.clone().json()) as { update_id?: unknown };
      if (typeof bodyCopy.update_id === "number" && Number.isInteger(bodyCopy.update_id)) {
        updateId = bodyCopy.update_id;
      }
    } catch {
      // Let grammY reject malformed JSON
    }
    if (updateId !== undefined) {
      const claimed = await repo.claimTelegramUpdateId(updateId);
      if (!claimed) {
        return c.json({ ok: true, duplicate: true }, 200);
      }
    }

    const bot = createAstroDexBot(config, repo, { fetchFn: effectiveFetch });
    const handler = webhookCallback(bot, "hono");
    return handler(c);
  });

  app.route("/v1", createTgAuthRoutes({ fetchFn: effectiveFetch }));
  app.route("/v1", createMetricsRoutes());
  app.route("/v1", createMarketRoutes({ fetchFn: effectiveFetch }));
  app.route(
    "/v1",
    createTradingRoutes({ fetchFn: effectiveFetch, verifyTxFn: deps.verifyTxFn }),
  );
  app.route("/v1/proxy", createProxyRoutes({ fetchFn: effectiveFetch }));
  app.route("/", createMcpRoutes({ fetchFn: effectiveFetch }));

  return app;
}
