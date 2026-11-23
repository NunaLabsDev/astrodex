import type { OraclePriceQuote } from "@astrodex/domain";
import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type OracleFetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  },
) => Promise<MinimalFetchResponse>;

const READONLY_SIM_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

async function simulateReadOnlyContractCall(input: {
  rpcUrls: readonly string[];
  contractId: string;
  method: string;
  args?: xdr.ScVal[] | undefined;
  networkPassphrase: string;
  fetchFn: OracleFetchLike;
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

export async function fetchChainlinkXlmUsd(input: {
  rpcUrls: readonly string[];
  chainlinkProxyContractId?: string | undefined;
  networkPassphrase: string;
  fetchFn: OracleFetchLike;
}): Promise<OraclePriceQuote | null> {
  if (!input.chainlinkProxyContractId) return null;
  const val = await simulateReadOnlyContractCall({
    rpcUrls: input.rpcUrls,
    contractId: input.chainlinkProxyContractId,
    method: "latest_round_data",
    networkPassphrase: input.networkPassphrase,
    fetchFn: input.fetchFn,
  });
  if (!val || typeof val !== "object") return null;
  const obj = val as Record<string, unknown>;
  const rawAnswer = obj.answer;
  const numeric =
    typeof rawAnswer === "bigint"
      ? Number(rawAnswer)
      : typeof rawAnswer === "number"
        ? rawAnswer
        : typeof rawAnswer === "string"
          ? Number(rawAnswer)
          : 0;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  // Chainlink Stellar feeds commonly use 8 or 14 decimals; normalize if > 100
  const priceUsd = numeric > 1_000_000_000 ? numeric / 1e14 : numeric > 1000 ? numeric / 1e8 : numeric;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 1000) return null;

  return {
    assetKey: "XLM",
    priceUsd: Number(priceUsd.toFixed(6)),
    source: "chainlink",
    updatedAtUnix: Math.floor(Date.now() / 1000),
  };
}

/**
 * Queries a SEP-40 compliant Reflector Network DEX Oracle on Soroban for a 14-decimal USD price.
 */
export async function fetchReflectorSep40Price(input: {
  rpcUrls: readonly string[];
  reflectorOracleContractId?: string | undefined;
  tokenContractId?: string | undefined;
  assetKey: string;
  networkPassphrase: string;
  fetchFn: OracleFetchLike;
}): Promise<OraclePriceQuote | null> {
  if (
    !input.reflectorOracleContractId ||
    !input.tokenContractId ||
    !/^C[A-Z2-7]{55}$/.test(input.tokenContractId)
  ) {
    return null;
  }
  const arg = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Stellar"),
    new Address(input.tokenContractId).toScVal(),
  ]);
  const val = await simulateReadOnlyContractCall({
    rpcUrls: input.rpcUrls,
    contractId: input.reflectorOracleContractId,
    method: "lastprice",
    args: [arg],
    networkPassphrase: input.networkPassphrase,
    fetchFn: input.fetchFn,
  });
  if (!val || typeof val !== "object") return null;
  const obj = val as Record<string, unknown>;
  const rawPrice = obj.price;
  const numeric =
    typeof rawPrice === "bigint"
      ? Number(rawPrice)
      : typeof rawPrice === "number"
        ? rawPrice
        : typeof rawPrice === "string"
          ? Number(rawPrice)
          : 0;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const priceUsd = numeric / 1e14;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd >= 1_000_000) return null;

  return {
    assetKey: input.assetKey,
    priceUsd: Number(priceUsd.toFixed(6)),
    source: "reflector",
    updatedAtUnix: Math.floor(Date.now() / 1000),
  };
}

/**
 * Queries RedStone's audited SEP-40 compliant Soroban oracle (`CBMGLK...WYRF` on Mainnet).
 * Supports both Stellar C... SAC addresses (`["Stellar", Address]`) and ticker symbols (`["Other", Symbol]`).
 */
export async function fetchRedStoneSep40Price(input: {
  rpcUrls: readonly string[];
  redstoneOracleContractId?: string | undefined;
  tokenContractId?: string | undefined;
  assetCode?: string | undefined;
  assetKey: string;
  networkPassphrase: string;
  fetchFn: OracleFetchLike;
}): Promise<OraclePriceQuote | null> {
  if (!input.redstoneOracleContractId) return null;

  const candidateArgs: xdr.ScVal[] = [];
  if (input.tokenContractId && /^C[A-Z2-7]{55}$/.test(input.tokenContractId)) {
    candidateArgs.push(
      xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Stellar"),
        new Address(input.tokenContractId).toScVal(),
      ]),
    );
  }
  const cleanCode = input.assetCode?.trim().toUpperCase();
  if (cleanCode && /^[A-Z0-9]{1,12}$/.test(cleanCode)) {
    candidateArgs.push(
      xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Other"),
        xdr.ScVal.scvSymbol(cleanCode),
      ]),
    );
  }

  for (const arg of candidateArgs) {
    const val = await simulateReadOnlyContractCall({
      rpcUrls: input.rpcUrls,
      contractId: input.redstoneOracleContractId,
      method: "lastprice",
      args: [arg],
      networkPassphrase: input.networkPassphrase,
      fetchFn: input.fetchFn,
    });
    if (!val || typeof val !== "object") continue;
    const obj = val as Record<string, unknown>;
    const rawPrice = obj.price;
    const numeric =
      typeof rawPrice === "bigint"
        ? Number(rawPrice)
        : typeof rawPrice === "number"
          ? rawPrice
          : typeof rawPrice === "string"
            ? Number(rawPrice)
            : 0;
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    // SEP-40 standard uses 14 decimals; guard if a feed uses 8 decimals
    const priceUsd = numeric > 1e10 ? numeric / 1e14 : numeric > 1e5 ? numeric / 1e8 : numeric;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd >= 1_000_000) continue;

    return {
      assetKey: input.assetKey,
      priceUsd: Number(priceUsd.toFixed(6)),
      source: "redstone",
      updatedAtUnix: Math.floor(Date.now() / 1000),
    };
  }
  return null;
}

export async function fetchRumbleFishVwapPrice(input: {
  stellarPricesApiBase?: string | undefined;
  stellarPricesApiKey?: string | undefined;
  assetKey: string;
  fetchFn: OracleFetchLike;
}): Promise<OraclePriceQuote | null> {
  if (!input.stellarPricesApiBase) return null;
  const base = input.stellarPricesApiBase.replace(/\/+$/, "");
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.stellarPricesApiKey) {
      headers["X-API-Key"] = input.stellarPricesApiKey;
    }
    const res = await input.fetchFn(
      `${base}/v1/prices/${encodeURIComponent(input.assetKey)}`,
      { headers },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { priceUsd?: number; vwapUsd?: number };
    const price = json.vwapUsd ?? json.priceUsd;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
    return {
      assetKey: input.assetKey,
      priceUsd: price,
      source: "rumble_fish",
      updatedAtUnix: Math.floor(Date.now() / 1000),
    };
  } catch {
    return null;
  }
}

export async function fetchHorizonUsdcSpotXlmUsd(input: {
  horizonUrls: readonly string[];
  usdcIssuer?: string | undefined;
  fetchFn: OracleFetchLike;
}): Promise<OraclePriceQuote | null> {
  if (!input.usdcIssuer) return null;
  const qs = [
    "selling_asset_type=native",
    "buying_asset_type=credit_alphanum4",
    "buying_asset_code=USDC",
    `buying_asset_issuer=${encodeURIComponent(input.usdcIssuer)}`,
    "limit=1",
  ].join("&");

  for (const base of input.horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await input.fetchFn(`${clean}/order_book?${qs}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        bids?: Array<{ price?: string }>;
        asks?: Array<{ price?: string }>;
      };
      const bid = Number(body.bids?.[0]?.price ?? "0");
      const ask = Number(body.asks?.[0]?.price ?? "0");
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
      if (Number.isFinite(mid) && mid > 0 && mid < 100) {
        return {
          assetKey: "XLM",
          priceUsd: Number(mid.toFixed(6)),
          source: "horizon_spot",
          updatedAtUnix: Math.floor(Date.now() / 1000),
        };
      }
    } catch {
      // Fail over
    }
  }
  return null;
}
