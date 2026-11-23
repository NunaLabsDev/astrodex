import {
  buildAstroWalletIntentDeepLink,
  buildAstroWalletOnboardingDeepLink,
  buildCanonicalIntentMessage as sdkBuildCanonicalIntentMessage,
  buildCrossAppIntentEnvelope as sdkBuildCrossAppIntentEnvelope,
  buildTelegramMiniAppLink,
  sha256Hex as sdkSha256Hex,
  signIntentToken as sdkSignIntentToken,
  verifyIntentToken as sdkVerifyIntentToken,
} from "@astrowallet/connect";
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

/**
 * Bit-exact 4-field canonical HMAC message matching @astrowallet/tg-protocol:
 * `${network}:${intentId}:${telegramUserId}:${expiresAt}`
 */
export function buildCanonicalIntentMessage(claims: IntentTokenClaims): string {
  return sdkBuildCanonicalIntentMessage(claims);
}

export async function sha256Hex(raw: string): Promise<string> {
  return sdkSha256Hex(raw);
}

/**
 * Signs an intent token using the exact 4-field canonical HMAC-SHA256 format expected by AstroWallet.
 */
export async function signIntentToken(
  claims: IntentTokenClaims,
  hmacSecret: string,
): Promise<string> {
  return sdkSignIntentToken(claims, hmacSecret);
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
  return sdkVerifyIntentToken(claims, signatureHex, hmacSecret, nowUnixSeconds);
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
  const envelope = await sdkBuildCrossAppIntentEnvelope({
    originApp: "astrodex",
    ...input,
  });
  return envelope as CrossAppIntentEnvelopeV1;
}

export function buildAstroWalletIntentLink(opts: {
  astroWalletBotUsername: string;
  astroWalletMiniAppShortName?: string | undefined;
  intentId: string;
  sig: string;
}): string {
  return buildAstroWalletIntentDeepLink(opts);
}

export function buildAstroWalletOnboardingLink(opts: {
  astroWalletBotUsername: string;
  astroWalletMiniAppShortName?: string | undefined;
}): string {
  return buildAstroWalletOnboardingDeepLink(opts);
}

export function buildAstroGateDeepLink(opts: {
  astroGateBotUsername: string;
  startParam: string;
}): string {
  return buildTelegramMiniAppLink({
    botUsername: opts.astroGateBotUsername,
    startParam: opts.startParam,
    useStartApp: false,
  });
}

export function buildAstroDexDeepLink(opts: {
  tgBotUsername: string;
  tgMiniAppShortName?: string | undefined;
  startParam?: string | undefined;
}): string {
  return buildTelegramMiniAppLink({
    botUsername: opts.tgBotUsername,
    miniAppShortName: opts.tgMiniAppShortName,
    startParam: opts.startParam,
    useStartApp: true,
  });
}
