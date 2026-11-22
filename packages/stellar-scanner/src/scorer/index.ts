import type {
  AstroGateLaunchpadAudit,
  ClassicIssuerLockResult,
  HolderDistribution,
  Protocol23TtlStatus,
  SecurityFinding,
  SecurityVerdict,
} from "@astrodex/domain";

export interface ScoreComputationInput {
  kind: "native" | "classic" | "soroban";
  code: string;
  isSpoofedProtectedTicker: boolean;
  isSep42Verified: boolean;
  directoryTags: readonly string[];
  classicAudit?: ClassicIssuerLockResult | undefined;
  sorobanAudit?: {
    owner: string | null;
    ownerRenounced: boolean;
    dangerousMethods: readonly string[];
    sep55Verified: boolean;
    registryVerified: boolean;
    ttlStatus?: Protocol23TtlStatus | undefined;
    astroGate?: AstroGateLaunchpadAudit | undefined;
  } | undefined;
  holders?: HolderDistribution | undefined;
}

export interface ScoreComputationOutput {
  astroShieldScore: number;
  verdict: SecurityVerdict;
  trustTier: "official" | "verified" | "unverified" | "spoof_blocked";
  basicSummary: readonly { label: string; passed: boolean; detail: string }[];
  findings: readonly SecurityFinding[];
}

/**
 * Computes deterministic Astro Shield Score (0-100), Basic Plain-English Summary,
 * and Pro Forensic Findings.
 */
export function computeAstroShieldScore(input: ScoreComputationInput): ScoreComputationOutput {
  const findings: SecurityFinding[] = [];
  const basicSummary: Array<{ label: string; passed: boolean; detail: string }> = [];
  let score = 100;

  if (input.kind === "native") {
    return {
      astroShieldScore: 100,
      verdict: "safe",
      trustTier: "official",
      basicSummary: [
        { label: "Native Protocol Asset", passed: true, detail: "Official Stellar Lumens (XLM)" },
        { label: "No Issuer Freeze / Clawback", passed: true, detail: "Native ledger asset" },
      ],
      findings: [],
    };
  }

  // 1. Hard-block spoofed protected tickers & malicious StellarExpert tags
  if (input.isSpoofedProtectedTicker) {
    findings.push({
      code: "SPOOFED_PROTECTED_TICKER",
      severity: "malicious",
      title: `Spoofed ${input.code} Ticker Blocked`,
      description: `This asset uses the protected ticker "${input.code}" from an unverified issuer/contract.`,
      blocksSigning: true,
    });
    basicSummary.push({
      label: "Official Ticker Check",
      passed: false,
      detail: `Fake / spoofed ${input.code} — swap execution blocked`,
    });
    return {
      astroShieldScore: 0,
      verdict: "malicious",
      trustTier: "spoof_blocked",
      basicSummary,
      findings,
    };
  }

  const maliciousTag = input.directoryTags.find((t) => t === "malicious" || t === "unsafe");
  if (maliciousTag) {
    findings.push({
      code: "DIRECTORY_MALICIOUS",
      severity: "malicious",
      title: "Flagged in StellarExpert Directory",
      description: `Issuer/contract carries the "${maliciousTag}" warning tag.`,
      blocksSigning: true,
    });
    score -= 90;
  }

  if (input.isSep42Verified) {
    basicSummary.push({
      label: "Verified Registry",
      passed: true,
      detail: "Listed in SEP-42 Official Asset List",
    });
  } else if (input.sorobanAudit?.astroGate?.isLaunchpadToken) {
    basicSummary.push({
      label: "Fair-Flywheel Launchpad",
      passed: true,
      detail: "Verified AstroGate v4.5 immutable launchpad contract",
    });
  } else {
    score -= 10;
    basicSummary.push({
      label: "Verified Registry",
      passed: false,
      detail: "Unverified community asset — check liquidity & flags carefully",
    });
  }

  // 2. Classic Asset Checks
  if (input.classicAudit) {
    const ca = input.classicAudit;
    if (ca.flags.authClawbackEnabled) {
      score -= 35;
      findings.push({
        code: "CLASSIC_CLAWBACK_ENABLED",
        severity: "warning",
        title: "Clawback Enabled",
        description: "Issuer has AUTH_CLAWBACK_ENABLED and can reclaim tokens from holders.",
        blocksSigning: false,
      });
    }
    if (ca.flags.authRevocable) {
      score -= 20;
      findings.push({
        code: "CLASSIC_FREEZE_ENABLED",
        severity: "warning",
        title: "Freeze Risk (AUTH_REVOCABLE)",
        description: "Issuer can freeze holder trustlines.",
        blocksSigning: false,
      });
    }
    if (!ca.locked) {
      score -= 20;
      findings.push({
        code: "CLASSIC_ISSUER_UNLOCKED",
        severity: "warning",
        title: "Supply Mintable (Issuer Unlocked)",
        description: `Master weight (${ca.masterWeight}) + secondary signers (${ca.combinedSecondaryWeight}) can reach low threshold (${ca.lowThreshold}).`,
        blocksSigning: false,
      });
      basicSummary.push({
        label: "Supply Locked?",
        passed: false,
        detail: "Issuer can still mint additional supply",
      });
    } else {
      basicSummary.push({
        label: "Supply Locked?",
        passed: true,
        detail: "Issuer master & secondary signers mathematically locked",
      });
    }
  }

  // 3. Soroban Asset Checks
  if (input.sorobanAudit) {
    const sa = input.sorobanAudit;
    if (!sa.ownerRenounced && sa.owner !== null) {
      score -= 25;
      findings.push({
        code: "SOROBAN_ACTIVE_OWNER",
        severity: "warning",
        title: "Active Admin / Owner Key",
        description: `Contract still has active owner/admin (${sa.owner}).`,
        blocksSigning: false,
      });
      basicSummary.push({
        label: "Mint Authority",
        passed: false,
        detail: "Contract retains an active owner key",
      });
    } else {
      basicSummary.push({
        label: "Mint Authority",
        passed: true,
        detail: "Owner renounced (fixed supply cap)",
      });
    }

    if (sa.dangerousMethods.length > 0 && !sa.ownerRenounced) {
      score -= 15;
      findings.push({
        code: "SOROBAN_DANGEROUS_METHODS",
        severity: "warning",
        title: "Privileged Contract Methods",
        description: `Spec exposes privileged entrypoints: ${sa.dangerousMethods.join(", ")}.`,
        blocksSigning: false,
      });
    }

    if (sa.astroGate?.isLaunchpadToken) {
      if (sa.astroGate.lpProtection === "unlocked") {
        score -= 30;
        findings.push({
          code: "LP_UNLOCKED",
          severity: "warning",
          title: "Unlocked Liquidity Pool",
          description: "Initial LP tokens are not locked or burned.",
          blocksSigning: false,
        });
      } else {
        basicSummary.push({
          label: "LP Protection",
          passed: true,
          detail:
            sa.astroGate.lpProtection === "bonding_curve"
              ? "Active Bonding Curve (0 -> 1,000 XLM)"
              : sa.astroGate.lpProtection === "locked_7y"
                ? "100% LP Locked 7 Years in Launchpad (48h Timelock)"
                : "100% LP Burned",
        });
      }
    }

    if (sa.ttlStatus?.needsExtension) {
      score -= 5;
      findings.push({
        code: "PROTOCOL23_LOW_TTL",
        severity: "warning",
        title: "Protocol 23 Contract TTL Low",
        description: sa.ttlStatus.isExpiredOrArchived
          ? "Contract state is expired/archived and needs Protocol 23 restore."
          : `Contract TTL has ~${sa.ttlStatus.approxDaysRemaining ?? 0} days remaining; extend TTL soon.`,
        blocksSigning: false,
      });
    }
  }

  // 4. Whale Concentration
  if (input.holders && input.holders.largestNonPoolHolderPct >= 25) {
    score -= 15;
    findings.push({
      code: "HIGH_WHALE_CONCENTRATION",
      severity: "warning",
      title: "High Whale Concentration",
      description: `Largest non-pool holder owns ${input.holders.largestNonPoolHolderPct}% of supply.`,
      blocksSigning: false,
    });
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  const hasMalicious = findings.some((f) => f.severity === "malicious" || f.blocksSigning);
  const verdict: SecurityVerdict = hasMalicious
    ? "malicious"
    : clampedScore >= 75 && !findings.some((f) => f.severity === "warning")
      ? "safe"
      : clampedScore >= 45
        ? "warning"
        : "malicious";

  const trustTier = input.isSep42Verified
    ? "official"
    : input.sorobanAudit?.astroGate?.isLaunchpadToken
      ? "verified"
      : "unverified";

  return {
    astroShieldScore: clampedScore,
    verdict,
    trustTier,
    basicSummary,
    findings,
  };
}
