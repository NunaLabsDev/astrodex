import {
  buildAstroGateCurveBuyXdr,
  buildAstroGateCurveSellXdr,
  buildClassicLimitOrderXdr,
  buildClassicSwapXdr,
  buildSoroswapRouterSwapXdr,
  createSmartLiquidityRouter,
  deriveContractIdForAsset,
} from "@astrodex/dex-aggregator";
import {
  AstroDexSubActionSchema,
  ContractAddressSchema,
  normalizeAssetIdentifier,
  parseDecimalToStroops7,
  StellarAddressSchema,
  type ServerConfig,
} from "@astrodex/domain";
import { createPreSignSecurityShield } from "@astrodex/security-shield";
import {
  buildExtendContractTtlXdr,
  fetchDirectoryTags,
} from "@astrodex/stellar-scanner";
import {
  buildAstroWalletIntentLink,
  buildCrossAppIntentEnvelope,
  mapSubActionToWalletActionType,
  sha256Hex,
  signIntentToken,
  verifyIntentToken,
} from "@astrodex/tg-protocol";
import { Hono } from "hono";
import { z } from "zod";
import type { DexServerRepository } from "../db/repository.js";
import { checkRateLimit, clientKeyFromHeaders } from "../rate-limit.js";
import {
  buildUnifiedCatalog,
  createConfiguredCurveStateLoader,
  createConfiguredPairReservesLoader,
  resolveAssetTarget,
  resolveReadFeedConfig,
} from "../services/catalog.js";
import {
  adaptFetch,
  verifyTransactionConfirmed,
  type FetchLike,
  type TxVerificationResult,
} from "../stellar-verifier.js";
import { authenticateMiniAppSession } from "./tg-auth.js";

const QuoteBodySchema = z.object({
  fromAsset: z.string().trim().min(1).max(100),
  toAsset: z.string().trim().min(1).max(100),
  amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
  slippageBps: z.number().int().min(1).max(5000).default(50),
  sourceAddress: StellarAddressSchema.optional(),
  accountKind: z.enum(["classic", "smart"]).default("classic"),
  network: z.enum(["testnet", "mainnet"]).optional(),
});

const CreateIntentBodySchema = z.object({
  subAction: AstroDexSubActionSchema,
  sourceAddress: StellarAddressSchema,
  unsignedXdr: z.string().min(16).optional(),
  limitOrder: z
    .object({
      side: z.enum(["buy", "sell"]),
      baseAsset: z.string().min(1),
      quoteAsset: z.string().min(1),
      amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
      price: z.string().regex(/^\d+(\.\d{1,7})?$/),
      offerId: z.string().optional(),
      includeTrustlineIfMissing: z.boolean().optional(),
    })
    .optional(),
  swapSpec: z
    .object({
      venue: z.string().optional(),
      fromAsset: z.string().min(1),
      toAsset: z.string().min(1),
      amount: z.string().regex(/^\d+(\.\d{1,7})?$/),
      minOutputAmount: z.string().regex(/^\d+(\.\d{1,7})?$/),
      pathAssets: z.array(z.string()).optional(),
      includeTrustlineIfMissing: z.boolean().optional(),
    })
    .optional(),
  extendTtlContractId: ContractAddressSchema.optional(),
  humanSummary: z.string().trim().min(1).max(280),
  returnStartAppParam: z.string().max(128).optional(),
  fromAsset: z.string().max(80).optional(),
  toAsset: z.string().max(80).optional(),
  amount: z.string().max(40).optional(),
  expectedOutputAmount: z.string().max(40).optional(),
  provider: z.string().max(48).optional(),
  priceImpactPct: z.string().max(24).optional(),
  network: z.enum(["testnet", "mainnet"]).optional(),
});

const ConfirmIntentBodySchema = z.object({
  sig: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  txHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  payerAddress: StellarAddressSchema.optional(),
});

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export type TradingRouteEnv = {
  Variables: {
    config: ServerConfig;
    repo: DexServerRepository;
  };
};

export interface TradingRoutesDeps {
  fetchFn?: FetchLike | undefined;
  verifyTxFn?:
    | ((
        config: Pick<ServerConfig, "horizonUrls" | "rpcUrls" | "networkPassphrase">,
        txHash: string,
        expected?: { expectedSourceAccount?: string | undefined },
      ) => Promise<TxVerificationResult>)
    | undefined;
}

interface HorizonAccountSnapshot {
  sequence: string;
  trustlines: Set<string> | null;
}

async function loadHorizonAccountState(
  horizonUrls: readonly string[],
  sourceAddress: string,
  fetchFn: ReturnType<typeof adaptFetch>,
): Promise<HorizonAccountSnapshot> {
  if (!sourceAddress.startsWith("G")) {
    return { sequence: "0", trustlines: null };
  }
  for (const base of horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await fetchFn(`${clean}/accounts/${encodeURIComponent(sourceAddress)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        sequence?: string;
        balances?: Array<{
          asset_type?: string;
          asset_code?: string;
          asset_issuer?: string;
        }>;
      };
      const trustlines = new Set<string>(["XLM"]);
      for (const bal of body.balances ?? []) {
        if (bal.asset_type === "native") {
          trustlines.add("XLM");
        } else if (bal.asset_code && bal.asset_issuer) {
          trustlines.add(`${bal.asset_code.toUpperCase()}:${bal.asset_issuer.toUpperCase()}`);
        }
      }
      return {
        sequence: typeof body.sequence === "string" && /^\d+$/.test(body.sequence) ? body.sequence : "0",
        trustlines,
      };
    } catch {
      // Fail over to next Horizon URL
    }
  }
  return { sequence: "0", trustlines: null };
}

function isTrustlineMissing(
  trustlines: Set<string> | null,
  assetIdentifier: string,
): boolean {
  if (!trustlines) return false;
  try {
    const norm = normalizeAssetIdentifier(assetIdentifier);
    if (norm.kind !== "classic" || !norm.issuer) return false;
    return !trustlines.has(`${norm.code.toUpperCase()}:${norm.issuer.toUpperCase()}`);
  } catch {
    return false;
  }
}

export function createTradingRoutes(deps: TradingRoutesDeps = {}): Hono<TradingRouteEnv> {
  const router = new Hono<TradingRouteEnv>();
  const rawFetchFn = deps.fetchFn ?? fetch;
  const fetchFn = adaptFetch(rawFetchFn);

  router.post("/quote", async (c) => {
    const baseConfig = c.get("config");
    const repo = c.get("repo");
    const rl = await checkRateLimit({
      repository: repo,
      scope: "quote",
      clientKey: clientKeyFromHeaders(c.req.raw.headers),
      limitPerMin: baseConfig.quoteRateLimitPerMin,
    });
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSeconds));
      return c.json({ error: "Quote rate limit exceeded" }, 429);
    }

    let body: z.infer<typeof QuoteBodySchema>;
    try {
      body = QuoteBodySchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        { error: "Invalid quote request", details: err instanceof Error ? err.message : undefined },
        400,
      );
    }

    const config = resolveReadFeedConfig(baseConfig, body.network ?? c.req.query("net"));
    const includeRepoTokens = config.network === baseConfig.network;
    const snapshot = await buildUnifiedCatalog(config, repo, fetchFn, { includeRepoTokens });
    const [{ target: fromTarget }, { target: toTarget }] = await Promise.all([
      resolveAssetTarget({ config, repo, fetchFn, rawAsset: body.fromAsset, snapshot }),
      resolveAssetTarget({ config, repo, fetchFn, rawAsset: body.toAsset, snapshot }),
    ]);

    try {
      normalizeAssetIdentifier(fromTarget.resolvedKey);
      normalizeAssetIdentifier(toTarget.resolvedKey);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Unknown or invalid token identifier" },
        400,
      );
    }

    const routerEngine = createSmartLiquidityRouter({
      horizonUrls: config.horizonUrls,
      soroswapProxyQuoteUrl:
        includeRepoTokens && config.soroswapApiBase
          ? `${config.tmaOrigin.replace(/\/+$/, "")}/v1/proxy/soroswap/quote`
          : undefined,
      xoxnoApiBase: config.xoxnoSwapApiBase,
      verifiedAssets: snapshot.sep42Assets,
      curveStateLoader: createConfiguredCurveStateLoader(config, fetchFn),
      directPairReservesLoader: createConfiguredPairReservesLoader(config, snapshot, fetchFn),
      fetchFn,
    });

    const quote = await routerEngine.quoteBestRoutes({
      fromAsset: fromTarget.resolvedKey,
      toAsset: toTarget.resolvedKey,
      amount: body.amount,
      slippageBps: body.slippageBps,
      sourceAddress: body.sourceAddress,
      accountKind: body.accountKind,
    });

    return c.json({ ok: true, network: config.network, quote });
  });

  router.post("/intents", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) {
      return c.json({ error: session.error }, session.status);
    }

    const config = c.get("config");
    const repo = c.get("repo");
    if (!config.executionEnabled) {
      return c.json({ error: "Transaction execution is disabled in Read-Only Visualizer mode" }, 403);
    }
    let body: z.infer<typeof CreateIntentBodySchema>;
    try {
      body = CreateIntentBodySchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        { error: "Invalid intent request", details: err instanceof Error ? err.message : undefined },
        400,
      );
    }
    if (body.network && body.network !== config.network) {
      return c.json(
        { error: `Network mismatch: requested ${body.network} on ${config.network} signer` },
        409,
      );
    }

    let unsignedXdr = body.unsignedXdr?.trim();
    const needsServerXdr =
      !unsignedXdr &&
      Boolean(
        body.limitOrder ||
          body.swapSpec ||
          (body.subAction === "soroban_extend_ttl" && body.extendTtlContractId),
      );
    const accountState = needsServerXdr
      ? await loadHorizonAccountState(config.horizonUrls, body.sourceAddress, fetchFn)
      : { sequence: "0", trustlines: null };

    if (!unsignedXdr && body.limitOrder) {
      if (!body.sourceAddress.startsWith("G")) {
        return c.json(
          { error: "Classic SDEX limit orders require a Classic G... source account" },
          400,
        );
      }
      const receiveAsset =
        body.limitOrder.side === "buy" ? body.limitOrder.baseAsset : body.limitOrder.quoteAsset;
      const autoTrust =
        body.limitOrder.includeTrustlineIfMissing ??
        isTrustlineMissing(accountState.trustlines, receiveAsset);
      unsignedXdr = buildClassicLimitOrderXdr(
        {
          seller: body.sourceAddress,
          ...body.limitOrder,
          includeTrustlineIfMissing: autoTrust,
        },
        config.networkPassphrase,
        accountState.sequence,
      );
    }

    if (!unsignedXdr && body.subAction === "soroban_extend_ttl" && body.extendTtlContractId) {
      unsignedXdr = buildExtendContractTtlXdr({
        sourceAddress: body.sourceAddress,
        contractId: body.extendTtlContractId,
        networkPassphrase: config.networkPassphrase,
        sequence: accountState.sequence,
      });
    }

    if (!unsignedXdr && body.swapSpec) {
      try {
        const snapshot = await buildUnifiedCatalog(config, repo, fetchFn);
        const [{ target: fromTarget }, { target: toTarget }] = await Promise.all([
          resolveAssetTarget({ config, repo, fetchFn, rawAsset: body.swapSpec.fromAsset, snapshot }),
          resolveAssetTarget({ config, repo, fetchFn, rawAsset: body.swapSpec.toAsset, snapshot }),
        ]);

        const fromNorm = normalizeAssetIdentifier(fromTarget.resolvedKey);
        const toNorm = normalizeAssetIdentifier(toTarget.resolvedKey);
        const amountInStroops = parseDecimalToStroops7(body.swapSpec.amount);
        const amountOutMinStroops = parseDecimalToStroops7(body.swapSpec.minOutputAmount);

        if (
          body.swapSpec.venue === "astrogate_curve" &&
          config.astroGateLaunchpadContractId &&
          amountInStroops !== null &&
          amountInStroops > 0n &&
          amountOutMinStroops !== null &&
          amountOutMinStroops > 0n
        ) {
          if (fromNorm.kind === "native" && toTarget.sorobanContractId) {
            unsignedXdr = buildAstroGateCurveBuyXdr({
              sourceAddress: body.sourceAddress,
              launchpadContractId: config.astroGateLaunchpadContractId,
              tokenContractId: toTarget.sorobanContractId,
              maxXlmInStroops: amountInStroops,
              minTokensOutBase: amountOutMinStroops,
              networkPassphrase: config.networkPassphrase,
              sequence: accountState.sequence,
            });
          } else if (toNorm.kind === "native" && fromTarget.sorobanContractId) {
            unsignedXdr = buildAstroGateCurveSellXdr({
              sourceAddress: body.sourceAddress,
              launchpadContractId: config.astroGateLaunchpadContractId,
              tokenContractId: fromTarget.sorobanContractId,
              tokenAmountBase: amountInStroops,
              minXlmOutStroops: amountOutMinStroops,
              networkPassphrase: config.networkPassphrase,
              sequence: accountState.sequence,
            });
          }
        }

        if (
          !unsignedXdr &&
          body.sourceAddress.startsWith("G") &&
          fromTarget.classicAsset &&
          toTarget.classicAsset &&
          body.swapSpec.venue !== "soroswap_direct" &&
          body.swapSpec.venue !== "soroswap_aggregator" &&
          body.swapSpec.venue !== "astrogate_curve"
        ) {
          const autoTrust =
            body.swapSpec.includeTrustlineIfMissing ??
            isTrustlineMissing(accountState.trustlines, toTarget.classicAsset);
          unsignedXdr = buildClassicSwapXdr({
            sourceAddress: body.sourceAddress,
            fromAsset: fromTarget.classicAsset,
            toAsset: toTarget.classicAsset,
            amount: body.swapSpec.amount,
            minOutputAmount: body.swapSpec.minOutputAmount,
            pathAssets: body.swapSpec.pathAssets,
            includeTrustlineIfMissing: autoTrust,
            networkPassphrase: config.networkPassphrase,
            sequence: accountState.sequence,
          });
        } else if (!unsignedXdr && config.soroswapRouterContractId) {
          const fromContract =
            fromTarget.sorobanContractId ??
            deriveContractIdForAsset(
              fromTarget.resolvedKey,
              config.networkPassphrase,
              config.xlmSacContractId,
            );
          const toContract =
            toTarget.sorobanContractId ??
            deriveContractIdForAsset(
              toTarget.resolvedKey,
              config.networkPassphrase,
              config.xlmSacContractId,
            );
          if (
            amountInStroops !== null &&
            amountInStroops > 0n &&
            amountOutMinStroops !== null &&
            amountOutMinStroops > 0n
          ) {
            unsignedXdr = buildSoroswapRouterSwapXdr({
              sourceAddress: body.sourceAddress,
              routerContractId: config.soroswapRouterContractId,
              amountInStroops,
              amountOutMinStroops,
              pathContracts: [fromContract, toContract],
              deadlineUnix: Math.floor(Date.now() / 1000) + 300,
              networkPassphrase: config.networkPassphrase,
              sequence: accountState.sequence,
            });
          }
        }
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : "Failed to build swap XDR" },
          400,
        );
      }
    }

    if (!unsignedXdr) {
      return c.json({ error: "unsignedXdr, swapSpec, or limitOrder specification is required" }, 400);
    }

    // Mandatory pre-sign Scan & Shield gate (fail-closed on malicious verdict)
    const { sep42Assets: verifiedAssets } = await buildUnifiedCatalog(config, repo, fetchFn);
    const shield = createPreSignSecurityShield({
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      verifiedAssets,
      directoryLookup: async (address) => {
        const tags = await fetchDirectoryTags(
          config.stellarExpertApiBase,
          config.network,
          address,
          fetchFn,
        );
        return tags.length > 0
          ? { address, tags, memoRequired: tags.includes("exchange") }
          : null;
      },
      fetchFn,
    });

    const scanReport = await shield.scanTransactionXdr(unsignedXdr, body.sourceAddress);
    if (scanReport.verdict === "malicious") {
      return c.json(
        {
          error: `Blocked by Astro Security Shield: ${scanReport.findings[0]?.title ?? "malicious transaction"}`,
          scanReport,
        },
        403,
      );
    }
    if (scanReport.assembledXdr) {
      unsignedXdr = scanReport.assembledXdr;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 300;
    const intentId = `ad_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const actionType = mapSubActionToWalletActionType(body.subAction);
    const baseEnvelope = await buildCrossAppIntentEnvelope({
      subAction: body.subAction,
      humanSummary: body.humanSummary,
      unsignedXdr,
      returnStartAppParam: body.returnStartAppParam,
      fromAsset: body.fromAsset,
      toAsset: body.toAsset,
      amount: body.amount,
      expectedOutputAmount: body.expectedOutputAmount,
      provider: body.provider,
      priceImpactPct: body.priceImpactPct,
    });

    const sig = await signIntentToken(
      {
        intentId,
        network: config.network,
        telegramUserId: session.claims.telegramUserId,
        expiresAt,
      },
      config.intentHmacSecret,
    );

    const envelope = {
      ...baseEnvelope,
      sourceAddress: body.sourceAddress,
      originConfirmSig: sig,
    };

    const xdrSha256 = await sha256Hex(unsignedXdr);
    const intent = await repo.createSignedIntent({
      intentId,
      network: config.network,
      creatorTelegramUserId: session.claims.telegramUserId,
      actionType,
      subAction: body.subAction,
      sourceAddress: body.sourceAddress,
      payloadJson: JSON.stringify(envelope),
      xdrSha256,
      hmacSig: sig,
      status: "pending",
      expiresAt,
      createdAt: now,
    });

    let deepLink = buildAstroWalletIntentLink({
      astroWalletBotUsername: config.astroWalletBotUsername,
      astroWalletMiniAppShortName: config.astroWalletMiniAppShortName,
      intentId,
      sig,
    });
    let federatedToAstroWallet = false;

    // Federate to AstroWallet universal signer when configured
    if (config.astroWalletApiBaseUrl && config.ecosystemSharedIntentSecret) {
      const base = config.astroWalletApiBaseUrl.replace(/\/+$/, "");
      try {
        const fedRes = await fetchFn(`${base}/v1/intents/external`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ecosystem-Secret": config.ecosystemSharedIntentSecret,
          },
          body: JSON.stringify({
            intentId,
            telegramUserId: session.claims.telegramUserId,
            actionType,
            envelope,
            expiresAt,
          }),
        });
        if (fedRes.ok) {
          const fedJson = (await fedRes.json()) as {
            ok?: boolean;
            deepLink?: string;
          };
          federatedToAstroWallet = Boolean(fedJson.ok);
          if (fedJson.deepLink) {
            deepLink = fedJson.deepLink;
          }
        }
      } catch {
        // Keep local intent record + canonical deepLink cleanly
      }
    }

    return c.json({
      ok: true,
      intentId: intent.intentId,
      actionType: intent.actionType,
      sig: intent.hmacSig,
      expiresAt: intent.expiresAt,
      deepLink,
      federatedToAstroWallet,
      scanReport,
    });
  });

  router.post("/intents/:intentId/confirm", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const intentId = c.req.param("intentId");

    let body: z.infer<typeof ConfirmIntentBodySchema>;
    try {
      body = ConfirmIntentBodySchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        { error: "Invalid confirm payload", details: err instanceof Error ? err.message : undefined },
        400,
      );
    }

    const intent = await repo.getSignedIntent(intentId);
    if (!intent) {
      return c.json({ error: "Intent not found" }, 404);
    }

    const incomingSecret = c.req.header("X-Ecosystem-Secret")?.trim();
    const secretAuthorized = Boolean(
      incomingSecret &&
        config.ecosystemSharedIntentSecret &&
        constantTimeEqual(incomingSecret, config.ecosystemSharedIntentSecret),
    );

    if (!secretAuthorized) {
      if (!body.sig) {
        return c.json({ error: "Intent token missing" }, 401);
      }
      const check = await verifyIntentToken(
        {
          intentId: intent.intentId,
          network: intent.network,
          telegramUserId: intent.creatorTelegramUserId,
          expiresAt: intent.expiresAt,
        },
        body.sig,
        config.intentHmacSecret,
      );
      if (!check.valid) {
        return c.json(
          { error: `Intent token ${check.reason}` },
          check.reason === "expired" ? 410 : 401,
        );
      }
    } else if (body.sig) {
      const check = await verifyIntentToken(
        {
          intentId: intent.intentId,
          network: intent.network,
          telegramUserId: intent.creatorTelegramUserId,
          expiresAt: intent.expiresAt,
        },
        body.sig,
        config.intentHmacSecret,
      );
      if (!check.valid) {
        return c.json(
          { error: `Intent token ${check.reason}` },
          check.reason === "expired" ? 410 : 401,
        );
      }
    }

    if (intent.status === "confirmed" && intent.txHash?.toLowerCase() === body.txHash.toLowerCase()) {
      return c.json({ ok: true, status: "confirmed", txHash: intent.txHash });
    }
    if (intent.status !== "pending") {
      return c.json({ error: `Intent already ${intent.status}` }, 409);
    }
    if (await repo.isTxHashUsed(body.txHash)) {
      return c.json({ error: "Transaction hash already used for another intent" }, 409);
    }

    const verifyFn =
      deps.verifyTxFn ??
      ((cfg, hash, expected) => verifyTransactionConfirmed(cfg, hash, expected, rawFetchFn));
    const txCheck = await verifyFn(config, body.txHash, {
      expectedSourceAccount: intent.sourceAddress,
    });
    if (!txCheck.confirmed) {
      return c.json({ error: txCheck.reason }, 409);
    }

    await repo.markIntentConfirmed(intent.intentId, body.txHash);
    return c.json({
      ok: true,
      status: "confirmed",
      txHash: body.txHash.toLowerCase(),
      ledger: txCheck.ledger,
    });
  });

  return router;
}
