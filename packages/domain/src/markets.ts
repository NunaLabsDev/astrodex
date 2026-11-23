export type LiquidityVenue =
  | "astrogate_curve"
  | "soroswap_aggregator"
  | "xoxno_aggregator"
  | "soroswap_direct"
  | "sdex_horizon";

export type OhlcvTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface RouteQuote {
  venue: LiquidityVenue;
  fromAsset: string;
  toAsset: string;
  inputAmount: string;
  expectedOutputAmount: string;
  minOutputAmount: string;
  priceImpactPct: string;
  feeBps: number;
  requiresTrustline: boolean;
  trustlineAsset?: { code: string; issuer: string } | undefined;
  requiresSacBridgeForSmartAccount: boolean;
  pathAssets: readonly string[];
  pairId?: string | undefined;
  unsignedXdr?: string | undefined;
}

export interface MultiVenueQuoteResult {
  fromAsset: string;
  toAsset: string;
  inputAmount: string;
  accountKind: "classic" | "smart";
  bestRoute: RouteQuote | null;
  routes: readonly RouteQuote[];
  skippedVenues: readonly { venue: LiquidityVenue; reason: string }[];
  blockedReason?: string | undefined;
}

export interface OrderbookLevel {
  price: string;
  amount: string;
  totalQuote: string;
  venue: "sdex" | "amm_synthetic";
}

export interface OrderbookSnapshot {
  baseAsset: string;
  quoteAsset: string;
  bids: readonly OrderbookLevel[];
  asks: readonly OrderbookLevel[];
  bestBid: string | null;
  bestAsk: string | null;
  spreadPct: string | null;
  timestampUnix: number;
}

export interface DepthPoint {
  price: number;
  cumulativeBase: number;
  cumulativeQuote: number;
  side: "bid" | "ask";
}

export interface OhlcvCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LimitOrderSpec {
  seller: string;
  side: "buy" | "sell";
  baseAsset: string;
  quoteAsset: string;
  amount: string;
  price: string;
  offerId?: string | undefined;
  includeTrustlineIfMissing?: boolean | undefined;
}

export interface OpenLimitOffer {
  offerId: string;
  seller: string;
  sellingAsset: string;
  buyingAsset: string;
  amount: string;
  price: string;
  lastModifiedLedger: number;
}

export interface WhaleTrade {
  txHash: string;
  pairId: string;
  baseSymbol: string;
  side: "buy" | "sell";
  traderAddress: string;
  amountBase: string;
  amountXlm: string;
  ledger: number;
  timestampUnix: number;
}

export type TokenReviewStatus = "official" | "verified" | "unreviewed_warning";

export interface CatalogTokenItem {
  assetKey: string;
  kind: "native" | "classic" | "soroban";
  code: string;
  name?: string | undefined;
  issuer?: string | undefined;
  sacId?: string | undefined;
  decimals: number;
  logoUrl?: string | undefined;
  shieldScore: number;
  reviewStatus: TokenReviewStatus;
  reviewNote?: string | undefined;
  ammVenue?: string | undefined;
  pairId?: string | undefined;
  communityUrl?: string | undefined;
  priceUsd?: number | undefined;
  change24hPct?: number | undefined;
  change7dPct?: number | undefined;
  volume7dUsd?: number | undefined;
  marketCapUsd?: number | undefined;
  holdersCount?: number | undefined;
  tradesCount?: number | undefined;
  rating?: number | undefined;
  domain?: string | undefined;
  sparkline7d?: number[] | undefined;
}

export interface OraclePriceQuote {
  assetKey: string;
  priceUsd: number;
  source: "chainlink" | "reflector" | "rumble_fish" | "horizon_spot" | "cex_fallback";
  updatedAtUnix: number;
}
