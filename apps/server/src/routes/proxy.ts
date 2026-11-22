import type { ServerConfig } from "@astrodex/domain";
import type { KVNamespace } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { z } from "zod";
import type { DexServerRepository } from "../db/repository.js";
import { checkRateLimit, clientKeyFromHeaders } from "../rate-limit.js";
import type { FetchLike } from "../stellar-verifier.js";

const SAFE_PUBLIC_DOMAIN_REGEX =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const BLOCKED_DOMAIN_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".arpa",
  ".home",
  ".lan",
  ".corp",
  ".test",
  ".invalid",
];
const STELLAR_TOML_MAX_BYTES = 128 * 1024;
const MAX_TOML_REDIRECTS = 2;

const SoroswapProxyQuoteSchema = z.object({
  fromAsset: z.string().min(1).max(80),
  toAsset: z.string().min(1).max(80),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
  slippageBps: z.number().int().min(1).max(5000).default(50),
  sourceAddress: z.string().optional(),
});

export type ProxyRouteEnv = {
  Bindings: {
    CACHE?: KVNamespace;
  };
  Variables: {
    config: ServerConfig;
    repo?: DexServerRepository;
  };
};

export function isSafePublicDomain(domain: string): boolean {
  if (!SAFE_PUBLIC_DOMAIN_REGEX.test(domain)) return false;
  if (domain === "localhost") return false;
  if (BLOCKED_DOMAIN_SUFFIXES.some((s) => domain.endsWith(s))) return false;
  const labels = domain.split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (/^\d+$/.test(tld)) return false;
  return true;
}

export function isBlockedIpLiteral(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (clean === "localhost" || clean === "::1") return true;
  if (/^127\./.test(clean) || /^10\./.test(clean) || /^192\.168\./.test(clean)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(clean)) return true;
  if (/^169\.254\./.test(clean) || /^0\./.test(clean)) return true;
  if (/^fe80:/i.test(clean) || /^fc00:/i.test(clean) || /^fd00:/i.test(clean)) return true;
  return false;
}

export async function fetchStellarTomlSafe(
  domain: string,
  cache: KVNamespace | undefined,
  fetchFn: FetchLike = fetch,
): Promise<{ ok: true; domain: string; toml: string } | { ok: false; status: number; error: string }> {
  const cleanDomain = domain.trim().toLowerCase();
  if (!isSafePublicDomain(cleanDomain) || isBlockedIpLiteral(cleanDomain)) {
    return { ok: false, status: 400, error: "Unsafe or invalid public home_domain" };
  }

  const cacheKey = `toml:${cleanDomain}`;
  if (cache) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { ok: true, domain: cleanDomain, toml: cached };
    }
  }

  let currentUrl = `https://${cleanDomain}/.well-known/stellar.toml`;
  for (let hop = 0; hop <= MAX_TOML_REDIRECTS; hop += 1) {
    const res = await fetchFn(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/plain, application/toml" },
      ...(typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? { signal: AbortSignal.timeout(5_000) }
        : {}),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("Location");
      if (!location || hop >= MAX_TOML_REDIRECTS) {
        return { ok: false, status: 502, error: "Redirect limit exceeded for stellar.toml" };
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return { ok: false, status: 400, error: "Malformed redirect URL" };
      }
      if (
        nextUrl.protocol !== "https:" ||
        !isSafePublicDomain(nextUrl.hostname) ||
        isBlockedIpLiteral(nextUrl.hostname)
      ) {
        return { ok: false, status: 403, error: "SSRF redirect target blocked" };
      }
      currentUrl = nextUrl.toString();
      continue;
    }

    if (!res.ok) {
      return { ok: false, status: 404, error: "stellar.toml not found" };
    }

    const contentLength = Number(res.headers.get("Content-Length") ?? "0");
    if (contentLength > STELLAR_TOML_MAX_BYTES) {
      return { ok: false, status: 413, error: "stellar.toml exceeds 128 KB limit" };
    }

    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > STELLAR_TOML_MAX_BYTES) {
      return { ok: false, status: 413, error: "stellar.toml exceeds 128 KB limit" };
    }

    if (cache) {
      await cache.put(cacheKey, text, { expirationTtl: 1_800 });
    }
    return { ok: true, domain: cleanDomain, toml: text };
  }

  return { ok: false, status: 502, error: "Failed to resolve stellar.toml" };
}

export function createProxyRoutes(deps: { fetchFn?: FetchLike | undefined } = {}): Hono<ProxyRouteEnv> {
  const router = new Hono<ProxyRouteEnv>();
  const fetchFn = deps.fetchFn ?? fetch;

  router.get("/stellar-toml", async (c) => {
    const config = c.get("config");
    const rl = await checkRateLimit({
      repository: c.get("repo"),
      cache: c.env.CACHE,
      scope: "proxy_toml",
      clientKey: clientKeyFromHeaders(c.req.raw.headers),
      limitPerMin: config.proxyRateLimitPerMin,
    });
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSeconds));
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const domain = c.req.query("domain") ?? "";
    const result = await fetchStellarTomlSafe(domain, c.env.CACHE, fetchFn);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 403 | 404 | 413 | 502);
    }
    return c.json({ ok: true, domain: result.domain, toml: result.toml });
  });

  router.get("/directory/:address", async (c) => {
    const config = c.get("config");
    const address = c.req.param("address").trim();
    if (!/^[GC][A-Z2-7]{55}$/.test(address)) {
      return c.json({ error: "Invalid Stellar G... or C... address" }, 400);
    }
    const cacheKey = `dir:${config.network}:${address}`;
    if (c.env.CACHE) {
      const hit = await c.env.CACHE.get(cacheKey);
      if (hit) {
        return c.json(JSON.parse(hit) as unknown);
      }
    }
    if (!config.stellarExpertApiBase) {
      return c.json({ address, tags: [], memoRequired: false });
    }
    const netSlug = config.network === "mainnet" ? "public" : "testnet";
    const base = config.stellarExpertApiBase.replace(/\/+$/, "");
    try {
      const res = await fetchFn(
        `${base}/explorer/${netSlug}/directory/${encodeURIComponent(address)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        return c.json({ address, tags: [], memoRequired: false });
      }
      const raw = (await res.json()) as { address?: string; name?: string; tags?: string[] };
      const tags = Array.isArray(raw.tags) ? raw.tags : [];
      const payload = {
        address: raw.address ?? address,
        name: raw.name,
        tags,
        memoRequired: tags.includes("exchange"),
      };
      if (c.env.CACHE) {
        await c.env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 600 });
      }
      return c.json(payload);
    } catch {
      return c.json({ address, tags: [], memoRequired: false });
    }
  });

  router.post("/soroswap/quote", async (c) => {
    const config = c.get("config");
    const rl = await checkRateLimit({
      repository: c.get("repo"),
      cache: c.env.CACHE,
      scope: "proxy_soroswap",
      clientKey: clientKeyFromHeaders(c.req.raw.headers),
      limitPerMin: config.quoteRateLimitPerMin,
    });
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSeconds));
      return c.json({ error: "Quote rate limit exceeded" }, 429);
    }

    let body: z.infer<typeof SoroswapProxyQuoteSchema>;
    try {
      body = SoroswapProxyQuoteSchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        { error: "Invalid Soroswap quote request", details: err instanceof Error ? err.message : undefined },
        400,
      );
    }

    if (!config.soroswapApiBase || !config.soroswapApiKey) {
      return c.json({ ok: false, error: "Soroswap API proxy not configured for this environment" }, 503);
    }

    const base = config.soroswapApiBase.replace(/\/+$/, "");
    const res = await fetchFn(`${base}/quote?network=${config.network}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.soroswapApiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return c.json({ ok: false, error: `Soroswap upstream error (${res.status})` }, 502);
    }
    const quoteJson = (await res.json()) as Record<string, unknown>;
    return c.json({ ok: true, ...quoteJson });
  });

  return router;
}
