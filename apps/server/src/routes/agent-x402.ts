import { createSmartLiquidityRouter } from "@astrodex/dex-aggregator";
import type { AgenticPaymentPort, ServerConfig } from "@astrodex/domain";
import { createOraclesAndChartsEngine } from "@astrodex/oracles-and-charts";
import { createStellarForensicScanner } from "@astrodex/stellar-scanner";
import { Hono } from "hono";
import type { DexServerRepository } from "../db/repository.js";
import {
  buildUnifiedCatalog,
  createConfiguredCurveStateLoader,
  createConfiguredPairReservesLoader,
  fetchTokenTopHolders,
  resolveAssetTarget,
} from "../services/catalog.js";
import { adaptFetch, type FetchLike } from "../stellar-verifier.js";

const DEFAULT_TESTNET_USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const DEFAULT_MAINNET_USDC_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const DEFAULT_PAY_TO_FALLBACK = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface X402PaymentRequirements {
  x402Version: 2;
  accepts: [
    {
      scheme: "exact";
      network: "stellar:testnet" | "stellar:pubnet";
      asset: string;
      amount: string;
      payTo: string;
      maxTimeoutSeconds: number;
      description: string;
    },
  ];
}

function encodeBase64Json(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

function decodeBase64Json(raw: string): Record<string, unknown> | null {
  try {
    const bin = atob(raw.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function buildX402Requirements(
  config: ServerConfig,
  assetId: string,
): X402PaymentRequirements {
  const caipNetwork = config.network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";
  const assetSac =
    config.x402AssetSacId ??
    (config.network === "mainnet" ? DEFAULT_MAINNET_USDC_SAC : DEFAULT_TESTNET_USDC_SAC);
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: caipNetwork,
        asset: assetSac,
        amount: config.x402PriceStroops,
        payTo: config.x402PayToAddress ?? DEFAULT_PAY_TO_FALLBACK,
        maxTimeoutSeconds: 60,
        description: `AstroDex Forensic Alpha report for ${assetId} (Astro Shield + RedStone/Chainlink Oracles + 5-Way Route)`,
      },
    ],
  };
}

type AdaptedFetch = ReturnType<typeof adaptFetch>;

export function createX402PaymentVerifier(
  config: ServerConfig,
  fetchFn: AdaptedFetch,
): AgenticPaymentPort {
  const usedNonces = new Set<string>();

  return {
    async verifyPaymentProof(headerValue: string): Promise<{ paid: boolean; payer?: string | undefined }> {
      const parsed = decodeBase64Json(headerValue);
      if (!parsed) return { paid: false };
      const nonceKey = typeof parsed.nonce === "string"
        ? parsed.nonce
        : typeof parsed.signature === "string"
          ? parsed.signature.slice(0, 64)
          : "";
      if (nonceKey && usedNonces.has(nonceKey)) {
        return { paid: false };
      }

      if (config.x402FacilitatorUrl) {
        const base = config.x402FacilitatorUrl.replace(/\/+$/, "");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (config.x402FacilitatorApiKey) {
          headers.Authorization = `Bearer ${config.x402FacilitatorApiKey}`;
        }
        const verifyRes = await fetchFn(`${base}/verify`, {
          method: "POST",
          headers,
          body: JSON.stringify({ paymentPayload: parsed }),
        });
        if (!verifyRes.ok) return { paid: false };
        const verifyJson = (await verifyRes.json()) as { isValid?: boolean; payer?: string };
        if (!verifyJson.isValid) return { paid: false };

        const settleRes = await fetchFn(`${base}/settle`, {
          method: "POST",
          headers,
          body: JSON.stringify({ paymentPayload: parsed }),
        });
        if (!settleRes.ok) return { paid: false };
        if (nonceKey) usedNonces.add(nonceKey);
        return { paid: true, payer: verifyJson.payer };
      }

      // Without an external facilitator URL configured, fail closed unless a valid
      // facilitator verifier is injected in tests or self-hosted config.
      return { paid: false };
    },
  };
}

export type AgentX402Env = {
  Variables: {
    config: ServerConfig;
    repo: DexServerRepository;
  };
};

export function createAgentX402Routes(deps: {
  fetchFn?: FetchLike | undefined;
  verifyPaymentFn?: AgenticPaymentPort["verifyPaymentProof"] | undefined;
} = {}): Hono<AgentX402Env> {
  const router = new Hono<AgentX402Env>();
  const fetchFn = adaptFetch(deps.fetchFn ?? fetch);

  router.get("/agent/forensic-alpha/:assetId", async (c) => {
    const config = c.get("config");
    const repo = c.get("repo");
    const rawAssetId = decodeURIComponent(c.req.param("assetId")).trim();
    const requirements = buildX402Requirements(config, rawAssetId);

    const paymentHeader =
      c.req.header("X-PAYMENT")?.trim() ?? c.req.header("PAYMENT-SIGNATURE")?.trim();

    if (!paymentHeader) {
      c.header("PAYMENT-REQUIRED", encodeBase64Json(requirements));
      c.header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
      return c.json(
        {
          error: "Payment Required",
          x402Version: 2,
          accepts: requirements.accepts,
          hint: "Attach a signed x402 Soroban USDC auth entry in the X-PAYMENT or PAYMENT-SIGNATURE header.",
        },
        402,
      );
    }

    const verifier = deps.verifyPaymentFn ?? createX402PaymentVerifier(config, fetchFn).verifyPaymentProof!;
    const verification: { paid: boolean; payer?: string | undefined } = await verifier(
      paymentHeader,
    ).catch(() => ({ paid: false }));
    if (!verification.paid) {
      c.header("PAYMENT-REQUIRED", encodeBase64Json(requirements));
      c.header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
      return c.json(
        {
          error: "Invalid or expired x402 payment proof",
          x402Version: 2,
          accepts: requirements.accepts,
        },
        402,
      );
    }

    const snapshot = await buildUnifiedCatalog(config, repo, fetchFn);
    const { target } = await resolveAssetTarget({
      config,
      repo,
      fetchFn,
      rawAsset: rawAssetId,
      snapshot,
    });

    const scanner = createStellarForensicScanner({
      network: config.network,
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      horizonUrls: config.horizonUrls,
      sep42AssetListUrls: config.sep42AssetListUrls,
      stellarExpertApiBase: config.stellarExpertApiBase,
      astroGateApiBaseUrl: config.astroGateApiBaseUrl,
      stellarRegistryApiBase: config.stellarRegistryApiBase,
      fetchFn,
    });
    const oracles = createOraclesAndChartsEngine({
      networkPassphrase: config.networkPassphrase,
      rpcUrls: config.rpcUrls,
      horizonUrls: config.horizonUrls,
      chainlinkPriceProxyContractId: config.chainlinkPriceProxyContractId,
      redstoneSep40OracleContractId: config.redstoneSep40OracleContractId,
      reflectorDexOracleContractId: config.reflectorDexOracleContractId,
      xlmSacContractId: config.xlmSacContractId,
      stellarPricesApiBase: config.stellarPricesApiBase,
      stellarPricesApiKey: config.stellarPricesApiKey,
      fetchFn,
    });
    const liquidityRouter = createSmartLiquidityRouter({
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

    const [audit, oracleQuote, holders, bestQuote] = await Promise.all([
      scanner.auditToken(target.resolvedKey).catch(() => null),
      oracles.getAssetUsdPrice(target.sorobanContractId ?? target.resolvedKey).catch(() => null),
      fetchTokenTopHolders({
        config,
        target,
        fetchFn,
      }).catch(() => null),
      target.resolvedKey !== "XLM"
        ? liquidityRouter
            .quoteBestRoutes({
              fromAsset: "XLM",
              toAsset: target.resolvedKey,
              amount: "10",
              slippageBps: 100,
              accountKind: "classic",
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    const receipt = {
      success: true,
      payer: verification.payer ?? "verified-agent",
      network: requirements.accepts[0].network,
      asset: requirements.accepts[0].asset,
      amount: requirements.accepts[0].amount,
      settledAtUnix: Math.floor(Date.now() / 1000),
    };
    c.header("PAYMENT-RESPONSE", encodeBase64Json(receipt));
    c.header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");

    return c.json({
      ok: true,
      x402: receipt,
      assetId: rawAssetId,
      resolvedKey: target.resolvedKey,
      audit,
      oracleQuote,
      holders,
      bestQuote: bestQuote?.bestRoute ?? null,
    });
  });

  return router;
}
