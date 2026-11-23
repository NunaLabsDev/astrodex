import {
  computeDepthChart,
  createSmartLiquidityRouter,
  fetchHorizonOrderbook,
} from "@astrodex/dex-aggregator";
import type { ServerConfig } from "@astrodex/domain";
import { createStellarForensicScanner } from "@astrodex/stellar-scanner";
import { Hono } from "hono";
import { createInMemoryRepository, type DexServerRepository } from "../db/repository.js";
import {
  buildUnifiedCatalog,
  createConfiguredCurveStateLoader,
  createConfiguredPairReservesLoader,
  loadLiveAmmOrderbookAndSpot,
  resolveAssetTarget,
  searchCatalogAndNetworkAssets,
} from "../services/catalog.js";
import { adaptFetch, type FetchLike } from "../stellar-verifier.js";

export type McpRouteEnv = {
  Variables: {
    config: ServerConfig;
    repo?: DexServerRepository;
  };
};

const MCP_TOOLS = [
  {
    name: "search_stellar_assets",
    description:
      "Search Stellar tokens by name, ticker (e.g. ASTRO, USDC, STELA), issuer G..., or contract C... across AstroDex catalog, AstroGate, StellarExpert, and Horizon.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "scan_stellar_asset",
    description:
      "Run AstroDex SDEX Reboot + Soroban X-Ray forensic security scan on a Stellar asset (ticker, XLM, CODE:G..., or C...).",
    inputSchema: {
      type: "object",
      properties: { assetId: { type: "string" } },
      required: ["assetId"],
    },
  },
  {
    name: "get_best_swap_route",
    description:
      "Quote the optimal swap route across AstroGate v4.5 Curve, Soroswap Direct & Aggregator, XOXNO, and Classic SDEX.",
    inputSchema: {
      type: "object",
      properties: {
        fromAsset: { type: "string" },
        toAsset: { type: "string" },
        amount: { type: "string" },
        accountKind: { type: "string", enum: ["classic", "smart"] },
      },
      required: ["fromAsset", "toAsset", "amount"],
    },
  },
  {
    name: "get_sdex_orderbook_depth",
    description:
      "Read live Classic SDEX orderbook bids/asks and live Soroswap/AstroGate AMM pool reserves & synthetic depth for a Stellar pair.",
    inputSchema: {
      type: "object",
      properties: { baseAsset: { type: "string" }, quoteAsset: { type: "string" } },
      required: ["baseAsset", "quoteAsset"],
    },
  },
  {
    name: "get_astrogate_jackpot_radar",
    description:
      "Fetch active AstroGate Fair-Flywheel v4.5 bonding curves, jackpot checkpoints, and buyback status.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

export function createMcpRoutes(deps: { fetchFn?: FetchLike | undefined } = {}): Hono<McpRouteEnv> {
  const router = new Hono<McpRouteEnv>();
  const fetchFn = adaptFetch(deps.fetchFn ?? fetch);

  router.get("/openapi.json", (c) => {
    const config = c.get("config");
    return c.json({
      openapi: "3.1.0",
      info: {
        title: "AstroDex Public & Telegram Mini App API",
        version: "1.1.0",
        description:
          "100% English Stellar Classic SDEX + Soroban DEX Aggregator, Forensic Token Scanner, and MCP Server.",
      },
      servers: [{ url: config.tmaOrigin }],
      paths: {
        "/health": { get: { summary: "Service health & active Stellar network" } },
        "/v1/markets/overview": { get: { summary: "Unified token catalog, XLM/USD oracle, and AstroGate Launchpad feed" } },
        "/v1/markets/search": { get: { summary: "Search Stellar assets by ticker, name, G... issuer, or C... contract" } },
        "/v1/markets/listings": { post: { summary: "Instant self-serve token & AMM listing with Astro Shield" } },
        "/v1/scanner/{assetId}": { get: { summary: "Run Astro Shield forensic token audit" } },
        "/v1/agent/forensic-alpha/{assetId}": { get: { summary: "x402 HTTP 402 paid forensic alpha report for AI agents (USDC SAC)" } },
        "/v1/quote": { post: { summary: "Quote 5-Way Smart Liquidity Router" } },
        "/v1/orderbook/{pair}": { get: { summary: "Live Classic SDEX orderbook + AMM pool depth" } },
        "/v1/candles/{pair}": { get: { summary: "Merged D1 Soroban + Horizon OHLCV candles" } },
        "/mcp": { post: { summary: "Model Context Protocol JSON-RPC 2.0 endpoint" } },
      },
    });
  });

  router.get("/llms.txt", (c) => {
    const config = c.get("config");
    return c.text(
      [
        "# AstroDex — Stellar Classic SDEX + Soroban DEX & Forensic Scanner",
        `Network: ${config.network} (${config.networkPassphrase})`,
        "Auth & Signing: Exclusive AstroWallet AstroID SSO (zero private key custody in AstroDex)",
        "Endpoints: GET /v1/markets/search?q=..., GET /v1/scanner/:assetId, POST /v1/quote, GET /v1/orderbook/:pair, POST /mcp",
      ].join("\n"),
    );
  });

  router.post("/mcp", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo") ?? createInMemoryRepository();
    const rpcReq = (await c.req.json().catch(() => null)) as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    } | null;

    const id = rpcReq?.id ?? null;
    if (!rpcReq || rpcReq.jsonrpc !== "2.0" || !rpcReq.method) {
      return c.json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" } }, 400);
    }

    if (rpcReq.method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "astrodex-mcp", version: "1.1.0" },
          capabilities: { tools: {} },
        },
      });
    }

    if (rpcReq.method === "tools/list") {
      return c.json({ jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } });
    }

    if (rpcReq.method === "tools/call") {
      const name = rpcReq.params?.name;
      const args = rpcReq.params?.arguments ?? {};
      try {
        if (name === "search_stellar_assets") {
          const limitNum = Number(args.limit ?? 10);
          const { results } = await searchCatalogAndNetworkAssets({
            config,
            repo,
            fetchFn,
            query: String(args.query ?? ""),
            limit: Number.isFinite(limitNum) ? Math.max(1, Math.min(25, Math.trunc(limitNum))) : 10,
          });
          return c.json({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify({ results }) }] },
          });
        }
        if (name === "scan_stellar_asset") {
          const { target } = await resolveAssetTarget({
            config,
            repo,
            fetchFn,
            rawAsset: String(args.assetId ?? "XLM"),
          });
          const scanner = createStellarForensicScanner({
            network: config.network,
            networkPassphrase: config.networkPassphrase,
            rpcUrls: config.rpcUrls,
            horizonUrls: config.horizonUrls,
            sep42AssetListUrls: config.sep42AssetListUrls,
            stellarExpertApiBase: config.stellarExpertApiBase,
            astroGateApiBaseUrl: config.astroGateApiBaseUrl,
            fetchFn,
          });
          const audit = await scanner.auditToken(target.resolvedKey);
          return c.json({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(audit) }] },
          });
        }
        if (name === "get_best_swap_route") {
          const snapshot = await buildUnifiedCatalog(config, repo, fetchFn);
          const [{ target: fromTarget }, { target: toTarget }] = await Promise.all([
            resolveAssetTarget({
              config,
              repo,
              fetchFn,
              rawAsset: String(args.fromAsset ?? "XLM"),
              snapshot,
            }),
            resolveAssetTarget({
              config,
              repo,
              fetchFn,
              rawAsset: String(args.toAsset ?? ""),
              snapshot,
            }),
          ]);
          const smartRouter = createSmartLiquidityRouter({
            horizonUrls: config.horizonUrls,
            soroswapProxyQuoteUrl: config.soroswapApiBase
              ? `${config.tmaOrigin.replace(/\/+$/, "")}/v1/proxy/soroswap/quote`
              : undefined,
            xoxnoApiBase: config.xoxnoSwapApiBase,
            verifiedAssets: snapshot.sep42Assets,
            curveStateLoader: createConfiguredCurveStateLoader(config, fetchFn),
            directPairReservesLoader: createConfiguredPairReservesLoader(config, snapshot, fetchFn),
            fetchFn,
          });
          const quote = await smartRouter.quoteBestRoutes({
            fromAsset: fromTarget.resolvedKey,
            toAsset: toTarget.resolvedKey,
            amount: String(args.amount ?? "10"),
            slippageBps: 50,
            accountKind: args.accountKind === "smart" ? "smart" : "classic",
          });
          return c.json({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(quote) }] },
          });
        }
        if (name === "get_sdex_orderbook_depth") {
          const snapshot = await buildUnifiedCatalog(config, repo, fetchFn);
          const [{ target: baseTarget }, { target: quoteTarget }] = await Promise.all([
            resolveAssetTarget({
              config,
              repo,
              fetchFn,
              rawAsset: String(args.baseAsset ?? "XLM"),
              snapshot,
            }),
            resolveAssetTarget({
              config,
              repo,
              fetchFn,
              rawAsset: String(args.quoteAsset ?? "XLM"),
              snapshot,
            }),
          ]);
          const [horizonSnapshot, ammResult] = await Promise.all([
            fetchHorizonOrderbook(
              config.horizonUrls,
              baseTarget.classicAsset ?? baseTarget.resolvedKey,
              quoteTarget.classicAsset ?? quoteTarget.resolvedKey,
              20,
              fetchFn,
            ),
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
          const book =
            !hasHorizonDepth && ammResult.syntheticSnapshot
              ? ammResult.syntheticSnapshot
              : horizonSnapshot;
          const depth = computeDepthChart(book);
          return c.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ snapshot: book, depth, ammPair: ammResult.ammPairInfo }),
                },
              ],
            },
          });
        }
        if (name === "get_astrogate_jackpot_radar") {
          if (!config.astroGateApiBaseUrl) {
            return c.json({
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: JSON.stringify({ tokens: [] }) }] },
            });
          }
          const res = await fetchFn(`${config.astroGateApiBaseUrl.replace(/\/+$/, "")}/api/v1/tokens`);
          const data = res.ok ? await res.json() : { tokens: [] };
          return c.json({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(data) }] },
          });
        }
      } catch (err) {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: err instanceof Error ? err.message : "Tool execution failed" },
        });
      }
    }

    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, 404);
  });

  return router;
}
