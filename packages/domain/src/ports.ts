import type { AccountKind, StellarAddress } from "./accounts.js";
import type {
  AstroDexSubAction,
  AstroIdProfile,
  AstroWalletActionType,
  SignedIntent,
} from "./intents.js";
import type {
  DepthPoint,
  LimitOrderSpec,
  MultiVenueQuoteResult,
  OhlcvCandle,
  OhlcvTimeframe,
  OpenLimitOffer,
  OraclePriceQuote,
  OrderbookSnapshot,
} from "./markets.js";
import type { ScanReport, TokenForensicAudit } from "./scanner.js";

export interface ScannerPort {
  auditToken(assetIdentifier: string): Promise<TokenForensicAudit>;
  buildExtendTtlXdr?(contractId: string, sourceAddress: StellarAddress): Promise<string>;
}

export interface SecurityShieldPort {
  scanTransactionXdr(xdrBase64: string, sourceAddress?: StellarAddress): Promise<ScanReport>;
  scanAddress(address: StellarAddress): Promise<ScanReport>;
}

export interface LiquidityRouterPort {
  quoteBestRoutes(input: {
    fromAsset: string;
    toAsset: string;
    amount: string;
    slippageBps: number;
    sourceAddress?: StellarAddress | undefined;
    accountKind: AccountKind;
  }): Promise<MultiVenueQuoteResult>;
}

export interface LimitOrderPort {
  fetchOrderbook(baseAsset: string, quoteAsset: string, limit?: number): Promise<OrderbookSnapshot>;
  computeDepth(snapshot: OrderbookSnapshot): readonly DepthPoint[];
  listOpenOffers(seller: string): Promise<readonly OpenLimitOffer[]>;
  buildLimitOrderXdr(spec: LimitOrderSpec): Promise<string>;
}

export interface OraclePort {
  getXlmUsdPrice(): Promise<OraclePriceQuote>;
  getAssetUsdPrice(assetKey: string): Promise<OraclePriceQuote | null>;
  getOhlcvCandles(input: {
    pairId: string;
    baseAsset: string;
    quoteAsset: string;
    timeframe: OhlcvTimeframe;
    limit?: number | undefined;
  }): Promise<readonly OhlcvCandle[]>;
  getOhlcvCandlesWithMeta?(input: {
    pairId: string;
    baseAsset: string;
    quoteAsset: string;
    timeframe: OhlcvTimeframe;
    limit?: number | undefined;
  }): Promise<{ candles: readonly OhlcvCandle[]; quoteCurrency: "USD" | "USDC" | "XLM" }>;
}

export interface IdentityResolverPort {
  resolveIdentity(query: string): Promise<AstroIdProfile>;
}

export interface IntentPort {
  createAndFederateIntent(input: {
    telegramUserId: string;
    actionType: AstroWalletActionType;
    subAction: AstroDexSubAction;
    sourceAddress: StellarAddress;
    unsignedXdr: string;
    humanSummary: string;
    returnStartAppParam?: string | undefined;
  }): Promise<{ intent: SignedIntent; deepLink: string }>;
}

/**
 * Reserved Phase 2 hook for x402 / MPP USDC SAC agentic API monetization.
 */
export interface AgenticPaymentPort {
  verifyPaymentProof?(headerValue: string): Promise<{ paid: boolean; payer?: string | undefined }>;
}
