import type {
  BalanceDiff,
  ScanReport,
  SecurityFinding,
  SecurityVerdict,
} from "@astrodex/domain";
import { MuxedAccount, StrKey } from "@stellar/stellar-sdk";
import type {
  DecodedSorobanInvocation,
  DecodedTransactionSummary,
} from "./decoder.js";

export interface DirectoryTagEntry {
  address: string;
  name?: string | undefined;
  tags: readonly string[];
  memoRequired?: boolean | undefined;
}

export interface VerifiedAssetEntry {
  code: string;
  issuer?: string | undefined;
  contract?: string | undefined;
}

export interface SecurityRuleContext {
  networkPassphrase: string;
  directoryEntries?: ReadonlyMap<string, DirectoryTagEntry> | undefined;
  verifiedAssets?: readonly VerifiedAssetEntry[] | undefined;
  memoRequiredDestinations?: ReadonlySet<string> | undefined;
  simulatedBalanceDiffs?: readonly BalanceDiff[] | undefined;
}

const PROTECTED_TICKERS = new Set([
  "XLM",
  "USDC",
  "EURC",
  "PYUSD",
  "AQUA",
  "BTC",
  "ETH",
  "USDT",
  "USDT0",
  "USDE",
  "SUSDE",
  "YUSDC",
  "YXLM",
]);

const PHISHING_URL_REGEX =
  /(https?:\/\/|t\.me\/|bit\.ly\/|tinyurl\.com\/|[a-z0-9-]+\.(xyz|top|click|site|online|vip|claim|airdrop)\b)/i;

const DANGEROUS_SOROBAN_FUNCTIONS = new Set([
  "update_current_contract_wasm",
  "upgrade",
  "add_signer",
  "add_context_rule",
  "update_context_rule",
  "remove_signer",
  "burn",
  "burn_from",
  "clawback",
  "set_admin",
  "set_authorized",
]);

export function extractBaseDestination(destination: string): string {
  const cleaned = destination.trim();
  if (!cleaned.startsWith("M") || !StrKey.isValidMed25519PublicKey(cleaned)) {
    return cleaned;
  }
  try {
    return MuxedAccount.fromAddress(cleaned, "0").baseAccount().accountId();
  } catch {
    return cleaned;
  }
}

export function classifyVerdict(findings: readonly SecurityFinding[]): SecurityVerdict {
  if (findings.some((f) => f.severity === "malicious" || f.blocksSigning)) {
    return "malicious";
  }
  if (findings.some((f) => f.severity === "warning")) {
    return "warning";
  }
  return "safe";
}

function checkSorobanInvocation(
  inv: DecodedSorobanInvocation,
  depth: number,
  directory: ReadonlyMap<string, DirectoryTagEntry> | undefined,
  findings: SecurityFinding[],
): void {
  if (inv.contractId && directory) {
    const entry = directory.get(inv.contractId);
    if (entry?.tags.some((t) => t === "malicious" || t === "unsafe")) {
      findings.push({
        code: "DIRECTORY_MALICIOUS_CONTRACT",
        severity: "malicious",
        title: "Malicious Soroban Contract Flagged",
        description: `Contract ${inv.contractId} is flagged in StellarExpert Directory.`,
        blocksSigning: true,
      });
    }
  }

  const fnLower = inv.functionName.toLowerCase();
  if (DANGEROUS_SOROBAN_FUNCTIONS.has(fnLower)) {
    findings.push({
      code: "MALICIOUS_SOROBAN_FUNCTION",
      severity: "malicious",
      title: `Dangerous Soroban Function Blocked (${inv.functionName})`,
      description: `Invocation targets privileged entrypoint "${inv.functionName}".`,
      blocksSigning: true,
    });
  } else if (fnLower === "approve" && depth > 0) {
    findings.push({
      code: "SOROBAN_NESTED_TOKEN_APPROVAL",
      severity: "malicious",
      title: "Hidden Nested Token Approval Blocked",
      description: `Nested sub-invocation calls "${inv.functionName}" on ${inv.contractId ?? "a contract"}.`,
      blocksSigning: true,
    });
  }

  for (const sub of inv.subInvocations) {
    checkSorobanInvocation(sub, depth + 1, directory, findings);
  }
}

export function evaluateDecodedTransaction(
  decoded: DecodedTransactionSummary,
  context: SecurityRuleContext,
): ScanReport {
  const findings: SecurityFinding[] = [];
  const balanceDiffs: BalanceDiff[] = [...(context.simulatedBalanceDiffs ?? [])];
  let requiresMemoCheck = false;

  if (decoded.memo.value && PHISHING_URL_REGEX.test(decoded.memo.value)) {
    findings.push({
      code: "MALICIOUS_MEMO_PHISHING_URL",
      severity: "warning",
      title: "Suspicious URL in Transaction Memo",
      description: `Memo contains a link (${decoded.memo.value.slice(0, 64)}); never visit unsolicited airdrop or claim links.`,
      blocksSigning: false,
    });
  }

  for (const op of decoded.operations) {
    if (op.type === "setOptions") {
      if (op.signerKey && (op.signerWeight ?? 0) > 0) {
        findings.push({
          code: "MALICIOUS_SET_OPTIONS_SIGNER",
          severity: "malicious",
          title: "Account Takeover Blocked (setOptions)",
          description: `Adds unknown signer ${op.signerKey} with weight ${op.signerWeight}.`,
          blocksSigning: true,
        });
      }
      if (op.masterWeight === 0) {
        findings.push({
          code: "MALICIOUS_SET_OPTIONS_MASTER_LOCKOUT",
          severity: "malicious",
          title: "Master Key Lockout Blocked",
          description: "Sets master key weight to 0.",
          blocksSigning: true,
        });
      }
      const maxThresh = Math.max(
        op.lowThreshold ?? 0,
        op.medThreshold ?? 0,
        op.highThreshold ?? 0,
      );
      if (
        maxThresh > 0 &&
        ((op.masterWeight !== undefined && maxThresh > op.masterWeight) || op.masterWeight === undefined)
      ) {
        findings.push({
          code: "SUSPICIOUS_SET_OPTIONS_THRESHOLDS",
          severity: "malicious",
          title: "Threshold Lockout Blocked (setOptions)",
          description: `Raises account signature thresholds (max=${maxThresh}) without matching master weight.`,
          blocksSigning: true,
        });
      }
      if ((op.setFlags ?? 0) > 0 || (op.clearFlags ?? 0) > 0 || op.inflationDest) {
        findings.push({
          code: "SUSPICIOUS_SET_OPTIONS_FLAGS",
          severity: "warning",
          title: "Account Flags / Inflation Modified",
          description: "Transaction alters account flags or inflation destination via setOptions.",
          blocksSigning: false,
        });
      }
    }

    if (op.type === "accountMerge") {
      findings.push({
        code: "DANGEROUS_ACCOUNT_MERGE",
        severity: "malicious",
        title: "Account Merge Drain Blocked",
        description: `Destroys account and sweeps XLM to ${op.destination ?? "destination"}.`,
        blocksSigning: true,
      });
    }

    if (op.type === "clawback" || op.type === "clawbackClaimableBalance") {
      findings.push({
        code: "MALICIOUS_CLAWBACK",
        severity: "malicious",
        title: "Clawback Operation Blocked",
        description: `Transaction invokes "${op.type}".`,
        blocksSigning: true,
      });
    }

    if (op.destination) {
      const baseDest = extractBaseDestination(op.destination);
      const dirEntry =
        context.directoryEntries?.get(baseDest) ?? context.directoryEntries?.get(op.destination);
      if (dirEntry?.tags.some((t) => t === "malicious" || t === "unsafe")) {
        findings.push({
          code: "DIRECTORY_MALICIOUS_DESTINATION",
          severity: "malicious",
          title: "Malicious Destination Blocked",
          description: `Destination ${op.destination} is flagged in StellarExpert Directory.`,
          blocksSigning: true,
        });
      }
      const needsMemo =
        Boolean(dirEntry?.memoRequired) ||
        Boolean(dirEntry?.tags.includes("exchange")) ||
        Boolean(context.memoRequiredDestinations?.has(baseDest));
      if (needsMemo) {
        requiresMemoCheck = true;
        if (!op.destination.startsWith("M") && (!decoded.memo.value || decoded.memo.type === "none")) {
          findings.push({
            code: "MISSING_SEP29_EXCHANGE_MEMO",
            severity: "malicious",
            title: "Missing Exchange Memo (SEP-29)",
            description: `Destination ${op.destination} requires a deposit Memo.`,
            blocksSigning: true,
          });
        }
      }
    }

    const assetsToCheck = [op.asset, op.sendAsset, op.destAsset, op.selling, op.buying].filter(
      (a): a is NonNullable<typeof a> => a !== undefined,
    );
    const verified = context.verifiedAssets ?? [];
    for (const asset of assetsToCheck) {
      const upper = asset.code.toUpperCase();
      if (upper !== "XLM" && asset.issuer && PROTECTED_TICKERS.has(upper)) {
        if (verified.length === 0) {
          findings.push({
            code: "UNVERIFIED_PROTECTED_TICKER_LIST",
            severity: "warning",
            title: `Unverified Protected Ticker (${asset.code})`,
            description: `SEP-42 verified asset registry was unavailable to confirm ${asset.code} (${asset.issuer}).`,
            blocksSigning: false,
          });
        } else {
          const isOfficial = verified.some(
            (v) => v.code.toUpperCase() === upper && v.issuer?.toUpperCase() === asset.issuer?.toUpperCase(),
          );
          if (!isOfficial && verified.some((v) => v.code.toUpperCase() === upper)) {
            findings.push({
              code: "SPOOFED_PROTECTED_ASSET",
              severity: "malicious",
              title: `Spoofed ${asset.code} Issuer Blocked`,
              description: `Asset ${asset.code} (${asset.issuer}) does not match the SEP-42 official issuer.`,
              blocksSigning: true,
            });
          }
        }
      }
    }

    if (op.soroban) {
      checkSorobanInvocation(op.soroban, 0, context.directoryEntries, findings);
    }
  }

  return {
    verdict: classifyVerdict(findings),
    operationsCount: decoded.operations.length,
    findings,
    balanceDiffs,
    requiresMemoCheck,
    estimatedFeeStroops: decoded.feeStroops,
  };
}
