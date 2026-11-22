import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";

export const STROOPS_PER_UNIT = 10_000_000n;
export const FAIR_LAUNCH_TOTAL_BASIS = 10_000_000n;
export const GRADUATION_TARGET_XLM = 1_000;
export const LP_LOCK_YEARS = 7;

export const CURVE_TOKENS_ALLOC_BASE = 6_600_000n * STROOPS_PER_UNIT;
export const DEX_TOKENS_ALLOC_BASE = 3_300_000n * STROOPS_PER_UNIT;
export const SPARK_JACKPOT_TOKENS = 5_000;
export const CROWN_JACKPOT_TOKENS = 10_000;
export const GRADUATION_JACKPOT_TOKENS = 25_000;

export const CURVE_VIRTUAL_XLM_START_STROOPS = 1_000n * STROOPS_PER_UNIT;
export const CURVE_REAL_XLM_GOAL_STROOPS = 1_000n * STROOPS_PER_UNIT;
export const CURVE_VIRTUAL_TOKEN_START_BASE = 13_200_000n * STROOPS_PER_UNIT;

export const STAGE_1_XLM = 250;
export const STAGE_2_XLM = 500;
export const STAGE_1_XLM_STROOPS = 250n * STROOPS_PER_UNIT;
export const STAGE_2_XLM_STROOPS = 500n * STROOPS_PER_UNIT;

export const BUY_TREASURY_EARLY_BPS = 20n;
export const BUY_FLOOR_EARLY_BPS = 10n;
export const BUY_TREASURY_MID_BPS = 30n;
export const BUY_FLOOR_MID_BPS = 20n;
export const BUY_TREASURY_SPRINT_BPS = 15n;
export const BUY_FLOOR_SPRINT_BPS = 10n;

export const SELL_TREASURY_EARLY_BPS = 30n;
export const SELL_FLOOR_EARLY_BPS = 90n;
export const SELL_TREASURY_MID_BPS = 40n;
export const SELL_FLOOR_MID_BPS = 140n;
export const SELL_TREASURY_SPRINT_BPS = 30n;
export const SELL_FLOOR_SPRINT_BPS = 120n;

export const BUYBACK_MAX_CHUNK_BPS = 25n;
export const BUYBACK_MAX_CHUNK_STROOPS = 8_000_000n; // 0.8000000 XLM
export const BUYBACK_MIN_DUST_STROOPS = 10_000n; // 0.0010000 XLM
export const BUYBACK_KEEPER_BOUNTY_BPS = 200n; // 2%
export const BUYBACK_MAX_BOUNTY_STROOPS = 500_000n; // 0.0500000 XLM

export interface LocalBuyQuote {
  total_xlm_charged: bigint;
  net_xlm_to_curve: bigint;
  treasury_fee: bigint;
  floor_bonus: bigint;
  tokens_out: bigint;
  will_graduate: boolean;
  total_fee_bps: bigint;
}

export interface LocalSellQuote {
  gross_xlm_out: bigint;
  net_xlm_out: bigint;
  treasury_fee: bigint;
  floor_bonus: bigint;
  total_fee_bps: bigint;
}

export function divCeil(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function curveFeeBpsForOrder(
  curveXlmNet: bigint = 0n,
): { treasuryBps: bigint; floorBps: bigint; totalBps: bigint } {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet;
  if (safeNet < STAGE_1_XLM_STROOPS) {
    return {
      treasuryBps: BUY_TREASURY_EARLY_BPS,
      floorBps: BUY_FLOOR_EARLY_BPS,
      totalBps: BUY_TREASURY_EARLY_BPS + BUY_FLOOR_EARLY_BPS,
    };
  }
  if (safeNet < STAGE_2_XLM_STROOPS) {
    return {
      treasuryBps: BUY_TREASURY_MID_BPS,
      floorBps: BUY_FLOOR_MID_BPS,
      totalBps: BUY_TREASURY_MID_BPS + BUY_FLOOR_MID_BPS,
    };
  }
  return {
    treasuryBps: BUY_TREASURY_SPRINT_BPS,
    floorBps: BUY_FLOOR_SPRINT_BPS,
    totalBps: BUY_TREASURY_SPRINT_BPS + BUY_FLOOR_SPRINT_BPS,
  };
}

export function curveSellFeeBps(curveXlmNet: bigint): {
  treasuryBps: bigint;
  floorBps: bigint;
  totalBps: bigint;
} {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet;
  if (safeNet < STAGE_1_XLM_STROOPS) {
    return {
      treasuryBps: SELL_TREASURY_EARLY_BPS,
      floorBps: SELL_FLOOR_EARLY_BPS,
      totalBps: SELL_TREASURY_EARLY_BPS + SELL_FLOOR_EARLY_BPS,
    };
  }
  if (safeNet < STAGE_2_XLM_STROOPS) {
    return {
      treasuryBps: SELL_TREASURY_MID_BPS,
      floorBps: SELL_FLOOR_MID_BPS,
      totalBps: SELL_TREASURY_MID_BPS + SELL_FLOOR_MID_BPS,
    };
  }
  return {
    treasuryBps: SELL_TREASURY_SPRINT_BPS,
    floorBps: SELL_FLOOR_SPRINT_BPS,
    totalBps: SELL_TREASURY_SPRINT_BPS + SELL_FLOOR_SPRINT_BPS,
  };
}

export function curveNextCheckpointStroops(
  curveXlmNet: bigint,
  burnMilestoneStage = 0,
): {
  targetXlm: number;
  rewardTokens: number;
  label: string;
  grossXlmNeededStroops: bigint;
} {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet;
  const { totalBps } = curveFeeBpsForOrder(safeNet);

  if (safeNet < STAGE_1_XLM_STROOPS && burnMilestoneStage < 1) {
    const delta = STAGE_1_XLM_STROOPS - safeNet;
    return {
      targetXlm: STAGE_1_XLM,
      rewardTokens: SPARK_JACKPOT_TOKENS,
      label: "Spark Bonus",
      grossXlmNeededStroops: divCeil(delta * 10_000n, 10_000n - totalBps),
    };
  }
  if (safeNet < STAGE_2_XLM_STROOPS && burnMilestoneStage < 2) {
    const delta = STAGE_2_XLM_STROOPS - safeNet;
    return {
      targetXlm: STAGE_2_XLM,
      rewardTokens: CROWN_JACKPOT_TOKENS,
      label: "King Crown",
      grossXlmNeededStroops: divCeil(delta * 10_000n, 10_000n - totalBps),
    };
  }
  const delta =
    CURVE_REAL_XLM_GOAL_STROOPS > safeNet ? CURVE_REAL_XLM_GOAL_STROOPS - safeNet : 0n;
  return {
    targetXlm: GRADUATION_TARGET_XLM,
    rewardTokens: GRADUATION_JACKPOT_TOKENS,
    label: "Graduation Jackpot",
    grossXlmNeededStroops:
      delta > 0n ? divCeil(delta * 10_000n, 10_000n - totalBps) : 0n,
  };
}

export function curveVirtualReserves(
  curveXlmNet: bigint,
  tokensSold: bigint,
): {
  virtualXlm: bigint;
  virtualTokens: bigint;
  remainingCurveTokens: bigint;
  remainingToGoalXlm: bigint;
} {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet;
  const safeSold = tokensSold < 0n ? 0n : tokensSold;
  return {
    virtualXlm: CURVE_VIRTUAL_XLM_START_STROOPS + safeNet,
    virtualTokens: CURVE_VIRTUAL_TOKEN_START_BASE - safeSold,
    remainingCurveTokens:
      CURVE_TOKENS_ALLOC_BASE > safeSold ? CURVE_TOKENS_ALLOC_BASE - safeSold : 0n,
    remainingToGoalXlm:
      CURVE_REAL_XLM_GOAL_STROOPS > safeNet ? CURVE_REAL_XLM_GOAL_STROOPS - safeNet : 0n,
  };
}

export function localCurveQuoteBuy(
  curveXlmNet: bigint,
  tokensSold: bigint,
  maxXlmIn: bigint,
): LocalBuyQuote | null {
  if (maxXlmIn <= 0n) return null;
  const { virtualXlm, virtualTokens, remainingCurveTokens, remainingToGoalXlm } =
    curveVirtualReserves(curveXlmNet, tokensSold);
  if (remainingToGoalXlm <= 0n || remainingCurveTokens <= 0n) return null;

  const { treasuryBps, floorBps, totalBps } = curveFeeBpsForOrder(curveXlmNet);
  const treasuryFeeFull = (maxXlmIn * treasuryBps) / 10_000n;
  const floorBonusFull = (maxXlmIn * floorBps) / 10_000n;
  const netFull = maxXlmIn - treasuryFeeFull - floorBonusFull;

  if (netFull >= remainingToGoalXlm) {
    const netXlmToCurve = remainingToGoalXlm;
    const maxFeeRoom = maxXlmIn - netXlmToCurve;
    const denom = 10_000n - totalBps;
    const idealGross = divCeil(netXlmToCurve * 10_000n, denom);
    const rawFee = idealGross - netXlmToCurve;
    const idealFee = rawFee < maxFeeRoom ? rawFee : maxFeeRoom;
    const totalXlmCharged = netXlmToCurve + idealFee;
    const treasuryFee = (idealFee * treasuryBps) / (treasuryBps + floorBps);
    const floorBonus = idealFee - treasuryFee;

    return {
      total_xlm_charged: totalXlmCharged,
      net_xlm_to_curve: netXlmToCurve,
      treasury_fee: treasuryFee,
      floor_bonus: floorBonus,
      tokens_out: remainingCurveTokens,
      will_graduate: true,
      total_fee_bps: totalBps,
    };
  }

  if (netFull <= 0n) return null;
  const kCur = virtualXlm * virtualTokens;
  const newVXlm = virtualXlm + netFull;
  const newVTok = divCeil(kCur, newVXlm);
  const tokensOut = virtualTokens - newVTok;
  if (tokensOut <= 0n || tokensOut > remainingCurveTokens) return null;

  return {
    total_xlm_charged: maxXlmIn,
    net_xlm_to_curve: netFull,
    treasury_fee: treasuryFeeFull,
    floor_bonus: floorBonusFull,
    tokens_out: tokensOut,
    will_graduate: false,
    total_fee_bps: totalBps,
  };
}

export function localCurveQuoteSell(
  curveXlmNet: bigint,
  tokensSold: bigint,
  tokenAmount: bigint,
): LocalSellQuote | null {
  if (tokenAmount <= 0n || curveXlmNet <= 0n || tokensSold <= 0n) return null;
  if (tokenAmount > tokensSold) return null;
  const { virtualXlm, virtualTokens } = curveVirtualReserves(curveXlmNet, tokensSold);
  const kCur = virtualXlm * virtualTokens;
  const newVTok = virtualTokens + tokenAmount;
  let newVXlm = divCeil(kCur, newVTok);
  if (newVXlm < CURVE_VIRTUAL_XLM_START_STROOPS) {
    newVXlm = CURVE_VIRTUAL_XLM_START_STROOPS;
  }
  const grossXlmOut = virtualXlm - newVXlm;
  if (grossXlmOut <= 0n || grossXlmOut > curveXlmNet) return null;

  const { treasuryBps, floorBps, totalBps } = curveSellFeeBps(curveXlmNet);
  const treasuryFee = (grossXlmOut * treasuryBps) / 10_000n;
  const floorBonus = (grossXlmOut * floorBps) / 10_000n;
  const netXlmOut = grossXlmOut - treasuryFee - floorBonus;
  if (netXlmOut <= 0n) return null;

  return {
    gross_xlm_out: grossXlmOut,
    net_xlm_out: netXlmOut,
    treasury_fee: treasuryFee,
    floor_bonus: floorBonus,
    total_fee_bps: totalBps,
  };
}

/**
 * Builds unsigned AstroGate v4.5 Launchpad Soroban invocation transactions for AstroWallet signing.
 */
export function buildAstroGateCurveBuyXdr(input: {
  sourceAddress: string;
  launchpadContractId: string;
  tokenContractId: string;
  maxXlmInStroops: bigint;
  minTokensOutBase: bigint;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const contract = new Contract(input.launchpadContractId);
  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "buy_curve",
        new Address(input.sourceAddress).toScVal(),
        new Address(input.tokenContractId).toScVal(),
        nativeToScVal(input.maxXlmInStroops, { type: "i128" }),
        nativeToScVal(input.minTokensOutBase, { type: "i128" }),
      ),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export function buildAstroGateCurveSellXdr(input: {
  sourceAddress: string;
  launchpadContractId: string;
  tokenContractId: string;
  tokenAmountBase: bigint;
  minXlmOutStroops: bigint;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const contract = new Contract(input.launchpadContractId);
  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "sell_curve",
        new Address(input.sourceAddress).toScVal(),
        new Address(input.tokenContractId).toScVal(),
        nativeToScVal(input.tokenAmountBase, { type: "i128" }),
        nativeToScVal(input.minXlmOutStroops, { type: "i128" }),
      ),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export function buildAstroGateBuybackBountyXdr(input: {
  sourceAddress: string;
  launchpadContractId: string;
  tokenContractId: string;
  minTokensOutBase?: bigint | undefined;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const contract = new Contract(input.launchpadContractId);
  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "trigger_buyback_burn_with_bounty",
        new Address(input.sourceAddress).toScVal(),
        new Address(input.tokenContractId).toScVal(),
        nativeToScVal(input.minTokensOutBase ?? 1n, { type: "i128" }),
      ),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export function buildAstroGateClaimJackpotXdr(input: {
  sourceAddress: string;
  launchpadContractId: string;
  tokenContractId: string;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const contract = new Contract(input.launchpadContractId);
  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "claim_jackpot",
        new Address(input.sourceAddress).toScVal(),
        new Address(input.tokenContractId).toScVal(),
      ),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export function buildAstroGateCloseCurveRefundXdr(input: {
  sourceAddress: string;
  launchpadContractId: string;
  tokenContractId: string;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const contract = new Contract(input.launchpadContractId);
  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "close_curve_refund",
        new Address(input.sourceAddress).toScVal(),
        new Address(input.tokenContractId).toScVal(),
      ),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}
