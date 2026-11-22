import { z } from "zod";
import { StellarAddressSchema } from "./accounts.js";

export const SecurityVerdictSchema = z.enum(["safe", "warning", "malicious"]);
export const FindingSeveritySchema = z.enum(["info", "warning", "malicious"]);

export const SecurityFindingSchema = z.object({
  code: z.string().min(1),
  severity: FindingSeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  blocksSigning: z.boolean(),
});

export const BalanceDiffSchema = z.object({
  address: StellarAddressSchema,
  asset: z.string().min(1),
  delta: z.string().min(1),
});

export const ScanReportSchema = z.object({
  verdict: SecurityVerdictSchema,
  operationsCount: z.number().int().nonnegative(),
  findings: z.array(SecurityFindingSchema),
  balanceDiffs: z.array(BalanceDiffSchema),
  requiresMemoCheck: z.boolean(),
  estimatedFeeStroops: z.string().regex(/^\d+$/),
  requiresProtocol23Restore: z.boolean().optional(),
  assembledXdr: z.string().min(16).optional(),
});

export interface ClassicIssuerLockResult {
  locked: boolean;
  masterWeight: number;
  lowThreshold: number;
  medThreshold: number;
  highThreshold: number;
  maxSignerWeight: number;
  combinedSecondaryWeight: number;
  signerCount: number;
  flags: {
    authRequired: boolean;
    authRevocable: boolean;
    authImmutable: boolean;
    authClawbackEnabled: boolean;
  };
}

export interface Protocol23TtlStatus {
  contractId: string;
  currentLedger: number;
  liveUntilLedgerSeq: number | null;
  ledgersRemaining: number | null;
  approxDaysRemaining: number | null;
  needsExtension: boolean;
  isExpiredOrArchived: boolean;
}

export interface HolderEntry {
  address: string;
  balanceBase: string;
  percentOfSupply: number;
  label?: string | undefined;
  isPoolOrContract: boolean;
}

export interface HolderDistribution {
  totalSupplyBase: string;
  top10ConcentrationPct: number;
  largestNonPoolHolderPct: number;
  holders: readonly HolderEntry[];
}

export interface AstroGateLaunchpadAudit {
  isLaunchpadToken: boolean;
  version: "v4.5" | "v4.4" | "none";
  graduated: boolean;
  curveClosed: boolean;
  curveXlmNetStroops: string;
  graduationProgressPct: number;
  lpProtection: "bonding_curve" | "locked_7y" | "burned" | "unlocked";
  lpLockedPercent: number;
  has48hTimelock: boolean;
  pairId?: string | undefined;
  creator?: string | undefined;
  logoSha256Url?: string | undefined;
  sorobitXpEligible?: boolean | undefined;
}

export interface TokenForensicAudit {
  assetKey: string;
  kind: "native" | "classic" | "soroban";
  code: string;
  name?: string | undefined;
  issuer?: string | undefined;
  contractId?: string | undefined;
  sacContractId?: string | undefined;
  decimals: number;
  logoUrl?: string | undefined;
  homeDomain?: string | undefined;
  astroShieldScore: number;
  verdict: z.infer<typeof SecurityVerdictSchema>;
  trustTier: "official" | "verified" | "unverified" | "spoof_blocked";
  basicSummary: readonly {
    label: string;
    passed: boolean;
    detail: string;
  }[];
  findings: readonly z.infer<typeof SecurityFindingSchema>[];
  classicAudit?: ClassicIssuerLockResult | undefined;
  sorobanAudit?: {
    owner: string | null;
    ownerRenounced: boolean;
    dangerousMethods: readonly string[];
    sep55Verified: boolean;
    registryVerified: boolean;
    wasmHash?: string | undefined;
    ttlStatus?: Protocol23TtlStatus | undefined;
    astroGate?: AstroGateLaunchpadAudit | undefined;
  } | undefined;
  holders?: HolderDistribution | undefined;
  directoryTags: readonly string[];
  auditedAtUnix: number;
}

export type SecurityVerdict = z.infer<typeof SecurityVerdictSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;
export type BalanceDiff = z.infer<typeof BalanceDiffSchema>;
export type ScanReport = z.infer<typeof ScanReportSchema>;
