import type {
  AstroDexSubAction,
  AstroWalletActionType,
  CrossAppIntentEnvelopeV1,
  StellarNetwork,
} from "@astrodex/domain";

export interface IntentTokenClaims {
  intentId: string;
  network: StellarNetwork;
  telegramUserId: string;
  expiresAt: number;
}

export type VerifyIntentResult =
  | { valid: true }
  | { valid: false; reason: "malformed" | "expired" | "invalid_signature" };

interface MinimalTextEncoder {
  encode(input: string): Uint8Array;
}

interface MinimalSubtleCrypto {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: { name: "HMAC"; hash: "SHA-256" },
    extractable: boolean,
    keyUsages: readonly ("sign" | "verify")[],
  ): Promise<unknown>;
  sign(algorithm: "HMAC", key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

function getWebCrypto(): { subtle: MinimalSubtleCrypto; encoder: MinimalTextEncoder } {
  const g = globalThis as unknown as {
    crypto?: { subtle?: MinimalSubtleCrypto };
    TextEncoder?: new () => MinimalTextEncoder;
  };
  if (!g.crypto?.subtle || !g.TextEncoder) {
    throw new Error("Web Crypto SubtleCrypto and TextEncoder are required");
  }
  return { subtle: g.crypto.subtle, encoder: new g.TextEncoder() };
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Bit-exact 4-field canonical HMAC message matching @astrowallet/tg-protocol:
 * `${network}:${intentId}:${telegramUserId}:${expiresAt}`
 */
export function buildCanonicalIntentMessage(claims: IntentTokenClaims): string {
  return `${claims.network}:${claims.intentId}:${claims.telegramUserId}:${claims.expiresAt}`;
}

export async function sha256Hex(raw: string): Promise<string> {
  const { subtle, encoder } = getWebCrypto();
  const digest = await subtle.digest("SHA-256", encoder.encode(raw));
  return toHex(digest);
}

/**
 * Signs an intent token using the exact 4-field canonical HMAC-SHA256 format expected by AstroWallet.
 */
export async function signIntentToken(
  claims: IntentTokenClaims,
  hmacSecret: string,
): Promise<string> {
  if (!hmacSecret || hmacSecret.length < 32) {
    throw new Error("INTENT_HMAC_SECRET must be at least 32 characters");
  }
  const { subtle, encoder } = getWebCrypto();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign(
    "HMAC",
    key,
    encoder.encode(buildCanonicalIntentMessage(claims)),
  );
  return toHex(sig);
}

/**
 * Verifies a 4-field intent token fail-closed against TTL expiry, network binding, and HMAC signature.
 */
export async function verifyIntentToken(
  claims: IntentTokenClaims,
  signatureHex: string,
  hmacSecret: string,
  nowUnixSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifyIntentResult> {
  if (
    !claims.intentId ||
    !/^\d{1,20}$/.test(claims.telegramUserId) ||
    !/^[a-f0-9]{64}$/i.test(signatureHex)
  ) {
    return { valid: false, reason: "malformed" };
  }

  if (claims.expiresAt <= nowUnixSeconds) {
    return { valid: false, reason: "expired" };
  }

  const expectedHex = await signIntentToken(claims, hmacSecret);
  if (!constantTimeEqualHex(expectedHex, signatureHex.toLowerCase())) {
    return { valid: false, reason: "invalid_signature" };
  }

  return { valid: true };
}

/**
 * Maps any AstroDex sub-action onto AstroWallet's IntentActionType (`swap` | `sign_xdr`)
 * and builds a CrossAppIntentEnvelope v1 payload with SHA-256 XDR binding.
 */
export function mapSubActionToWalletActionType(
  subAction: AstroDexSubAction,
): AstroWalletActionType {
  return subAction === "dex_swap" ? "swap" : "sign_xdr";
}

export async function buildCrossAppIntentEnvelope(input: {
  subAction: AstroDexSubAction;
  humanSummary: string;
  unsignedXdr: string;
  returnStartAppParam?: string | undefined;
  fromAsset?: string | undefined;
  toAsset?: string | undefined;
  amount?: string | undefined;
  expectedOutputAmount?: string | undefined;
  provider?: string | undefined;
  priceImpactPct?: string | undefined;
}): Promise<CrossAppIntentEnvelopeV1> {
  const xdrSha256 = await sha256Hex(input.unsignedXdr);
  return {
    originApp: "astrodex",
    subAction: input.subAction,
    humanSummary: input.humanSummary,
    unsignedXdr: input.unsignedXdr,
    xdrSha256,
    ...(input.returnStartAppParam ? { returnStartAppParam: input.returnStartAppParam } : {}),
    ...(input.fromAsset ? { fromAsset: input.fromAsset } : {}),
    ...(input.toAsset ? { toAsset: input.toAsset } : {}),
    ...(input.amount ? { amount: input.amount } : {}),
    ...(input.expectedOutputAmount
      ? { expectedOutputAmount: input.expectedOutputAmount }
      : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.priceImpactPct ? { priceImpactPct: input.priceImpactPct } : {}),
  };
}

interface MinimalUrlInstance {
  searchParams: { set(name: string, value: string): void };
  toString(): string;
}

function createUrl(raw: string): MinimalUrlInstance {
  const UrlCtor = (globalThis as unknown as { URL?: new (input: string) => MinimalUrlInstance })
    .URL;
  if (!UrlCtor) {
    throw new Error("Global WHATWG URL constructor is required");
  }
  return new UrlCtor(raw);
}

function buildTelegramDeepLink(
  botUsername: string,
  shortName: string | undefined,
  startParam?: string,
  useStartApp = true,
): string {
  const cleanBot = botUsername.trim().replace(/^@/, "");
  const cleanShort = shortName?.trim();
  const base = cleanShort
    ? `https://t.me/${cleanBot}/${cleanShort}`
    : `https://t.me/${cleanBot}`;
  const url = createUrl(base);
  if (startParam) {
    url.searchParams.set(useStartApp ? "startapp" : "start", startParam);
  }
  return url.toString();
}

export function buildAstroWalletIntentLink(opts: {
  astroWalletBotUsername: string;
  astroWalletMiniAppShortName?: string | undefined;
  intentId: string;
  sig: string;
}): string {
  return buildTelegramDeepLink(
    opts.astroWalletBotUsername,
    opts.astroWalletMiniAppShortName,
    `i-${opts.intentId}-${opts.sig.toLowerCase()}`,
    true,
  );
}

export function buildAstroWalletOnboardingLink(opts: {
  astroWalletBotUsername: string;
  astroWalletMiniAppShortName?: string | undefined;
}): string {
  return buildTelegramDeepLink(
    opts.astroWalletBotUsername,
    opts.astroWalletMiniAppShortName,
    "t-vault",
    true,
  );
}

export function buildAstroGateDeepLink(opts: {
  astroGateBotUsername: string;
  startParam: string;
}): string {
  return buildTelegramDeepLink(opts.astroGateBotUsername, undefined, opts.startParam, false);
}

export function buildAstroDexDeepLink(opts: {
  tgBotUsername: string;
  tgMiniAppShortName?: string | undefined;
  startParam?: string | undefined;
}): string {
  return buildTelegramDeepLink(
    opts.tgBotUsername,
    opts.tgMiniAppShortName,
    opts.startParam,
    true,
  );
}
