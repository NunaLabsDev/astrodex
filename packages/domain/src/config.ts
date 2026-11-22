import { z } from "zod";
import { ContractAddressSchema, type ContractAddress } from "./accounts.js";

export const StellarNetworkSchema = z.enum(["testnet", "mainnet"]);
export type StellarNetwork = z.infer<typeof StellarNetworkSchema>;

interface MinimalUrl {
  protocol: string;
  hostname: string;
}

function parseUrlSafe(raw: string): MinimalUrl | null {
  const UrlCtor = (globalThis as unknown as { URL?: new (input: string) => MinimalUrl }).URL;
  if (!UrlCtor) {
    throw new Error("Global WHATWG URL constructor is required");
  }
  try {
    return new UrlCtor(raw);
  } catch {
    return null;
  }
}

function isAllowedUrl(raw: string): boolean {
  const parsed = parseUrlSafe(raw);
  if (!parsed) return false;
  if (parsed.protocol === "https:") return true;
  if (
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  ) {
    return true;
  }
  return false;
}

const emptyToUndefined = (val: unknown): unknown => {
  if (typeof val === "string" && val.trim() === "") {
    return undefined;
  }
  return val;
};

const RequiredUrlSchema = (field: string) =>
  z
    .string({ required_error: `${field} is required` })
    .trim()
    .min(1, `${field} cannot be empty`)
    .refine(isAllowedUrl, `${field} must be a valid https:// (or localhost http://) URL`);

const OptionalUrlSchema = (field: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .refine(isAllowedUrl, `${field} must be a valid https:// (or localhost http://) URL`)
      .optional(),
  );

const OptionalNonEmptyStringSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

const OptionalContractAddressSchema = z.preprocess(
  emptyToUndefined,
  ContractAddressSchema.optional(),
);

function parseBooleanWithDefault(defaultValue: boolean) {
  return z.preprocess((val) => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const normalized = val.trim().toLowerCase();
      if (normalized === "") return undefined;
      if (normalized === "true" || normalized === "1") return true;
      if (normalized === "false" || normalized === "0") return false;
    }
    return val;
  }, z.boolean().default(defaultValue));
}

const OptionalShortNameSchema = (field: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{3,64}$/, `${field} must be 3-64 alphanumeric/underscore characters`)
      .optional(),
  );

const RequiredBotUsernameSchema = (field: string) =>
  z
    .string({ required_error: `${field} is required` })
    .trim()
    .transform((v) => v.replace(/^@/, ""))
    .refine(
      (v) => /^[A-Za-z0-9_]{5,32}$/.test(v),
      `${field} must be a valid Telegram bot username (5-32 chars)`,
    );

const OptionalBotUsernameSchema = (field: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, ""))
      .refine(
        (v) => /^[A-Za-z0-9_]{5,32}$/.test(v),
        `${field} must be a valid Telegram bot username (5-32 chars)`,
      )
      .optional(),
  );

function parseUrlCsv(field: string, required: boolean) {
  return z
    .preprocess((val) => (typeof val === "string" ? val : ""), z.string())
    .transform((raw) =>
      Array.from(
        new Set(
          raw
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      ),
    )
    .superRefine((urls, ctx) => {
      if (required && urls.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} must define at least one valid URL`,
        });
        return;
      }
      for (const url of urls) {
        if (!isAllowedUrl(url)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field} contains invalid URL "${url}"`,
          });
        }
      }
    });
}

function parsePositiveIntWithDefault(defaultValue: number, max: number) {
  return z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(max).default(defaultValue),
  );
}

function parsePositiveStroopsStringWithDefault(field: string, defaultValue: string) {
  return z.preprocess(
    (val) => emptyToUndefined(val) ?? defaultValue,
    z
      .union([z.string(), z.number()])
      .transform((v) => String(v).trim())
      .refine(
        (v) => /^\d+$/.test(v) && BigInt(v) > 0n,
        `${field} must be a positive integer string in stroops`,
      ),
  );
}

function validateNetworkCoherence(
  network: StellarNetwork,
  passphrase: string,
  urls: ReadonlyArray<string | undefined>,
  ctx: z.RefinementCtx,
  passphrasePath: string,
  urlPath: string,
) {
  if (network === "mainnet" && /\btest\b/i.test(passphrase)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [passphrasePath],
      message: `${passphrasePath} cannot reference a test network when network=mainnet`,
    });
  }
  if (network === "testnet" && /\bpublic\b/i.test(passphrase)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [passphrasePath],
      message: `${passphrasePath} cannot reference a public mainnet passphrase when network=testnet`,
    });
  }
  if (network === "mainnet") {
    for (const u of urls) {
      if (u && u.trim().toLowerCase().startsWith("http://")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [urlPath],
          message: `Plaintext http:// endpoint "${u}" is strictly forbidden when network=mainnet`,
        });
      }
    }
  }
}

const RawTmaEnvSchema = z
  .object({
    VITE_STELLAR_NETWORK: StellarNetworkSchema,
    VITE_STELLAR_NETWORK_PASSPHRASE: z
      .string({ required_error: "VITE_STELLAR_NETWORK_PASSPHRASE is required" })
      .trim()
      .min(1, "VITE_STELLAR_NETWORK_PASSPHRASE cannot be empty"),
    VITE_STELLAR_RPC_URLS: parseUrlCsv("VITE_STELLAR_RPC_URLS", true),
    VITE_HORIZON_URLS: parseUrlCsv("VITE_HORIZON_URLS", true),
    VITE_API_BASE_URL: RequiredUrlSchema("VITE_API_BASE_URL"),
    VITE_TMA_ORIGIN: RequiredUrlSchema("VITE_TMA_ORIGIN"),
    VITE_TG_BOT_USERNAME: RequiredBotUsernameSchema("VITE_TG_BOT_USERNAME"),
    VITE_TG_MINI_APP_SHORT_NAME: OptionalShortNameSchema("VITE_TG_MINI_APP_SHORT_NAME"),
    VITE_ASTROWALLET_BOT_USERNAME: RequiredBotUsernameSchema("VITE_ASTROWALLET_BOT_USERNAME"),
    VITE_ASTROWALLET_MINI_APP_SHORT_NAME: OptionalShortNameSchema(
      "VITE_ASTROWALLET_MINI_APP_SHORT_NAME",
    ),
    VITE_ASTROWALLET_API_BASE_URL: OptionalUrlSchema("VITE_ASTROWALLET_API_BASE_URL"),
    VITE_ASTROWALLET_CLAIM_ESCROW_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_ASTROWALLET_SOROBITS_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_ASTROGATE_BOT_USERNAME: OptionalBotUsernameSchema("VITE_ASTROGATE_BOT_USERNAME"),
    VITE_ASTROGATE_API_BASE_URL: OptionalUrlSchema("VITE_ASTROGATE_API_BASE_URL"),
    VITE_ASTROGATE_LAUNCHPAD_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_SOROSWAP_FACTORY_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_SOROSWAP_ROUTER_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_XLM_SAC_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_REFLECTOR_DEX_ORACLE_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_CHAINLINK_PRICE_PROXY_CONTRACT_ID: OptionalContractAddressSchema,
    VITE_SEP42_ASSET_LIST_URLS: parseUrlCsv("VITE_SEP42_ASSET_LIST_URLS", false),
    VITE_EXPLORER_BASE_URL: OptionalUrlSchema("VITE_EXPLORER_BASE_URL"),
    VITE_ALLOW_DEV_OUTSIDE_TELEGRAM: parseBooleanWithDefault(false),
    VITE_FRIENDBOT_URL: OptionalUrlSchema("VITE_FRIENDBOT_URL"),
    VITE_SMART_ACCOUNT_WASM_HASH: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .regex(/^[a-fA-F0-9]{64}$/, "VITE_SMART_ACCOUNT_WASM_HASH must be 64 hex chars")
        .optional(),
    ),
    VITE_SOROBAN_MAX_RESOURCE_FEE_STROOPS: parsePositiveStroopsStringWithDefault(
      "VITE_SOROBAN_MAX_RESOURCE_FEE_STROOPS",
      "5000000",
    ),
    VITE_DEFAULT_FEED_NETWORK: z.preprocess(
      emptyToUndefined,
      StellarNetworkSchema.default("mainnet"),
    ),
    VITE_EXECUTION_ENABLED: parseBooleanWithDefault(false),
  })
  .superRefine((env, ctx) => {
    if (env.VITE_STELLAR_NETWORK === "mainnet" && env.VITE_FRIENDBOT_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["VITE_FRIENDBOT_URL"],
        message: "VITE_FRIENDBOT_URL is strictly forbidden when VITE_STELLAR_NETWORK=mainnet",
      });
    }
    if (env.VITE_STELLAR_NETWORK === "mainnet" && env.VITE_ALLOW_DEV_OUTSIDE_TELEGRAM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["VITE_ALLOW_DEV_OUTSIDE_TELEGRAM"],
        message:
          "VITE_ALLOW_DEV_OUTSIDE_TELEGRAM=true is strictly forbidden when VITE_STELLAR_NETWORK=mainnet",
      });
    }
    validateNetworkCoherence(
      env.VITE_STELLAR_NETWORK,
      env.VITE_STELLAR_NETWORK_PASSPHRASE,
      [
        ...env.VITE_STELLAR_RPC_URLS,
        ...env.VITE_HORIZON_URLS,
        env.VITE_API_BASE_URL,
        env.VITE_TMA_ORIGIN,
        env.VITE_ASTROWALLET_API_BASE_URL,
        env.VITE_ASTROGATE_API_BASE_URL,
        ...env.VITE_SEP42_ASSET_LIST_URLS,
        env.VITE_EXPLORER_BASE_URL,
      ],
      ctx,
      "VITE_STELLAR_NETWORK_PASSPHRASE",
      "VITE_STELLAR_NETWORK",
    );
  });

export interface TmaConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  rpcUrls: string[];
  horizonUrls: string[];
  apiBaseUrl: string;
  tmaOrigin: string;
  tgBotUsername: string;
  tgMiniAppShortName?: string | undefined;
  astroWalletBotUsername: string;
  astroWalletMiniAppShortName?: string | undefined;
  astroWalletApiBaseUrl?: string | undefined;
  astroWalletClaimEscrowContractId?: ContractAddress | undefined;
  astroWalletSorobitsContractId?: ContractAddress | undefined;
  astroGateBotUsername?: string | undefined;
  astroGateApiBaseUrl?: string | undefined;
  astroGateLaunchpadContractId?: ContractAddress | undefined;
  soroswapFactoryContractId?: ContractAddress | undefined;
  soroswapRouterContractId?: ContractAddress | undefined;
  xlmSacContractId?: ContractAddress | undefined;
  reflectorDexOracleContractId?: ContractAddress | undefined;
  chainlinkPriceProxyContractId?: ContractAddress | undefined;
  sep42AssetListUrls: string[];
  explorerBaseUrl?: string | undefined;
  allowDevOutsideTelegram: boolean;
  friendbotUrl?: string | undefined;
  smartAccountWasmHash?: string | undefined;
  sorobanMaxResourceFeeStroops: string;
  defaultFeedNetwork: StellarNetwork;
  executionEnabled: boolean;
}

export function parseTmaConfig(rawEnv: Record<string, unknown>): TmaConfig {
  const parsed = RawTmaEnvSchema.parse(rawEnv);
  return {
    network: parsed.VITE_STELLAR_NETWORK,
    networkPassphrase: parsed.VITE_STELLAR_NETWORK_PASSPHRASE,
    rpcUrls: parsed.VITE_STELLAR_RPC_URLS,
    horizonUrls: parsed.VITE_HORIZON_URLS,
    apiBaseUrl: parsed.VITE_API_BASE_URL,
    tmaOrigin: parsed.VITE_TMA_ORIGIN,
    tgBotUsername: parsed.VITE_TG_BOT_USERNAME,
    tgMiniAppShortName: parsed.VITE_TG_MINI_APP_SHORT_NAME,
    astroWalletBotUsername: parsed.VITE_ASTROWALLET_BOT_USERNAME,
    astroWalletMiniAppShortName: parsed.VITE_ASTROWALLET_MINI_APP_SHORT_NAME,
    astroWalletApiBaseUrl: parsed.VITE_ASTROWALLET_API_BASE_URL,
    astroWalletClaimEscrowContractId: parsed.VITE_ASTROWALLET_CLAIM_ESCROW_CONTRACT_ID,
    astroWalletSorobitsContractId: parsed.VITE_ASTROWALLET_SOROBITS_CONTRACT_ID,
    astroGateBotUsername: parsed.VITE_ASTROGATE_BOT_USERNAME,
    astroGateApiBaseUrl: parsed.VITE_ASTROGATE_API_BASE_URL,
    astroGateLaunchpadContractId: parsed.VITE_ASTROGATE_LAUNCHPAD_CONTRACT_ID,
    soroswapFactoryContractId: parsed.VITE_SOROSWAP_FACTORY_CONTRACT_ID,
    soroswapRouterContractId: parsed.VITE_SOROSWAP_ROUTER_CONTRACT_ID,
    xlmSacContractId: parsed.VITE_XLM_SAC_CONTRACT_ID,
    reflectorDexOracleContractId: parsed.VITE_REFLECTOR_DEX_ORACLE_CONTRACT_ID,
    chainlinkPriceProxyContractId: parsed.VITE_CHAINLINK_PRICE_PROXY_CONTRACT_ID,
    sep42AssetListUrls: parsed.VITE_SEP42_ASSET_LIST_URLS,
    explorerBaseUrl: parsed.VITE_EXPLORER_BASE_URL,
    allowDevOutsideTelegram: parsed.VITE_ALLOW_DEV_OUTSIDE_TELEGRAM,
    friendbotUrl: parsed.VITE_FRIENDBOT_URL,
    smartAccountWasmHash: parsed.VITE_SMART_ACCOUNT_WASM_HASH,
    sorobanMaxResourceFeeStroops: parsed.VITE_SOROBAN_MAX_RESOURCE_FEE_STROOPS,
    defaultFeedNetwork: parsed.VITE_DEFAULT_FEED_NETWORK,
    executionEnabled: parsed.VITE_EXECUTION_ENABLED,
  };
}

const RawServerEnvSchema = z
  .object({
    STELLAR_NETWORK: StellarNetworkSchema,
    STELLAR_NETWORK_PASSPHRASE: z
      .string({ required_error: "STELLAR_NETWORK_PASSPHRASE is required" })
      .trim()
      .min(1, "STELLAR_NETWORK_PASSPHRASE cannot be empty"),
    STELLAR_RPC_URLS: parseUrlCsv("STELLAR_RPC_URLS", true),
    HORIZON_URLS: parseUrlCsv("HORIZON_URLS", true),
    TMA_ORIGIN: RequiredUrlSchema("TMA_ORIGIN"),
    ALLOWED_ORIGINS: parseUrlCsv("ALLOWED_ORIGINS", true),
    TELEGRAM_API_ORIGIN: OptionalUrlSchema("TELEGRAM_API_ORIGIN"),
    TG_BOT_USERNAME: OptionalBotUsernameSchema("TG_BOT_USERNAME"),
    TG_MINI_APP_SHORT_NAME: OptionalShortNameSchema("TG_MINI_APP_SHORT_NAME"),
    ASTROWALLET_BOT_USERNAME: RequiredBotUsernameSchema("ASTROWALLET_BOT_USERNAME"),
    ASTROWALLET_MINI_APP_SHORT_NAME: OptionalShortNameSchema("ASTROWALLET_MINI_APP_SHORT_NAME"),
    ASTROWALLET_API_BASE_URL: OptionalUrlSchema("ASTROWALLET_API_BASE_URL"),
    ASTROGATE_BOT_USERNAME: OptionalBotUsernameSchema("ASTROGATE_BOT_USERNAME"),
    ASTROGATE_API_BASE_URL: OptionalUrlSchema("ASTROGATE_API_BASE_URL"),
    ASTROGATE_LAUNCHPAD_CONTRACT_ID: OptionalContractAddressSchema,
    SOROBITS_CONTRACT_ID: OptionalContractAddressSchema,
    SOROSWAP_FACTORY_CONTRACT_ID: OptionalContractAddressSchema,
    SOROSWAP_ROUTER_CONTRACT_ID: OptionalContractAddressSchema,
    XLM_SAC_CONTRACT_ID: OptionalContractAddressSchema,
    REFLECTOR_DEX_ORACLE_CONTRACT_ID: OptionalContractAddressSchema,
    REFLECTOR_CEX_ORACLE_CONTRACT_ID: OptionalContractAddressSchema,
    CHAINLINK_PRICE_PROXY_CONTRACT_ID: OptionalContractAddressSchema,
    SOROSWAP_API_BASE: OptionalUrlSchema("SOROSWAP_API_BASE"),
    XOXNO_SWAP_API_BASE: OptionalUrlSchema("XOXNO_SWAP_API_BASE"),
    STELLAR_EXPERT_API_BASE: OptionalUrlSchema("STELLAR_EXPERT_API_BASE"),
    STELLAR_PRICES_API_BASE: OptionalUrlSchema("STELLAR_PRICES_API_BASE"),
    STELLAR_REGISTRY_API_BASE: OptionalUrlSchema("STELLAR_REGISTRY_API_BASE"),
    SEP42_ASSET_LIST_URLS: parseUrlCsv("SEP42_ASSET_LIST_URLS", false),
    FRIENDBOT_URL: OptionalUrlSchema("FRIENDBOT_URL"),
    MAINNET_NETWORK_PASSPHRASE: OptionalNonEmptyStringSchema,
    MAINNET_RPC_URLS: parseUrlCsv("MAINNET_RPC_URLS", false),
    MAINNET_HORIZON_URLS: parseUrlCsv("MAINNET_HORIZON_URLS", false),
    MAINNET_SEP42_ASSET_LIST_URLS: parseUrlCsv("MAINNET_SEP42_ASSET_LIST_URLS", false),
    MAINNET_SOROSWAP_FACTORY_CONTRACT_ID: OptionalContractAddressSchema,
    MAINNET_SOROSWAP_ROUTER_CONTRACT_ID: OptionalContractAddressSchema,
    MAINNET_XLM_SAC_CONTRACT_ID: OptionalContractAddressSchema,
    MAINNET_REFLECTOR_DEX_ORACLE_CONTRACT_ID: OptionalContractAddressSchema,
    MAINNET_CHAINLINK_PRICE_PROXY_CONTRACT_ID: OptionalContractAddressSchema,
    EXECUTION_ENABLED: parseBooleanWithDefault(true),
    PROXY_RATE_LIMIT_PER_MIN: parsePositiveIntWithDefault(60, 5000),
    QUOTE_RATE_LIMIT_PER_MIN: parsePositiveIntWithDefault(40, 2000),
    TG_BOT_TOKEN: z
      .string({ required_error: "TG_BOT_TOKEN is required" })
      .trim()
      .min(1, "TG_BOT_TOKEN cannot be empty"),
    TG_WEBHOOK_SECRET: z
      .string({ required_error: "TG_WEBHOOK_SECRET is required" })
      .trim()
      .min(16, "TG_WEBHOOK_SECRET must be at least 16 characters"),
    INTENT_HMAC_SECRET: z
      .string({ required_error: "INTENT_HMAC_SECRET is required" })
      .trim()
      .min(32, "INTENT_HMAC_SECRET must be at least 32 characters"),
    SOROSWAP_API_KEY: OptionalNonEmptyStringSchema,
    STELLAR_PRICES_API_KEY: OptionalNonEmptyStringSchema,
    ECOSYSTEM_SHARED_INTENT_SECRET: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .min(32, "ECOSYSTEM_SHARED_INTENT_SECRET must be at least 32 characters")
        .optional(),
    ),
    INDEXER_WEBHOOK_SECRET: OptionalNonEmptyStringSchema,
  })
  .superRefine((env, ctx) => {
    if (env.STELLAR_NETWORK === "mainnet" && env.FRIENDBOT_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FRIENDBOT_URL"],
        message: "FRIENDBOT_URL is strictly forbidden when STELLAR_NETWORK=mainnet",
      });
    }
    validateNetworkCoherence(
      env.STELLAR_NETWORK,
      env.STELLAR_NETWORK_PASSPHRASE,
      [
        ...env.STELLAR_RPC_URLS,
        ...env.HORIZON_URLS,
        env.TMA_ORIGIN,
        ...env.ALLOWED_ORIGINS,
        env.TELEGRAM_API_ORIGIN,
        env.ASTROWALLET_API_BASE_URL,
        env.ASTROGATE_API_BASE_URL,
        env.SOROSWAP_API_BASE,
        env.XOXNO_SWAP_API_BASE,
        env.STELLAR_EXPERT_API_BASE,
        env.STELLAR_PRICES_API_BASE,
        env.STELLAR_REGISTRY_API_BASE,
        ...env.SEP42_ASSET_LIST_URLS,
      ],
      ctx,
      "STELLAR_NETWORK_PASSPHRASE",
      "STELLAR_NETWORK",
    );
  });

export interface ServerConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  rpcUrls: string[];
  horizonUrls: string[];
  tmaOrigin: string;
  allowedOrigins: string[];
  telegramApiOrigin?: string | undefined;
  tgBotUsername?: string | undefined;
  tgMiniAppShortName?: string | undefined;
  astroWalletBotUsername: string;
  astroWalletMiniAppShortName?: string | undefined;
  astroWalletApiBaseUrl?: string | undefined;
  astroGateBotUsername?: string | undefined;
  astroGateApiBaseUrl?: string | undefined;
  astroGateLaunchpadContractId?: ContractAddress | undefined;
  sorobitsContractId?: ContractAddress | undefined;
  soroswapFactoryContractId?: ContractAddress | undefined;
  soroswapRouterContractId?: ContractAddress | undefined;
  xlmSacContractId?: ContractAddress | undefined;
  reflectorDexOracleContractId?: ContractAddress | undefined;
  reflectorCexOracleContractId?: ContractAddress | undefined;
  chainlinkPriceProxyContractId?: ContractAddress | undefined;
  soroswapApiBase?: string | undefined;
  xoxnoSwapApiBase?: string | undefined;
  stellarExpertApiBase?: string | undefined;
  stellarPricesApiBase?: string | undefined;
  stellarRegistryApiBase?: string | undefined;
  sep42AssetListUrls: string[];
  friendbotUrl?: string | undefined;
  mainnetNetworkPassphrase?: string | undefined;
  mainnetRpcUrls: string[];
  mainnetHorizonUrls: string[];
  mainnetSep42AssetListUrls: string[];
  mainnetSoroswapFactoryContractId?: ContractAddress | undefined;
  mainnetSoroswapRouterContractId?: ContractAddress | undefined;
  mainnetXlmSacContractId?: ContractAddress | undefined;
  mainnetReflectorDexOracleContractId?: ContractAddress | undefined;
  mainnetChainlinkPriceProxyContractId?: ContractAddress | undefined;
  executionEnabled: boolean;
  proxyRateLimitPerMin: number;
  quoteRateLimitPerMin: number;
  tgBotToken: string;
  tgWebhookSecret: string;
  intentHmacSecret: string;
  soroswapApiKey?: string | undefined;
  stellarPricesApiKey?: string | undefined;
  ecosystemSharedIntentSecret?: string | undefined;
  indexerWebhookSecret?: string | undefined;
}

export function parseServerConfig(rawEnv: Record<string, unknown>): ServerConfig {
  const parsed = RawServerEnvSchema.parse(rawEnv);
  return {
    network: parsed.STELLAR_NETWORK,
    networkPassphrase: parsed.STELLAR_NETWORK_PASSPHRASE,
    rpcUrls: parsed.STELLAR_RPC_URLS,
    horizonUrls: parsed.HORIZON_URLS,
    tmaOrigin: parsed.TMA_ORIGIN,
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    telegramApiOrigin: parsed.TELEGRAM_API_ORIGIN,
    tgBotUsername: parsed.TG_BOT_USERNAME,
    tgMiniAppShortName: parsed.TG_MINI_APP_SHORT_NAME,
    astroWalletBotUsername: parsed.ASTROWALLET_BOT_USERNAME,
    astroWalletMiniAppShortName: parsed.ASTROWALLET_MINI_APP_SHORT_NAME,
    astroWalletApiBaseUrl: parsed.ASTROWALLET_API_BASE_URL,
    astroGateBotUsername: parsed.ASTROGATE_BOT_USERNAME,
    astroGateApiBaseUrl: parsed.ASTROGATE_API_BASE_URL,
    astroGateLaunchpadContractId: parsed.ASTROGATE_LAUNCHPAD_CONTRACT_ID,
    sorobitsContractId: parsed.SOROBITS_CONTRACT_ID,
    soroswapFactoryContractId: parsed.SOROSWAP_FACTORY_CONTRACT_ID,
    soroswapRouterContractId: parsed.SOROSWAP_ROUTER_CONTRACT_ID,
    xlmSacContractId: parsed.XLM_SAC_CONTRACT_ID,
    reflectorDexOracleContractId: parsed.REFLECTOR_DEX_ORACLE_CONTRACT_ID,
    reflectorCexOracleContractId: parsed.REFLECTOR_CEX_ORACLE_CONTRACT_ID,
    chainlinkPriceProxyContractId: parsed.CHAINLINK_PRICE_PROXY_CONTRACT_ID,
    soroswapApiBase: parsed.SOROSWAP_API_BASE,
    xoxnoSwapApiBase: parsed.XOXNO_SWAP_API_BASE,
    stellarExpertApiBase: parsed.STELLAR_EXPERT_API_BASE,
    stellarPricesApiBase: parsed.STELLAR_PRICES_API_BASE,
    stellarRegistryApiBase: parsed.STELLAR_REGISTRY_API_BASE,
    sep42AssetListUrls: parsed.SEP42_ASSET_LIST_URLS,
    friendbotUrl: parsed.FRIENDBOT_URL,
    mainnetNetworkPassphrase: parsed.MAINNET_NETWORK_PASSPHRASE,
    mainnetRpcUrls: parsed.MAINNET_RPC_URLS,
    mainnetHorizonUrls: parsed.MAINNET_HORIZON_URLS,
    mainnetSep42AssetListUrls: parsed.MAINNET_SEP42_ASSET_LIST_URLS,
    mainnetSoroswapFactoryContractId: parsed.MAINNET_SOROSWAP_FACTORY_CONTRACT_ID,
    mainnetSoroswapRouterContractId: parsed.MAINNET_SOROSWAP_ROUTER_CONTRACT_ID,
    mainnetXlmSacContractId: parsed.MAINNET_XLM_SAC_CONTRACT_ID,
    mainnetReflectorDexOracleContractId: parsed.MAINNET_REFLECTOR_DEX_ORACLE_CONTRACT_ID,
    mainnetChainlinkPriceProxyContractId: parsed.MAINNET_CHAINLINK_PRICE_PROXY_CONTRACT_ID,
    executionEnabled: parsed.EXECUTION_ENABLED,
    proxyRateLimitPerMin: parsed.PROXY_RATE_LIMIT_PER_MIN,
    quoteRateLimitPerMin: parsed.QUOTE_RATE_LIMIT_PER_MIN,
    tgBotToken: parsed.TG_BOT_TOKEN,
    tgWebhookSecret: parsed.TG_WEBHOOK_SECRET,
    intentHmacSecret: parsed.INTENT_HMAC_SECRET,
    soroswapApiKey: parsed.SOROSWAP_API_KEY,
    stellarPricesApiKey: parsed.STELLAR_PRICES_API_KEY,
    ecosystemSharedIntentSecret: parsed.ECOSYSTEM_SHARED_INTENT_SECRET,
    indexerWebhookSecret: parsed.INDEXER_WEBHOOK_SECRET,
  };
}
