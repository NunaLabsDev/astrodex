import type { ServerConfig } from "@astrodex/domain";
import {
  createAstroIdResolver,
  signMiniAppSessionToken,
  verifyMiniAppSessionToken,
  verifyTelegramInitData,
  type MiniAppSessionClaims,
} from "@astrodex/tg-protocol";
import { Hono } from "hono";
import { z } from "zod";
import type { DexServerRepository } from "../db/repository.js";
import { adaptFetch, type FetchLike } from "../stellar-verifier.js";
import { computeMonthlyUserHash, utcDayString } from "./metrics.js";

const TgAuthBodySchema = z.object({
  initData: z.string().trim().min(1).max(8192),
  platform: z.string().trim().max(32).optional(),
  lang: z.string().trim().max(16).optional(),
});

const MINI_APP_SESSION_TTL_SECONDS = 15 * 60;

export type TgAuthRouteEnv = {
  Variables: {
    config: ServerConfig;
    repo: DexServerRepository;
  };
};

export async function authenticateMiniAppSession(c: {
  req: { header(name: string): string | undefined };
  get(key: "config"): ServerConfig;
}): Promise<
  | { ok: true; claims: MiniAppSessionClaims }
  | { ok: false; status: 401 | 403; error: string }
> {
  const authHeader = c.req.header("Authorization")?.trim() ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "Missing Bearer session token" };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, error: "Empty Bearer session token" };
  }
  const config = c.get("config");
  const result = await verifyMiniAppSessionToken(
    token,
    config.network,
    config.intentHmacSecret,
  );
  if (!result.valid) {
    return {
      ok: false,
      status: result.reason === "wrong_network" ? 403 : 401,
      error: `Mini App session ${result.reason}`,
    };
  }
  return { ok: true, claims: result.claims };
}

export function createTgAuthRoutes(deps: { fetchFn?: FetchLike | undefined } = {}): Hono<TgAuthRouteEnv> {
  const router = new Hono<TgAuthRouteEnv>();
  const fetchFn = adaptFetch(deps.fetchFn ?? fetch);

  router.post("/tg/auth", async (c) => {
    const config = c.get("config");
    let body: z.infer<typeof TgAuthBodySchema>;
    try {
      body = TgAuthBodySchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        {
          error: "Invalid Telegram initData request",
          details: err instanceof Error ? err.message : undefined,
        },
        400,
      );
    }

    const verified = await verifyTelegramInitData(body.initData, config.tgBotToken, {
      maxAgeSeconds: 300,
    });
    if (!verified.valid) {
      return c.json({ error: `Telegram initData ${verified.reason}` }, 401);
    }

    const tgUser = verified.data.user;
    const repo = c.get("repo");
    const dayUtc = utcDayString();
    const userHash = await computeMonthlyUserHash(
      tgUser.id,
      config.intentHmacSecret,
      dayUtc,
    );
    await Promise.all([
      repo.recordDailyUserActivity({
        dayUtc,
        userHash,
        network: config.network,
        platform: body.platform,
        lang: body.lang,
      }),
      repo.incrementProductEvent({
        dayUtc,
        network: config.network,
        eventType: "dex_open",
      }),
    ]);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + MINI_APP_SESSION_TTL_SECONDS;
    const sessionToken = await signMiniAppSessionToken(
      {
        telegramUserId: tgUser.id,
        usernameLower: tgUser.usernameLower,
        network: config.network,
        issuedAt: now,
        expiresAt,
      },
      config.intentHmacSecret,
    );

    const resolver = createAstroIdResolver({
      astroWalletApiBaseUrl: config.astroWalletApiBaseUrl,
      astroGateApiBaseUrl: config.astroGateApiBaseUrl,
      fetchFn,
    });
    const astroId = await resolver.resolveIdentity(tgUser.id);

    return c.json({
      sessionToken,
      expiresAt,
      user: tgUser,
      startParam: verified.data.startParam,
      astroId,
    });
  });

  router.post("/tg/refresh", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) {
      return c.json({ error: session.error }, session.status);
    }
    const config = c.get("config");
    const repo = c.get("repo");
    const rl = await repo.incrementRateLimit({
      key: `tg_refresh:${session.claims.telegramUserId}`,
      windowSec: 60,
      limit: 10,
    });
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSeconds));
      return c.json({ error: "Too many session refresh requests" }, 429);
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + MINI_APP_SESSION_TTL_SECONDS;
    const sessionToken = await signMiniAppSessionToken(
      {
        telegramUserId: session.claims.telegramUserId,
        usernameLower: session.claims.usernameLower,
        network: config.network,
        issuedAt: now,
        expiresAt,
      },
      config.intentHmacSecret,
    );
    return c.json({ sessionToken, expiresAt });
  });

  router.get("/wallet/resolve", async (c) => {
    const config = c.get("config");
    const q = (c.req.query("q") ?? "").trim();
    if (!q) {
      return c.json({ error: "Query parameter q is required" }, 400);
    }
    const resolver = createAstroIdResolver({
      astroWalletApiBaseUrl: config.astroWalletApiBaseUrl,
      astroGateApiBaseUrl: config.astroGateApiBaseUrl,
      fetchFn,
    });
    const profile = await resolver.resolveIdentity(q);
    return c.json({ ok: true, ...profile });
  });

  return router;
}
