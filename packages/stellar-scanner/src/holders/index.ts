import type { HolderDistribution, HolderEntry } from "@astrodex/domain";
import { CANONICAL_STELLAR_BURN_ADDRESS } from "../soroban/index.js";

export interface RawBalanceSnapshot {
  address: string;
  balanceBase: bigint;
  isPoolOrContract?: boolean | undefined;
  label?: string | undefined;
}

/**
 * Reconstructs Top-10 Holder & Whale concentration cleanly from authoritative pool reserves
 * and observed holder snapshots, separating liquidity pools / burn sinks from external whales.
 */
export function computeHolderDistribution(input: {
  totalSupplyBase: bigint;
  snapshots: readonly RawBalanceSnapshot[];
  pairId?: string | undefined;
  creator?: string | undefined;
}): HolderDistribution {
  if (input.totalSupplyBase <= 0n || input.snapshots.length === 0) {
    return {
      totalSupplyBase: input.totalSupplyBase.toString(),
      top10ConcentrationPct: 0,
      largestNonPoolHolderPct: 0,
      holders: [],
    };
  }

  const merged = new Map<string, { balance: bigint; isPoolOrContract: boolean; label?: string | undefined }>();
  for (const snap of input.snapshots) {
    if (snap.balanceBase <= 0n) continue;
    const isPool =
      Boolean(snap.isPoolOrContract) ||
      snap.address === input.pairId ||
      snap.address === CANONICAL_STELLAR_BURN_ADDRESS ||
      snap.address.startsWith("C");
    const label =
      snap.label ??
      (snap.address === input.pairId
        ? "Liquidity Pool"
        : snap.address === CANONICAL_STELLAR_BURN_ADDRESS
          ? "Burn Sink"
          : snap.address === input.creator
            ? "Creator"
            : undefined);

    const existing = merged.get(snap.address);
    merged.set(snap.address, {
      balance: (existing?.balance ?? 0n) + snap.balanceBase,
      isPoolOrContract: existing?.isPoolOrContract ?? isPool,
      label: existing?.label ?? label,
    });
  }

  const sorted = Array.from(merged.entries())
    .sort((a, b) => (a[1].balance > b[1].balance ? -1 : a[1].balance < b[1].balance ? 1 : 0))
    .slice(0, 10);

  let top10NonPoolSum = 0n;
  let largestNonPool = 0n;

  const holders: HolderEntry[] = sorted.map(([address, info]) => {
    const pctBps = Number((info.balance * 10_000n) / input.totalSupplyBase) / 100;
    if (!info.isPoolOrContract) {
      top10NonPoolSum += info.balance;
      if (info.balance > largestNonPool) largestNonPool = info.balance;
    }
    return {
      address,
      balanceBase: info.balance.toString(),
      percentOfSupply: Number(pctBps.toFixed(2)),
      label: info.label,
      isPoolOrContract: info.isPoolOrContract,
    };
  });

  const top10ConcentrationPct = Number(
    (Number((top10NonPoolSum * 10_000n) / input.totalSupplyBase) / 100).toFixed(2),
  );
  const largestNonPoolHolderPct = Number(
    (Number((largestNonPool * 10_000n) / input.totalSupplyBase) / 100).toFixed(2),
  );

  return {
    totalSupplyBase: input.totalSupplyBase.toString(),
    top10ConcentrationPct,
    largestNonPoolHolderPct,
    holders,
  };
}
