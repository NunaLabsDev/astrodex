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
import { createProxyRoutes } from "./routes/proxy.js";
import { createTgAuthRoutes } from "./routes/tg-auth.js";
import { createTradingRoutes, type TradingRoutesDeps } from "./routes/trading.js";
import type { FetchLike } from "./stellar-verifier.js";

export interface WorkerBindings {
  DB?: D1Database;
  CACHE?: KVNamespace;
  DEX_INDEXER?: DurableObjectNamespace;
  [key: string]: unknown;
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
    if (origin) {
      if (!config.allowedOrigins.includes(origin)) {
        return c.json({ error: "Origin not allowed" }, 403);
      }
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (c.req.method === "OPTIONS") {
        return c.body(null, 204);
      }
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

    const bot = createAstroDexBot(config, repo, { fetchFn: deps.fetchFn });
    const handler = webhookCallback(bot, "hono");
    return handler(c);
  });

  app.route("/v1", createTgAuthRoutes({ fetchFn: deps.fetchFn }));
  app.route("/v1", createMarketRoutes({ fetchFn: deps.fetchFn }));
  app.route(
    "/v1",
    createTradingRoutes({ fetchFn: deps.fetchFn, verifyTxFn: deps.verifyTxFn }),
  );
  app.route("/v1/proxy", createProxyRoutes({ fetchFn: deps.fetchFn }));
  app.route("/", createMcpRoutes({ fetchFn: deps.fetchFn }));

  return app;
}
