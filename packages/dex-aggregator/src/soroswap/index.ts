import {
  formatStroops7,
  normalizeAssetIdentifier,
  parseDecimalToStroops7,
  type RouteQuote,
} from "@astrodex/domain";
import {
  Account,
  Address,
  Asset,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type AggregatorFetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  },
) => Promise<MinimalFetchResponse>;

const READONLY_SIM_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * Derives the Soroban C... contract ID (native XLM SAC, Classic SAC, or Soroban C...) for an asset identifier.
 */
export function deriveContractIdForAsset(
  assetIdentifier: string,
  networkPassphrase: string,
  xlmSacContractId?: string,
): string {
  const norm = normalizeAssetIdentifier(assetIdentifier);
  if (norm.kind === "soroban" && norm.contractId) {
    return norm.contractId;
  }
  if (norm.kind === "native") {
    return xlmSacContractId ?? Asset.native().contractId(networkPassphrase);
  }
  if (norm.kind === "classic" && norm.issuer) {
    return new Asset(norm.code, norm.issuer).contractId(networkPassphrase);
  }
  throw new Error(`Cannot derive Soroban contract ID for "${assetIdentifier}"`);
}

async function simulateSoroswapReadOnly(input: {
  rpcUrls: readonly string[];
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
  networkPassphrase: string;
  fetchFn: AggregatorFetchLike;
}): Promise<unknown | null> {
  const contract = new Contract(input.contractId);
  const tx = new TransactionBuilder(new Account(READONLY_SIM_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(contract.call(input.method, ...(input.args ?? [])))
    .setTimeout(30)
    .build();

  for (const url of input.rpcUrls) {
    try {
      const res = await input.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: { transaction: tx.toXDR() },
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        result?: { results?: Array<{ xdr?: string }> };
      };
      const rawXdr = body.result?.results?.[0]?.xdr;
      if (!rawXdr) continue;
      return scValToNative(xdr.ScVal.fromXDR(rawXdr, "base64"));
    } catch {
      // Fail over to next RPC endpoint
    }
  }
  return null;
}

/**
 * Resolves a Soroswap Pair contract via `pairContractId` or `Factory.get_pair(a, b)` and reads
 * live `token_0()`, `token_1()`, and `get_reserves()` directly from Soroban RPC.
 */
export async function fetchSoroswapDirectPairReserves(input: {
  rpcUrls: readonly string[];
  factoryContractId?: string | undefined;
  pairContractId?: string | undefined;
  tokenInContractId: string;
  tokenOutContractId: string;
  networkPassphrase: string;
  fetchFn: AggregatorFetchLike;
}): Promise<{
  pairId: string;
  reserveIn: bigint;
  reserveOut: bigint;
} | null> {
  let pairId = input.pairContractId;
  if (!pairId && input.factoryContractId) {
    const resolved = await simulateSoroswapReadOnly({
      rpcUrls: input.rpcUrls,
      contractId: input.factoryContractId,
      method: "get_pair",
      args: [
        new Address(input.tokenInContractId).toScVal(),
        new Address(input.tokenOutContractId).toScVal(),
      ],
      networkPassphrase: input.networkPassphrase,
      fetchFn: input.fetchFn,
    });
    if (typeof resolved === "string" && /^C[A-Z2-7]{55}$/.test(resolved)) {
      pairId = resolved;
    }
  }
  if (!pairId) return null;

  const [token0Raw, token1Raw, reservesRaw] = await Promise.all([
    simulateSoroswapReadOnly({
      rpcUrls: input.rpcUrls,
      contractId: pairId,
      method: "token_0",
      networkPassphrase: input.networkPassphrase,
      fetchFn: input.fetchFn,
    }),
    simulateSoroswapReadOnly({
      rpcUrls: input.rpcUrls,
      contractId: pairId,
      method: "token_1",
      networkPassphrase: input.networkPassphrase,
      fetchFn: input.fetchFn,
    }),
    simulateSoroswapReadOnly({
      rpcUrls: input.rpcUrls,
      contractId: pairId,
      method: "get_reserves",
      networkPassphrase: input.networkPassphrase,
      fetchFn: input.fetchFn,
    }),
  ]);

  if (typeof token0Raw !== "string" || typeof token1Raw !== "string" || !Array.isArray(reservesRaw) || reservesRaw.length < 2) {
    return null;
  }

  const toBigInt = (v: unknown): bigint => {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    return 0n;
  };

  const r0 = toBigInt(reservesRaw[0]);
  const r1 = toBigInt(reservesRaw[1]);
  const t0 = token0Raw.toUpperCase();
  const t1 = token1Raw.toUpperCase();
  const tIn = input.tokenInContractId.toUpperCase();
  const tOut = input.tokenOutContractId.toUpperCase();

  if (t0 === tIn && t1 === tOut) {
    return { pairId, reserveIn: r0, reserveOut: r1 };
  }
  if (t1 === tIn && t0 === tOut) {
    return { pairId, reserveIn: r1, reserveOut: r0 };
  }
  return null;
}

/**
 * Constant-product 30 bps Soroswap AMM formula matching Soroswap Router `router_get_amount_out`.
 * Never uses `router_get_amounts_out`.
 */
export function computeSoroswapAmountOut(
  amountInStroops: bigint,
  reserveInStroops: bigint,
  reserveOutStroops: bigint,
): bigint {
  if (amountInStroops <= 0n || reserveInStroops <= 0n || reserveOutStroops <= 0n) {
    return 0n;
  }
  const amountInWithFee = amountInStroops * 997n;
  const numerator = amountInWithFee * reserveOutStroops;
  const denominator = reserveInStroops * 1000n + amountInWithFee;
  return denominator > 0n ? numerator / denominator : 0n;
}

/**
 * Builds an unsigned direct Soroswap Router `swap_exact_tokens_for_tokens` transaction XDR.
 */
export function buildSoroswapRouterSwapXdr(input: {
  sourceAddress: string;
  routerContractId: string;
  amountInStroops: bigint;
  amountOutMinStroops: bigint;
  pathContracts: readonly string[];
  deadlineUnix: number;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const contract = new Contract(input.routerContractId);
  const pathVal = xdr.ScVal.scvVec(
    input.pathContracts.map((id) => new Address(id).toScVal()),
  );
  const tx = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "swap_exact_tokens_for_tokens",
        nativeToScVal(input.amountInStroops, { type: "i128" }),
        nativeToScVal(input.amountOutMinStroops, { type: "i128" }),
        pathVal,
        new Address(input.sourceAddress).toScVal(),
        nativeToScVal(BigInt(input.deadlineUnix), { type: "u64" }),
      ),
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

export async function quoteViaSoroswapProxy(input: {
  proxyQuoteUrl?: string | undefined;
  fromAsset: string;
  toAsset: string;
  amount: string;
  slippageBps: number;
  sourceAddress?: string | undefined;
  fetchFn: AggregatorFetchLike;
}): Promise<RouteQuote | null> {
  if (!input.proxyQuoteUrl) return null;
  const res = await input.fetchFn(input.proxyQuoteUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
      amount: input.amount,
      slippageBps: input.slippageBps,
      sourceAddress: input.sourceAddress,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    expectedOutputAmount?: string;
    minOutputAmount?: string;
    priceImpactPct?: string;
    feeBps?: number;
    pathAssets?: string[];
    unsignedXdr?: string;
    pairId?: string;
  };
  if (!body.expectedOutputAmount) return null;
  const outStroops = parseDecimalToStroops7(body.expectedOutputAmount);
  if (outStroops === null || outStroops <= 0n) return null;
  const minOutStroops =
    (outStroops * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) / 10_000n;

  return {
    venue: "soroswap_aggregator",
    fromAsset: input.fromAsset,
    toAsset: input.toAsset,
    inputAmount: input.amount,
    expectedOutputAmount: body.expectedOutputAmount,
    minOutputAmount: body.minOutputAmount ?? formatStroops7(minOutStroops),
    priceImpactPct: body.priceImpactPct ?? "0.30",
    feeBps: body.feeBps ?? 30,
    requiresTrustline: false,
    requiresSacBridgeForSmartAccount: false,
    pathAssets: body.pathAssets ?? [input.fromAsset, input.toAsset],
    pairId: body.pairId,
    unsignedXdr: body.unsignedXdr,
  };
}

/**
 * Calls the upstream Soroswap Aggregator API directly (avoids Cloudflare Worker self-fetch hairpins).
 */
export async function quoteViaSoroswapDirect(input: {
  apiBase: string;
  apiKey: string;
  network: "mainnet" | "testnet";
  fromAsset: string;
  toAsset: string;
  amount: string;
  slippageBps: number;
  sourceAddress?: string | undefined;
  fetchFn: AggregatorFetchLike;
}): Promise<RouteQuote | null> {
  const base = input.apiBase.replace(/\/+$/, "");
  const res = await input.fetchFn(`${base}/quote?network=${input.network}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
      amount: input.amount,
      slippageBps: input.slippageBps,
      sourceAddress: input.sourceAddress,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    expectedOutputAmount?: string;
    minOutputAmount?: string;
    priceImpactPct?: string;
    feeBps?: number;
    pathAssets?: string[];
    unsignedXdr?: string;
    pairId?: string;
  };
  if (!body.expectedOutputAmount) return null;
  const outStroops = parseDecimalToStroops7(body.expectedOutputAmount);
  if (outStroops === null || outStroops <= 0n) return null;
  const minOutStroops =
    (outStroops * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) / 10_000n;

  return {
    venue: "soroswap_aggregator",
    fromAsset: input.fromAsset,
    toAsset: input.toAsset,
    inputAmount: input.amount,
    expectedOutputAmount: body.expectedOutputAmount,
    minOutputAmount: body.minOutputAmount ?? formatStroops7(minOutStroops),
    priceImpactPct: body.priceImpactPct ?? "0.30",
    feeBps: body.feeBps ?? 30,
    requiresTrustline: false,
    requiresSacBridgeForSmartAccount: false,
    pathAssets: body.pathAssets ?? [input.fromAsset, input.toAsset],
    pairId: body.pairId,
    unsignedXdr: body.unsignedXdr,
  };
}
