import type { ServerConfig } from "@astrodex/domain";
import { Hono } from "hono";
import type { DexServerRepository } from "../db/repository.js";

export function utcDayString(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Computes a monthly-salted SHA-256 user hash so DAU/WAU/MAU can be measured
 * over a rolling 30-day window without storing or exposing raw Telegram IDs.
 */
export async function computeMonthlyUserHash(
  telegramUserId: string,
  secret: string,
  dayUtc = utcDayString(),
): Promise<string> {
  const month = dayUtc.slice(0, 7);
  const raw = `astrodex_dau:${telegramUserId}:${month}:${secret}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

export type MetricsRouteEnv = {
  Variables: {
    config: ServerConfig;
    repo: DexServerRepository;
  };
};

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createMetricsRoutes(): Hono<MetricsRouteEnv> {
  const router = new Hono<MetricsRouteEnv>();

  router.get("/metrics/public", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const snapshot = await repo.getPublicMetricsSnapshot(config.network);

    c.header("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    return c.json({
      ok: true,
      service: "astrodex",
      network: config.network,
      generatedAt: new Date().toISOString(),
      privacy: {
        cookies: false,
        thirdPartyTrackers: false,
        piiExposed: false,
        hashing: "monthly-salted-sha256",
      },
      ecosystem: {
        tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
        astroWalletApiBaseUrl: config.astroWalletApiBaseUrl ?? null,
      },
      metrics: snapshot,
    });
  });

  router.get("/metrics/badge.svg", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const snapshot = await repo.getPublicMetricsSnapshot(config.network);
    const value = `${snapshot.mau} MAU · ${snapshot.verifiedTxCount} TXs`;
    const label = "AstroDex";
    const leftW = 72;
    const rightW = Math.max(96, value.length * 7 + 16);
    const totalW = leftW + rightW;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-opacity=".12"/></linearGradient>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftW}" height="20" fill="#172C69"/>
    <rect x="${leftW}" width="${rightW}" height="20" fill="#10B981"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${leftW / 2}" y="14">${escapeXml(label)}</text>
    <text x="${leftW + rightW / 2}" y="14" font-weight="bold">${escapeXml(value)}</text>
  </g>
</svg>`;

    c.header("Content-Type", "image/svg+xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return c.body(svg, 200);
  });

  return router;
}
