import {
  formatStroops7,
  normalizeAssetIdentifier,
  parseDecimalToStroops7,
  type DepthPoint,
  type LimitOrderSpec,
  type OpenLimitOffer,
  type OrderbookLevel,
  type OrderbookSnapshot,
  type RouteQuote,
} from "@astrodex/domain";
import { Account, Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { AggregatorFetchLike } from "../soroswap/index.js";

function toSdkAsset(identifier: string): Asset {
  const norm = normalizeAssetIdentifier(identifier);
  if (norm.kind === "native") return Asset.native();
  if (norm.kind === "classic" && norm.issuer) {
    return new Asset(norm.code, norm.issuer);
  }
  throw new Error(`Classic SDEX requires XLM or CODE:G... (received "${identifier}")`);
}

function horizonAssetQueryParams(prefix: string, identifier: string): Record<string, string> {
  const norm = normalizeAssetIdentifier(identifier);
  if (norm.kind === "native") {
    return { [`${prefix}_asset_type`]: "native" };
  }
  if (norm.kind === "classic" && norm.issuer) {
    return {
      [`${prefix}_asset_type`]: norm.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
      [`${prefix}_asset_code`]: norm.code,
      [`${prefix}_asset_issuer`]: norm.issuer,
    };
  }
  throw new Error(`Horizon SDEX does not directly quote Soroban contract "${identifier}"`);
}

function encodeQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export async function fetchHorizonOrderbook(
  horizonUrls: readonly string[],
  baseAsset: string,
  quoteAsset: string,
  limit = 20,
  fetchFn: AggregatorFetchLike,
): Promise<OrderbookSnapshot> {
  const sellingParams = horizonAssetQueryParams("selling", baseAsset);
  const buyingParams = horizonAssetQueryParams("buying", quoteAsset);
  const qs = encodeQuery({
    ...sellingParams,
    ...buyingParams,
    limit: String(Math.max(1, Math.min(50, limit))),
  });

  for (const base of horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await fetchFn(`${clean}/order_book?${qs}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        bids?: Array<{ price?: string; amount?: string }>;
        asks?: Array<{ price?: string; amount?: string }>;
      };

      const bids: OrderbookLevel[] = (body.bids ?? [])
        .filter((b) => b.price && b.amount)
        .map((b) => ({
          price: b.price!,
          amount: b.amount!,
          totalQuote: (Number(b.price) * Number(b.amount)).toFixed(7),
          venue: "sdex",
        }));
      const asks: OrderbookLevel[] = (body.asks ?? [])
        .filter((a) => a.price && a.amount)
        .map((a) => ({
          price: a.price!,
          amount: a.amount!,
          totalQuote: (Number(a.price) * Number(a.amount)).toFixed(7),
          venue: "sdex",
        }));

      const bestBid = bids[0]?.price ?? null;
      const bestAsk = asks[0]?.price ?? null;
      let spreadPct: string | null = null;
      if (bestBid && bestAsk) {
        const bidN = Number(bestBid);
        const askN = Number(bestAsk);
        if (bidN > 0 && askN >= bidN) {
          spreadPct = (((askN - bidN) / askN) * 100).toFixed(2);
        }
      }

      return {
        baseAsset,
        quoteAsset,
        bids,
        asks,
        bestBid,
        bestAsk,
        spreadPct,
        timestampUnix: Math.floor(Date.now() / 1000),
      };
    } catch {
      // Fail over to next Horizon URL
    }
  }

  return {
    baseAsset,
    quoteAsset,
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    spreadPct: null,
    timestampUnix: Math.floor(Date.now() / 1000),
  };
}

/**
 * Computes cumulative Depth Chart series from an orderbook snapshot.
 */
export function computeDepthChart(snapshot: OrderbookSnapshot): DepthPoint[] {
  const points: DepthPoint[] = [];
  let cumBidBase = 0;
  let cumBidQuote = 0;
  for (const bid of snapshot.bids) {
    const price = Number(bid.price);
    const amt = Number(bid.amount);
    if (!Number.isFinite(price) || !Number.isFinite(amt) || price <= 0 || amt <= 0) continue;
    cumBidBase += amt;
    cumBidQuote += price * amt;
    points.push({
      price,
      cumulativeBase: Number(cumBidBase.toFixed(7)),
      cumulativeQuote: Number(cumBidQuote.toFixed(7)),
      side: "bid",
    });
  }
  points.reverse();

  let cumAskBase = 0;
  let cumAskQuote = 0;
  for (const ask of snapshot.asks) {
    const price = Number(ask.price);
    const amt = Number(ask.amount);
    if (!Number.isFinite(price) || !Number.isFinite(amt) || price <= 0 || amt <= 0) continue;
    cumAskBase += amt;
    cumAskQuote += price * amt;
    points.push({
      price,
      cumulativeBase: Number(cumAskBase.toFixed(7)),
      cumulativeQuote: Number(cumAskQuote.toFixed(7)),
      side: "ask",
    });
  }
  return points;
}

/**
 * Queries Horizon `/paths/strict-send` with `/order_book` bid-walk fallback for Classic G... accounts.
 */
export async function quoteHorizonSdexPath(input: {
  horizonUrls: readonly string[];
  fromAsset: string;
  toAsset: string;
  amount: string;
  slippageBps: number;
  fetchFn: AggregatorFetchLike;
}): Promise<RouteQuote | null> {
  let sourceParams: Record<string, string>;
  let destParams: Record<string, string>;
  try {
    sourceParams = horizonAssetQueryParams("source", input.fromAsset);
    destParams = horizonAssetQueryParams("destination", input.toAsset);
  } catch {
    return null;
  }

  const fromNorm = normalizeAssetIdentifier(input.fromAsset);
  const toNorm = normalizeAssetIdentifier(input.toAsset);
  const qs = encodeQuery({
    ...sourceParams,
    source_amount: input.amount,
    destination_assets:
      toNorm.kind === "native" ? "native" : `${toNorm.code}:${toNorm.issuer ?? ""}`,
  });

  for (const base of input.horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await input.fetchFn(`${clean}/paths/strict-send?${qs}`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as {
          _embedded?: {
            records?: Array<{
              destination_amount?: string;
              path?: Array<{ asset_type?: string; asset_code?: string; asset_issuer?: string }>;
            }>;
          };
        };
        const best = body._embedded?.records?.[0];
        if (best?.destination_amount) {
          const outStroops = parseDecimalToStroops7(best.destination_amount);
          if (outStroops !== null && outStroops > 0n) {
            const minOut =
              (outStroops * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) /
              10_000n;
            const pathAssets = [
              fromNorm.canonicalKey,
              ...(best.path ?? []).map((p) =>
                p.asset_type === "native" ? "XLM" : `${p.asset_code ?? ""}:${p.asset_issuer ?? ""}`,
              ),
              toNorm.canonicalKey,
            ];
            return {
              venue: "sdex_horizon",
              fromAsset: input.fromAsset,
              toAsset: input.toAsset,
              inputAmount: input.amount,
              expectedOutputAmount: best.destination_amount,
              minOutputAmount: formatStroops7(minOut),
              priceImpactPct: "0.00",
              feeBps: 0,
              requiresTrustline: false,
              requiresSacBridgeForSmartAccount: true,
              pathAssets,
            };
          }
        }
      }
    } catch {
      // Try order_book bid-walk fallback
    }
  }

  void destParams;
  // Bid-walk fallback directly on Horizon /order_book
  const book = await fetchHorizonOrderbook(
    input.horizonUrls,
    input.fromAsset,
    input.toAsset,
    20,
    input.fetchFn,
  );
  const inputStroops = parseDecimalToStroops7(input.amount);
  if (inputStroops === null || inputStroops <= 0n || book.bids.length === 0) {
    return null;
  }

  let remainingBase = Number(input.amount);
  let totalQuote = 0;
  for (const level of book.bids) {
    const levelAmt = Number(level.amount);
    const levelPrice = Number(level.price);
    if (!Number.isFinite(levelAmt) || !Number.isFinite(levelPrice) || levelAmt <= 0 || levelPrice <= 0) {
      continue;
    }
    const take = Math.min(remainingBase, levelAmt);
    totalQuote += take * levelPrice;
    remainingBase -= take;
    if (remainingBase <= 1e-8) break;
  }

  if (totalQuote <= 0) return null;
  const expectedStr = totalQuote.toFixed(7);
  const outStroops = parseDecimalToStroops7(expectedStr) ?? 0n;
  if (outStroops <= 0n) return null;
  const minOut =
    (outStroops * BigInt(10_000 - Math.max(1, Math.min(5000, input.slippageBps)))) / 10_000n;

  return {
    venue: "sdex_horizon",
    fromAsset: input.fromAsset,
    toAsset: input.toAsset,
    inputAmount: input.amount,
    expectedOutputAmount: expectedStr,
    minOutputAmount: formatStroops7(minOut),
    priceImpactPct: "0.00",
    feeBps: 0,
    requiresTrustline: false,
    requiresSacBridgeForSmartAccount: true,
    pathAssets: [fromNorm.canonicalKey, toNorm.canonicalKey],
  };
}

export async function listClassicOpenOffers(
  horizonUrls: readonly string[],
  seller: string,
  fetchFn: AggregatorFetchLike,
): Promise<OpenLimitOffer[]> {
  for (const base of horizonUrls) {
    const clean = base.replace(/\/+$/, "");
    try {
      const res = await fetchFn(
        `${clean}/accounts/${encodeURIComponent(seller)}/offers?limit=50&order=desc`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        _embedded?: {
          records?: Array<{
            id?: string;
            seller?: string;
            selling?: { asset_type?: string; asset_code?: string; asset_issuer?: string };
            buying?: { asset_type?: string; asset_code?: string; asset_issuer?: string };
            amount?: string;
            price?: string;
            last_modified_ledger?: number;
          }>;
        };
      };
      return (body._embedded?.records ?? []).map((r) => ({
        offerId: r.id ?? "0",
        seller: r.seller ?? seller,
        sellingAsset:
          r.selling?.asset_type === "native"
            ? "XLM"
            : `${r.selling?.asset_code ?? ""}:${r.selling?.asset_issuer ?? ""}`,
        buyingAsset:
          r.buying?.asset_type === "native"
            ? "XLM"
            : `${r.buying?.asset_code ?? ""}:${r.buying?.asset_issuer ?? ""}`,
        amount: r.amount ?? "0",
        price: r.price ?? "0",
        lastModifiedLedger: r.last_modified_ledger ?? 0,
      }));
    } catch {
      // Fail over
    }
  }
  return [];
}

/**
 * Builds an unsigned Classic SDEX manageBuyOffer / manageSellOffer transaction XDR
 * (with optional prepended changeTrust for missing receiving trustlines).
 */
export function buildClassicLimitOrderXdr(
  spec: LimitOrderSpec,
  networkPassphrase: string,
  sequence = "0",
): string {
  const baseAsset = toSdkAsset(spec.baseAsset);
  const quoteAsset = toSdkAsset(spec.quoteAsset);

  const builder = new TransactionBuilder(new Account(spec.seller, sequence), {
    fee: "10000",
    networkPassphrase,
  });

  if (spec.includeTrustlineIfMissing && spec.amount !== "0") {
    const trustAsset = spec.side === "buy" ? baseAsset : quoteAsset;
    if (!trustAsset.isNative()) {
      builder.addOperation(Operation.changeTrust({ asset: trustAsset }));
    }
  }

  if (spec.side === "buy") {
    builder.addOperation(
      Operation.manageBuyOffer({
        selling: quoteAsset,
        buying: baseAsset,
        buyAmount: spec.amount,
        price: spec.price,
        offerId: spec.offerId ?? "0",
      }),
    );
  } else {
    builder.addOperation(
      Operation.manageSellOffer({
        selling: baseAsset,
        buying: quoteAsset,
        amount: spec.amount,
        price: spec.price,
        offerId: spec.offerId ?? "0",
      }),
    );
  }

  return builder.setTimeout(300).build().toXDR();
}

/**
 * Builds an unsigned Classic SDEX `pathPaymentStrictSend` transaction XDR
 * (with optional prepended `changeTrust` when the destination asset trustline is missing).
 */
export function buildClassicSwapXdr(input: {
  sourceAddress: string;
  fromAsset: string;
  toAsset: string;
  amount: string;
  minOutputAmount: string;
  pathAssets?: readonly string[] | undefined;
  includeTrustlineIfMissing?: boolean | undefined;
  networkPassphrase: string;
  sequence?: string | undefined;
}): string {
  const sendAsset = toSdkAsset(input.fromAsset);
  const destAsset = toSdkAsset(input.toAsset);
  const builder = new TransactionBuilder(new Account(input.sourceAddress, input.sequence ?? "0"), {
    fee: "10000",
    networkPassphrase: input.networkPassphrase,
  });

  if (input.includeTrustlineIfMissing && !destAsset.isNative()) {
    builder.addOperation(Operation.changeTrust({ asset: destAsset }));
  }

  const intermediatePath: Asset[] = [];
  if (input.pathAssets && input.pathAssets.length > 2) {
    for (const rawHop of input.pathAssets.slice(1, -1)) {
      intermediatePath.push(toSdkAsset(rawHop));
    }
  }

  builder.addOperation(
    Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount: input.amount,
      destination: input.sourceAddress,
      destAsset,
      destMin: input.minOutputAmount,
      path: intermediatePath,
    }),
  );

  return builder.setTimeout(300).build().toXDR();
}
