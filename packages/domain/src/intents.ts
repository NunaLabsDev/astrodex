import { z } from "zod";
import { ResolvedAccountSchema, StellarAddressSchema } from "./accounts.js";
import { StellarNetworkSchema } from "./config.js";

export const TelegramUserIdSchema = z
  .string()
  .regex(/^\d{1,20}$/, "telegramUserId must be an immutable numeric string");

/**
 * Matches AstroWallet's IntentActionType enum for bit-exact cross-app execution.
 */
export const AstroWalletActionTypeSchema = z.enum(["swap", "sign_xdr"]);

export const AstroDexSubActionSchema = z.enum([
  "dex_swap",
  "sdex_limit_order_create",
  "sdex_limit_order_cancel",
  "soroban_extend_ttl",
  "astrogate_buyback_burn",
  "astrogate_claim_jackpot",
  "astrogate_close_curve_refund",
  "sac_bridge_transfer",
]);

export const IntentStatusSchema = z.enum([
  "pending",
  "signed",
  "confirmed",
  "expired",
  "cancelled",
]);

export const CrossAppIntentEnvelopeV1Schema = z.object({
  originApp: z.literal("astrodex"),
  subAction: AstroDexSubActionSchema,
  humanSummary: z.string().min(1).max(280),
  unsignedXdr: z.string().min(16),
  xdrSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  returnStartAppParam: z.string().max(128).optional(),
  fromAsset: z.string().max(80).optional(),
  toAsset: z.string().max(80).optional(),
  amount: z.string().max(40).optional(),
  expectedOutputAmount: z.string().max(40).optional(),
  provider: z.string().max(48).optional(),
  priceImpactPct: z.string().max(24).optional(),
});

export const SignedIntentSchema = z.object({
  intentId: z.string().min(8).max(64),
  network: StellarNetworkSchema,
  creatorTelegramUserId: TelegramUserIdSchema,
  actionType: AstroWalletActionTypeSchema,
  subAction: AstroDexSubActionSchema,
  sourceAddress: StellarAddressSchema,
  payloadJson: z.string().min(2),
  xdrSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  hmacSig: z.string().regex(/^[a-f0-9]{64}$/i),
  status: IntentStatusSchema,
  chatId: z.string().optional(),
  messageId: z.string().optional(),
  inlineMessageId: z.string().optional(),
  txHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  expiresAt: z.number().int().positive(),
  createdAt: z.number().int().positive(),
});

export const AstroIdProfileSchema = z.object({
  found: z.boolean(),
  source: z.enum(["astrowallet", "astrogate", "none"]),
  telegramUserId: TelegramUserIdSchema.optional(),
  usernameLower: z
    .string()
    .regex(/^[a-z0-9_]{3,32}$/)
    .optional(),
  primaryAddress: StellarAddressSchema.optional(),
  accounts: z.array(ResolvedAccountSchema),
  sorobitTokenId: z.string().optional(),
  sorobitSvg: z.string().optional(),
});

export type TelegramUserId = z.infer<typeof TelegramUserIdSchema>;
export type AstroWalletActionType = z.infer<typeof AstroWalletActionTypeSchema>;
export type AstroDexSubAction = z.infer<typeof AstroDexSubActionSchema>;
export type IntentStatus = z.infer<typeof IntentStatusSchema>;
export type CrossAppIntentEnvelopeV1 = z.infer<typeof CrossAppIntentEnvelopeV1Schema>;
export type SignedIntent = z.infer<typeof SignedIntentSchema>;
export type AstroIdProfile = z.infer<typeof AstroIdProfileSchema>;
