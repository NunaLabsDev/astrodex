import type {
  ScanReport,
  SecurityFinding,
  SecurityShieldPort,
  StellarAddress,
} from "@astrodex/domain";
import {
  decodeTransactionEnvelope,
  type DecodedSorobanInvocation,
} from "./decoder.js";
import type { RawXdrInspectRequest, RawXdrInspectResponse } from "./raw-xdr.worker.js";
import {
  classifyVerdict,
  evaluateDecodedTransaction,
  extractBaseDestination,
  type DirectoryTagEntry,
  type VerifiedAssetEntry,
} from "./rules.js";
import { simulateSorobanTransaction, type ShieldFetchLike } from "./simulator.js";

export * from "./decoder.js";
export * from "./rules.js";
export * from "./simulator.js";

export interface PreSignShieldConfig {
  networkPassphrase: string;
  rpcUrls: readonly string[];
  verifiedAssets?: readonly VerifiedAssetEntry[] | undefined;
  directoryLookup?: ((address: string) => Promise<DirectoryTagEntry | null>) | undefined;
  memoRequiredLookup?: ((address: string) => Promise<boolean>) | undefined;
  fetchFn?: ShieldFetchLike | undefined;
}

function collectSorobanContractIds(inv: DecodedSorobanInvocation, out: Set<string>): void {
  if (inv.contractId) out.add(inv.contractId);
  for (const sub of inv.subInvocations) {
    collectSorobanContractIds(sub, out);
  }
}

let workerSeq = 1;

/**
 * Inspects raw XDR inside a lazy-loaded Web Worker (falling back cleanly in Worker-less runtimes).
 */
export async function inspectRawXdrInWorker(
  xdrBase64: string,
  networkPassphrase: string,
): Promise<string> {
  const g = globalThis as unknown as {
    URL?: new (input: string, base?: string) => unknown;
    Worker?: new (url: unknown, opts: { type: "module" }) => {
      onmessage: ((e: { data: RawXdrInspectResponse }) => void) | null;
      onerror: (() => void) | null;
      postMessage(msg: RawXdrInspectRequest): void;
      terminate(): void;
    };
  };

  if (!g.Worker || !g.URL) {
    return JSON.stringify(decodeTransactionEnvelope(xdrBase64, networkPassphrase), null, 2);
  }

  try {
    const metaUrl = (import.meta as unknown as { url?: string }).url;
    const worker = new g.Worker(new g.URL("./raw-xdr.worker.js", metaUrl), {
      type: "module",
    });
    const id = workerSeq++;
    return await new Promise<string>((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data.id !== id) return;
        worker.terminate();
        if (!event.data.ok) {
          reject(new Error(event.data.error));
          return;
        }
        resolve(event.data.jsonPretty);
      };
      worker.onerror = () => {
        worker.terminate();
        try {
          resolve(JSON.stringify(decodeTransactionEnvelope(xdrBase64, networkPassphrase), null, 2));
        } catch (err) {
          reject(err);
        }
      };
      worker.postMessage({ id, xdrBase64, networkPassphrase });
    });
  } catch {
    return JSON.stringify(decodeTransactionEnvelope(xdrBase64, networkPassphrase), null, 2);
  }
}

export function createPreSignSecurityShield(config: PreSignShieldConfig): SecurityShieldPort {
  const fetchFn =
    config.fetchFn ?? ((globalThis as unknown as { fetch: ShieldFetchLike }).fetch);

  return {
    async scanTransactionXdr(
      xdrBase64: string,
      sourceAddress?: StellarAddress,
    ): Promise<ScanReport> {
      const decoded = decodeTransactionEnvelope(xdrBase64, config.networkPassphrase);
      const directoryEntries = new Map<string, DirectoryTagEntry>();
      const memoRequiredDestinations = new Set<string>();
      const inspectTargets = new Set<string>();

      let hasSorobanOp = false;
      for (const op of decoded.operations) {
        if (op.destination) {
          inspectTargets.add(op.destination);
          inspectTargets.add(extractBaseDestination(op.destination));
        }
        if (op.soroban) {
          collectSorobanContractIds(op.soroban, inspectTargets);
        }
        if (op.type === "invokeHostFunction" || op.type === "extendFootprintTtl") {
          hasSorobanOp = true;
        }
      }

      const [sim] = await Promise.all([
        hasSorobanOp && config.rpcUrls.length > 0
          ? simulateSorobanTransaction(config.rpcUrls, xdrBase64, fetchFn)
          : Promise.resolve(null),
        Promise.all(
          [...inspectTargets].map(async (addr) => {
            if (config.directoryLookup) {
              const entry = await config.directoryLookup(addr).catch(() => null);
              if (entry) directoryEntries.set(addr, entry);
            }
            if (config.memoRequiredLookup) {
              const req = await config.memoRequiredLookup(addr).catch(() => false);
              if (req) memoRequiredDestinations.add(addr);
            }
          }),
        ),
      ]);

      const baseReport = evaluateDecodedTransaction(decoded, {
        networkPassphrase: config.networkPassphrase,
        directoryEntries,
        verifiedAssets: config.verifiedAssets,
        memoRequiredDestinations,
        simulatedBalanceDiffs: sim?.balanceDiffs,
      });

      const findings: SecurityFinding[] = [...baseReport.findings];
      if (
        sourceAddress &&
        decoded.sourceAccount !== sourceAddress &&
        decoded.feeSource !== sourceAddress
      ) {
        findings.push({
          code: "SOURCE_ACCOUNT_MISMATCH",
          severity: "malicious",
          title: "Source Account Mismatch Blocked",
          description: `Transaction source (${decoded.sourceAccount}) does not match expected signer (${sourceAddress}).`,
          blocksSigning: true,
        });
      }

      if (!sim) {
        return {
          ...baseReport,
          verdict: classifyVerdict(findings),
          findings,
        };
      }

      if (!sim.ok) {
        findings.push({
          code: "SOROBAN_SIMULATION_FAILED",
          severity: "warning",
          title: "Soroban RPC Simulation Warning",
          description: sim.error ?? "Unable to simulate Soroban transaction",
          blocksSigning: false,
        });
      } else if (sim.requiresProtocol23Restore) {
        findings.push({
          code: "SOROBAN_TTL_RESTORE_REQUIRED",
          severity: "warning",
          title: "Protocol 23 State Restore Required",
          description: "Simulation indicates expired state requiring Protocol 23 restore.",
          blocksSigning: false,
        });
      }

      let estimatedFeeStroops = baseReport.estimatedFeeStroops;
      if (/^\d+$/.test(sim.minResourceFeeStroops)) {
        estimatedFeeStroops = (
          BigInt(baseReport.estimatedFeeStroops) + BigInt(sim.minResourceFeeStroops)
        ).toString();
      }

      return {
        ...baseReport,
        verdict: classifyVerdict(findings),
        findings,
        estimatedFeeStroops,
        requiresProtocol23Restore: sim.requiresProtocol23Restore,
      };
    },

    async scanAddress(address: StellarAddress): Promise<ScanReport> {
      const findings: SecurityFinding[] = [];
      let requiresMemoCheck = false;
      const base = extractBaseDestination(address);
      if (config.directoryLookup) {
        const entry = await config.directoryLookup(base).catch(() => null);
        if (entry?.tags.some((t) => t === "malicious" || t === "unsafe")) {
          findings.push({
            code: "DIRECTORY_MALICIOUS_ADDRESS",
            severity: "malicious",
            title: "Malicious Address Flagged",
            description: `${address} is flagged in StellarExpert Directory.`,
            blocksSigning: true,
          });
        }
        if (entry?.tags.includes("exchange") || entry?.memoRequired) {
          requiresMemoCheck = true;
        }
      }
      if (config.memoRequiredLookup) {
        const sep29 = await config.memoRequiredLookup(base).catch(() => false);
        if (sep29) requiresMemoCheck = true;
      }

      return {
        verdict: classifyVerdict(findings),
        operationsCount: 0,
        findings,
        balanceDiffs: [],
        requiresMemoCheck,
        estimatedFeeStroops: "0",
      };
    },
  };
}
