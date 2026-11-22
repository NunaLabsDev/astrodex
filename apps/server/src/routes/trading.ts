import {
  buildClassicLimitOrderXdr,
  createSmartLiquidityRouter,
} from "@astrodex/dex-aggregator";
import {
  AstroDexSubActionSchema,
  StellarAddressSchema,
  type ServerConfig,
} from "@astrodex/domain";
import { createPreSignSecurityShield } from "@astrodex/security-shield";
import { fetchSep42VerifiedAssets } from "@astrodex/stellar-scanner";
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
  humanSummary: z.string().trim().min(1).max(280),
  returnStartAppParam: z.string().max(128).optional(),
  fromAsset: z.string().max(80).optional(),
  toAsset: z.string().max(80).optional(),
  amount: z.string().max(40).optional(),
  expectedOutputAmount: z.string().max(40).optional(),
  provider: z.string().max(48).optional(),
  priceImpactPct: z.string().max(24).optional(),
});

const ConfirmIntentBodySchema = z.object({
  sig: z.string().regex(/^[a-f0-9]{64}$/i),
  txHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
});

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
        config: Pick<ServerConfig, "horizonUrls" | "rpcUrls">,
        txHash: string,
        expected?: { expectedSourceAccount?: string | undefined },
      ) => Promise<TxVerificationResult>)
    | undefined;
}

export function createTradingRoutes(deps: TradingRoutesDeps = {}): Hono<TradingRouteEnv> {
  const router = new Hono<TradingRouteEnv>();
  const rawFetchFn = deps.fetchFn ?? fetch;
  const fetchFn = adaptFetch(rawFetchFn);

  router.post("/quote", async (c) => {
    const config = c.get("config");
    let body: z.infer<typeof QuoteBodySchema>;
    try {
      body = QuoteBodySchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        { error: "Invalid quote request", details: err instanceof Error ? err.message : undefined },
        400,
      );
    }

    const verifiedAssets = await fetchSep42VerifiedAssets(
      config.sep42AssetListUrls,
      fetchFn,
    ).catch(() => []);

    const routerEngine = createSmartLiquidityRouter({
      horizonUrls: config.horizonUrls,
      soroswapProxyQuoteUrl: config.soroswapApiBase ? `${config.tmaOrigin.replace(/\/+$/, "")}/v1/proxy/soroswap/quote` : undefined,
      xoxnoApiBase: config.xoxnoSwapApiBase,
      verifiedAssets,
      fetchFn,
    });

    const quote = await routerEngine.quoteBestRoutes({
      fromAsset: body.fromAsset,
      toAsset: body.toAsset,
      amount: body.amount,
      slippageBps: body.slippageBps,
      sourceAddress: body.sourceAddress,
      accountKind: body.accountKind,
    });

    return c.json({ ok: true, quote });
  });

  router.post("/intents", async (c) => {
    const session = await authenticateMiniAppSession(c);
    if (!session.ok) {
      return c.json({ error: session.error }, session.status);
    }

    const config = c.get("config");
    const repo = c.get("repo");
    let body: z.infer<typeof CreateIntentBodySchema>;
    try {
      body = CreateIntentBodySchema.parse(await c.req.json());
    } catch (err) {
      return c.json(
        { error: "Invalid intent request", details: err instanceof Error ? err.message : undefined },
        400,
      );
    }

    let unsignedXdr = body.unsignedXdr?.trim();
    if (!unsignedXdr && body.limitOrder) {
      if (!body.sourceAddress.startsWith("G")) {
        return c.json(
          { error: "Classic SDEX limit orders require a Classic G... source account" },
          400,
        );
      }
      unsignedXdr = buildClassicLimitOrderXdr(
        {
          seller: body.sourceAddress,
          ...body.limitOrder,
        },
        config.networkPassphrase,
      );
    }

    if (!unsignedXdr) {
      return c.json({ error: "unsignedXdr or limitOrder specification is required" }, 400);
    }

    // Mandatory pre-sign Scan & Shield gate (fail-closed on malicious verdict)
    const verifiedAssets = await fetchSep42VerifiedAssets(
      config.sep42AssetListUrls,
      fetchFn,
    ).catch(() => []);
    const shield = createPreSignSecurityShield({
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      verifiedAssets,
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

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 300;
    const intentId = `ad_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const actionType = mapSubActionToWalletActionType(body.subAction);
    const envelope = await buildCrossAppIntentEnvelope({
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
