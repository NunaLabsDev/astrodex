import { z } from "zod";
import { parseDecimalToStroops7, formatStroops7, formatStroopsTenths } from "./assets.js";

export const ClassicAddressSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar classic public key (expected G...)");

export const ContractAddressSchema = z
  .string()
  .regex(/^C[A-Z2-7]{55}$/, "Invalid Soroban contract address (expected C...)");

export const MuxedAddressSchema = z
  .string()
  .regex(/^M[A-Z2-7]{68}$/, "Invalid Stellar muxed address (expected M...)");

export const StellarAddressSchema = z.union([
  ClassicAddressSchema,
  ContractAddressSchema,
  MuxedAddressSchema,
]);

export const AccountKindSchema = z.enum(["classic", "smart"]);

export const AccountCapabilitiesSchema = z.object({
  canPlaceClassicSdexOffers: z.boolean(),
  canUseHorizonPathPayments: z.boolean(),
  canHoldNativeTrustlines: z.boolean(),
  supportsSorobanAmms: z.boolean(),
  supportsGaslessExecution: z.boolean(),
});

export const ResolvedAccountSchema = z.object({
  address: StellarAddressSchema,
  kind: AccountKindSchema,
  label: z.string().min(1).max(32),
  isDefault: z.boolean(),
  capabilities: AccountCapabilitiesSchema,
});

export type ClassicAddress = z.infer<typeof ClassicAddressSchema>;
export type ContractAddress = z.infer<typeof ContractAddressSchema>;
export type MuxedAddress = z.infer<typeof MuxedAddressSchema>;
export type StellarAddress = z.infer<typeof StellarAddressSchema>;
export type AccountKind = z.infer<typeof AccountKindSchema>;
export type AccountCapabilities = z.infer<typeof AccountCapabilitiesSchema>;
export type ResolvedAccount = z.infer<typeof ResolvedAccountSchema>;

/**
 * Returns truthful Stellar protocol capabilities for Classic (G...) vs Smart Account (C...).
 */
export function defaultCapabilitiesForKind(kind: AccountKind): AccountCapabilities {
  if (kind === "classic") {
    return {
      canPlaceClassicSdexOffers: true,
      canUseHorizonPathPayments: true,
      canHoldNativeTrustlines: true,
      supportsSorobanAmms: true,
      supportsGaslessExecution: false,
    };
  }
  return {
    canPlaceClassicSdexOffers: false,
    canUseHorizonPathPayments: false,
    canHoldNativeTrustlines: false,
    supportsSorobanAmms: true,
    supportsGaslessExecution: true,
  };
}

export interface ZeroBalanceTrustline {
  assetCode: string;
  assetIssuer: ClassicAddress;
}

export interface AccountReserveSummary {
  baseEntries: number;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  effectiveEntries: number;
  minReserveXlm: string;
  spendableXlm: string;
  reclaimableTrustlines: readonly ZeroBalanceTrustline[];
  reclaimableXlm: string;
}

export interface AccountReserveCalculationInput {
  nativeBalanceXlm: string;
  subentryCount: number;
  numSponsoring?: number | undefined;
  numSponsored?: number | undefined;
  sellingLiabilitiesXlm?: string | undefined;
  balances?: readonly {
    assetCode: string;
    assetIssuer?: string | undefined;
    balance: string;
  }[] | undefined;
}

const RESERVE_PER_ENTRY_STROOPS = 5_000_000n;

/**
 * Computes Classic Stellar XLM reserves: (2 + subentries + sponsoring - sponsored) * 0.5 XLM,
 * spendable XLM after reserves and selling liabilities, and zero-balance trustlines eligible for reclaim.
 */
export function calculateAccountReserveSummary(
  input: AccountReserveCalculationInput,
): AccountReserveSummary {
  const baseEntries = 2;
  const subentryCount = Math.max(0, Math.trunc(input.subentryCount));
  const numSponsoring = Math.max(0, Math.trunc(input.numSponsoring ?? 0));
  const numSponsored = Math.max(0, Math.trunc(input.numSponsored ?? 0));
  const effectiveEntries = Math.max(0, baseEntries + subentryCount + numSponsoring - numSponsored);

  const minReserveStroops = BigInt(effectiveEntries) * RESERVE_PER_ENTRY_STROOPS;
  const nativeStroops = parseDecimalToStroops7(input.nativeBalanceXlm) ?? 0n;
  const sellingLiabStroops = parseDecimalToStroops7(input.sellingLiabilitiesXlm ?? "0") ?? 0n;
  const rawSpendable = nativeStroops - minReserveStroops - sellingLiabStroops;
  const spendableStroops = rawSpendable > 0n ? rawSpendable : 0n;

  const reclaimableTrustlines: ZeroBalanceTrustline[] = [];
  for (const item of input.balances ?? []) {
    const parsedBal = parseDecimalToStroops7(item.balance);
    if (
      item.assetCode !== "XLM" &&
      item.assetIssuer &&
      ClassicAddressSchema.safeParse(item.assetIssuer).success &&
      parsedBal !== null &&
      parsedBal === 0n
    ) {
      reclaimableTrustlines.push({
        assetCode: item.assetCode,
        assetIssuer: item.assetIssuer as ClassicAddress,
      });
    }
  }

  const reclaimableStroops = BigInt(reclaimableTrustlines.length) * RESERVE_PER_ENTRY_STROOPS;

  return {
    baseEntries,
    subentryCount,
    numSponsoring,
    numSponsored,
    effectiveEntries,
    minReserveXlm: formatStroopsTenths(minReserveStroops),
    spendableXlm: formatStroops7(spendableStroops),
    reclaimableTrustlines,
    reclaimableXlm: formatStroopsTenths(reclaimableStroops),
  };
}
