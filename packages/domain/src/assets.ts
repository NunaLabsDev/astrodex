import { z } from "zod";

export const STROOPS_PER_UNIT = 10_000_000n;

export const AssetIdentifierKindSchema = z.enum(["native", "classic", "soroban"]);
export type AssetIdentifierKind = z.infer<typeof AssetIdentifierKindSchema>;

export interface NormalizedAsset {
  kind: AssetIdentifierKind;
  canonicalKey: string;
  code: string;
  issuer?: string | undefined;
  contractId?: string | undefined;
}

const CLASSIC_KEY_RE = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/;
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;

/**
 * Normalizes Stellar asset identifiers:
 * - `"XLM"` / `"native"` -> `{ kind: "native", canonicalKey: "XLM", code: "XLM" }`
 * - `"CODE:G..."` -> `{ kind: "classic", canonicalKey: "CODE:G...", code, issuer }`
 * - `"C..."` -> `{ kind: "soroban", canonicalKey: "C...", code: "TOKEN", contractId }`
 */
export function normalizeAssetIdentifier(
  raw: string,
  fallbackSymbol?: string,
): NormalizedAsset {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "XLM" || upper === "NATIVE") {
    return {
      kind: "native",
      canonicalKey: "XLM",
      code: "XLM",
    };
  }

  const classicMatch = CLASSIC_KEY_RE.exec(trimmed);
  if (classicMatch?.[1] && classicMatch[2]) {
    const code = classicMatch[1].trim();
    const issuer = classicMatch[2].toUpperCase();
    return {
      kind: "classic",
      canonicalKey: `${code}:${issuer}`,
      code,
      issuer,
    };
  }

  if (CONTRACT_ID_RE.test(upper)) {
    return {
      kind: "soroban",
      canonicalKey: upper,
      code: fallbackSymbol?.trim() || `${upper.slice(0, 4)}..${upper.slice(-4)}`,
      contractId: upper,
    };
  }

  throw new Error(`Invalid Stellar asset identifier "${raw}" (expected XLM, CODE:G..., or C...)`);
}

/**
 * Parses a positive or zero decimal string with up to 7 fractional digits into exact stroops bigint.
 */
export function parseDecimalToStroops7(raw: string): bigint | null {
  const cleaned = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const [wholePart = "0", fracPart = ""] = cleaned.split(".");
  if (fracPart.length > 7) {
    // Truncate beyond 7 Stellar decimal places deterministically
  }
  const frac7 = fracPart.slice(0, 7).padEnd(7, "0");
  return BigInt(wholePart) * STROOPS_PER_UNIT + BigInt(frac7);
}

/**
 * Formats non-negative 7-decimal stroops bigint into a decimal string.
 */
export function formatStroops7(stroops: bigint, trimTrailingZeros = false): string {
  const nonNeg = stroops > 0n ? stroops : 0n;
  const whole = nonNeg / STROOPS_PER_UNIT;
  const frac = (nonNeg % STROOPS_PER_UNIT).toString().padStart(7, "0");
  const full = `${whole.toString()}.${frac}`;
  if (!trimTrailingZeros) return full;
  return full.replace(/\.?0+$/, "");
}

/**
 * Formats stroops to tenths (e.g. 0.5 XLM reserve steps).
 */
export function formatStroopsTenths(stroops: bigint): string {
  const nonNeg = stroops > 0n ? stroops : 0n;
  const tenths = nonNeg / 1_000_000n;
  const whole = tenths / 10n;
  const dec = tenths % 10n;
  return `${whole.toString()}.${dec.toString()}`;
}

/**
 * Computes minimum received stroops using pure integer basis-points arithmetic.
 */
export function calculateMinReceivedStroops7(
  expectedOutputAmount: string,
  slippageBps: number,
): bigint {
  const expectedStroops = parseDecimalToStroops7(expectedOutputAmount);
  if (expectedStroops === null || expectedStroops <= 0n) {
    return 0n;
  }
  const clampedBps = Math.max(1, Math.min(5000, Math.trunc(slippageBps)));
  return (expectedStroops * BigInt(10_000 - clampedBps)) / 10_000n;
}
