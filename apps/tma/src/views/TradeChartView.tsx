import type {
  DepthPoint,
  MultiVenueQuoteResult,
  OhlcvCandle,
  OhlcvTimeframe,
} from "@astrodex/domain";
import { useEffect, useMemo, useState } from "react";
import { ChartCanvas } from "../components/ChartCanvas.js";
import { TokenSearchInput } from "../components/TokenSearchInput.js";
import { useAppState } from "../state/app-context.js";
import {
  openTelegramDeepLink,
  setTelegramClosingConfirmation,
  triggerTelegramHaptic,
} from "../telegram/webapp.js";

const QUICK_AMOUNTS = ["10", "50", "100", "500"] as const;
const TIMEFRAMES: readonly OhlcvTimeframe[] = ["5m", "15m", "1h", "4h", "1d"];
const SLIPPAGE_PRESETS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
  { label: "2.5%", bps: 250 },
] as const;

interface TokenHubData {
  marketStats?: {
    priceUsd: number | null;
    change24hPct: number | null;
    change7dPct: number | null;
    volume7dUsd: number | null;
    marketCapUsd: number | null;
    holdersCount: number | null;
    tradesCount: number | null;
    rating: number | null;
    domain: string | null;
  };
  topHolders?: Array<{
    address: string;
    balance: string;
    sharePct: number | null;
  }>;
  ammPools: Array<{
    poolId: string;
    venue: string;
    feeBps: number;
    totalTrustlines: number;
    reserves: Array<{ assetKey: string; code: string; amount: string }>;
    counterAssetKey: string;
    counterCode: string;
    spotPriceInCounter: number | null;
  }>;
  orderbook: {
    bestBid: string | null;
    bestAsk: string | null;
    spreadPct: string | null;
    bids: Array<{ price: string; amount: string; venue?: string }>;
    asks: Array<{ price: string; amount: string; venue?: string }>;
  } | null;
  recentTrades: Array<{
    id: string;
    timestamp: string;
    side: "buy" | "sell";
    baseCode: string;
    counterCode: string;
    baseAmount: string;
    price: string;
  }>;
  audit: {
    astroShieldScore?: number;
    verdict?: string;
    trustTier?: string;
    findings?: Array<{ title: string; severity: string }>;
    holdersCount?: number;
    circulatingSupply?: string;
    contractId?: string;
  } | null;
}

interface AmmPairMeta {
  venue: "soroswap" | "astrogate_curve";
  pairId?: string;
  reserveBase: string;
  reserveQuote: string;
  spotPriceQuotePerBase: number;
}

function formatSelectLabel(
  code: string,
  name: string | undefined,
  assetKey: string,
  reviewStatus: string,
): string {
  const icon = reviewStatus === "official" ? "🛡️" : reviewStatus === "unreviewed_warning" ? "⚠️" : "✓";
  if (assetKey === "XLM") return `XLM (Native) ${icon}`;
  const short = assetKey.length > 14 ? `${assetKey.slice(0, 5)}…${assetKey.slice(-4)}` : assetKey;
  const labelName = name && name.toUpperCase() !== code.toUpperCase() ? ` · ${name}` : "";
  return `${code}${labelName} (${short}) ${icon}`;
}

export function TradeChartView() {
  const {
    config,
    feedNetwork,
    executionDisabled,
    mode,
    activeAccount,
    sessionToken,
    selectedAsset,
    setSelectedAsset,
    tradeSubTab,
    setTradeSubTab,
    defaultPairAsset,
    catalog,
    xlmUsd,
  } = useAppState();

  const [fromAsset, setFromAsset] = useState("XLM");
  const [toAsset, setToAsset] = useState(
    selectedAsset && selectedAsset !== "XLM" ? selectedAsset : defaultPairAsset,
  );
  const [showTokenFinder, setShowTokenFinder] = useState(false);
  const [finderQuery, setFinderQuery] = useState("");
  const [amount, setAmount] = useState("10");
  const [slippageBps, setSlippageBps] = useState(50);
  const [timeframe, setTimeframe] = useState<OhlcvTimeframe>("1h");
  const [quote, setQuote] = useState<MultiVenueQuoteResult | null>(null);
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [depth, setDepth] = useState<DepthPoint[]>([]);
  const [ammPair, setAmmPair] = useState<AmmPairMeta | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [tokenHub, setTokenHub] = useState<TokenHubData | null>(null);
  const [hubLoading, setHubLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Classic SDEX Limit Order fields (Pro Mode)
  const [limitSide, setLimitSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState("1.0");
  const [limitAmount, setLimitAmount] = useState("10");

  useEffect(() => {
    if (selectedAsset && selectedAsset !== "XLM") {
      setToAsset(selectedAsset);
      return;
    }
    if ((!toAsset || toAsset === "XLM") && defaultPairAsset !== "XLM") {
      setToAsset(defaultPairAsset);
    }
  }, [selectedAsset, defaultPairAsset, toAsset]);

  useEffect(() => {
    setTelegramClosingConfirmation(submitting);
    return () => setTelegramClosingConfirmation(false);
  }, [submitting]);

  const activeFromToken = useMemo(
    () => catalog.find((item) => item.assetKey === fromAsset),
    [catalog, fromAsset],
  );
  const activeToToken = useMemo(
    () => catalog.find((item) => item.assetKey === toAsset),
    [catalog, toAsset],
  );

  const focusAsset =
    toAsset && toAsset !== "XLM"
      ? toAsset
      : fromAsset && fromAsset !== "XLM"
        ? fromAsset
        : defaultPairAsset;
  const focusToken = useMemo(
    () => catalog.find((item) => item.assetKey === focusAsset),
    [catalog, focusAsset],
  );

  const quickPairChips = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const item of catalog) {
      if (item.assetKey === "XLM") continue;
      const u = item.code.toUpperCase();
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(item);
      if (out.length >= 8) break;
    }
    return out;
  }, [catalog]);

  useEffect(() => {
    let cancelled = false;
    async function loadChartAndDepth() {
      const targetAsset = focusAsset || "XLM";
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const pair =
          targetAsset === "XLM" ? "XLM-XLM" : `${encodeURIComponent(targetAsset)}-XLM`;
        const netParam = encodeURIComponent(feedNetwork);
        setHubLoading(true);
        const [candlesRes, bookRes, hubRes] = await Promise.all([
          fetch(`${base}/v1/candles/${pair}?tf=${timeframe}&net=${netParam}`),
          fetch(`${base}/v1/orderbook/${pair}?net=${netParam}`),
          fetch(`${base}/v1/token-hub/${encodeURIComponent(targetAsset)}?net=${netParam}`),
        ]);
        if (!cancelled && candlesRes.ok) {
          const json = (await candlesRes.json()) as { candles?: OhlcvCandle[] };
          setCandles(json.candles ?? []);
        }
        if (!cancelled && bookRes.ok) {
          const json = (await bookRes.json()) as {
            depth?: DepthPoint[];
            ammPair?: AmmPairMeta | null;
          };
          setDepth(json.depth ?? []);
          setAmmPair(json.ammPair ?? null);
        }
        if (!cancelled && hubRes.ok) {
          const hubJson = (await hubRes.json()) as TokenHubData;
          setTokenHub(hubJson);
        }
      } catch {
        // Ignore offline chart errors
      } finally {
        if (!cancelled) setHubLoading(false);
      }
    }
    void loadChartAndDepth();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, feedNetwork, focusAsset, timeframe]);

  useEffect(() => {
    if (!toAsset.trim() || !amount.trim() || fromAsset.trim() === toAsset.trim()) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoting(true);
      setErrorMsg(null);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            fromAsset: fromAsset.trim(),
            toAsset: toAsset.trim(),
            amount: amount.trim(),
            slippageBps,
            sourceAddress: activeAccount?.address,
            accountKind: activeAccount?.kind ?? "classic",
            network: feedNetwork,
          }),
        });
        const json = (await res.json()) as { quote?: MultiVenueQuoteResult; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Quote failed");
        if (!cancelled && json.quote) {
          setQuote(json.quote);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : "Quote error");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [config.apiBaseUrl, feedNetwork, fromAsset, toAsset, amount, slippageBps, activeAccount]);

  const spotXlmPerToken = useMemo(() => {
    if (ammPair?.spotPriceQuotePerBase && ammPair.spotPriceQuotePerBase > 0) {
      return ammPair.spotPriceQuotePerBase;
    }
    const latest = candles[candles.length - 1]?.close;
    return latest && latest > 0 ? latest : null;
  }, [ammPair, candles]);

  const effectiveRateLabel = useMemo(() => {
    if (!quote?.bestRoute) return null;
    const inNum = Number(quote.bestRoute.inputAmount);
    const outNum = Number(quote.bestRoute.expectedOutputAmount);
    if (!Number.isFinite(inNum) || !Number.isFinite(outNum) || inNum <= 0 || outNum <= 0) {
      return null;
    }
    const ratio = outNum / inNum;
    const fromCode = activeFromToken?.code ?? "FROM";
    const toCode = activeToToken?.code ?? "TO";
    return `1 ${fromCode} ≈ ${ratio < 0.01 ? ratio.toFixed(6) : ratio.toFixed(4)} ${toCode}`;
  }, [activeFromToken, activeToToken, quote]);

  const handleFlipPair = () => {
    if (!toAsset) return;
    triggerTelegramHaptic("selection");
    const prevFrom = fromAsset;
    setFromAsset(toAsset);
    setToAsset(prevFrom);
  };

  const handleCopyFocusId = async () => {
    if (!focusAsset) return;
    try {
      await navigator.clipboard.writeText(focusAsset);
      setCopiedId(true);
      triggerTelegramHaptic("selection");
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleHandoffSwap = async () => {
    if (!quote?.bestRoute) return;
    if (!activeAccount || !sessionToken) {
      setErrorMsg(
        "Connect AstroWallet inside Telegram to clear-sign swaps. (Read-only preview accounts can inspect quotes, but signing stays 100% inside AstroWallet.)",
      );
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const toLabel = activeToToken?.code ?? toAsset;
      const res = await fetch(`${base}/v1/intents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "dex_swap",
          network: feedNetwork,
          sourceAddress: activeAccount.address,
          unsignedXdr: quote.bestRoute.unsignedXdr,
          swapSpec: quote.bestRoute.unsignedXdr
            ? undefined
            : {
                venue: quote.bestRoute.venue,
                fromAsset: quote.bestRoute.fromAsset,
                toAsset: quote.bestRoute.toAsset,
                amount: quote.bestRoute.inputAmount,
                minOutputAmount: quote.bestRoute.minOutputAmount,
                pathAssets: [...quote.bestRoute.pathAssets],
                includeTrustlineIfMissing: quote.bestRoute.requiresTrustline,
              },
          humanSummary: `Swap ${quote.bestRoute.inputAmount} ${activeFromToken?.code ?? fromAsset} -> ~${quote.bestRoute.expectedOutputAmount} ${toLabel} via ${quote.bestRoute.venue}`,
          returnStartAppParam: `${feedNetwork}_token_${toAsset}`,
          fromAsset: quote.bestRoute.fromAsset,
          toAsset: quote.bestRoute.toAsset,
          amount: quote.bestRoute.inputAmount,
          expectedOutputAmount: quote.bestRoute.expectedOutputAmount,
          provider: quote.bestRoute.venue,
          priceImpactPct: quote.bestRoute.priceImpactPct,
        }),
      });
      const json = (await res.json()) as { deepLink?: string; error?: string };
      if (!res.ok || !json.deepLink) {
        throw new Error(json.error ?? "Failed to create Swap Signed Intent");
      }
      triggerTelegramHaptic("success");
      setStatusMsg("Swap pre-scanned cleanly. Opening AstroWallet for Clear-Sign...");
      openTelegramDeepLink(json.deepLink);
    } catch (err) {
      triggerTelegramHaptic("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to hand off swap intent");
    } finally {
      setSubmitting(false);
    }
  };

  const handleHandoffLimitOrder = async () => {
    if (!activeAccount || activeAccount.kind !== "classic") {
      setErrorMsg("Classic SDEX Limit Orders require a Classic G... account.");
      return;
    }
    if (!sessionToken) {
      setErrorMsg("Open inside Telegram to sign intents via AstroWallet.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/v1/intents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "sdex_limit_order_create",
          network: feedNetwork,
          sourceAddress: activeAccount.address,
          limitOrder: {
            side: limitSide,
            baseAsset: toAsset || defaultPairAsset,
            quoteAsset: "XLM",
            amount: limitAmount,
            price: limitPrice,
          },
          humanSummary: `SDEX ${limitSide.toUpperCase()} ${limitAmount} ${activeToToken?.code ?? toAsset} @ ${limitPrice} XLM`,
          returnStartAppParam: `${feedNetwork}_token_${toAsset}`,
        }),
      });
      const json = (await res.json()) as { deepLink?: string; error?: string };
      if (!res.ok || !json.deepLink) {
        throw new Error(json.error ?? "Failed to create Signed Intent");
      }
      triggerTelegramHaptic("success");
      setStatusMsg("Intent pre-scanned cleanly. Opening AstroWallet for PIN/Biometric Clear-Sign...");
      openTelegramDeepLink(json.deepLink);
    } catch (err) {
      triggerTelegramHaptic("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to hand off intent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ad-stack-12">
      {quickPairChips.length > 0 && (
        <div className="ad-chip-row" aria-label="1-Tap Trading Pairs">
          {quickPairChips.map((item) => (
            <button
              key={item.assetKey}
              type="button"
              className={`glass-pill ad-clickable ${toAsset === item.assetKey ? "glass-pill--gold" : ""}`}
              onClick={() => {
                setFromAsset("XLM");
                setToAsset(item.assetKey);
                setSelectedAsset(item.assetKey);
                setShowTokenFinder(false);
              }}
            >
              <span>XLM / {item.code}</span>
              {item.reviewStatus === "unreviewed_warning" && <span>⚠️</span>}
            </button>
          ))}
        </div>
      )}

      {focusToken && (
        <section className="glass-card ad-stack-8">
          <div className="ad-row">
            <div className="ad-min-w-0">
              <div className="ad-text-xl ad-font-extrabold ad-flex-wrap">
                <span>{focusToken.code} / XLM</span>
                <span
                  className={`glass-pill ${
                    focusToken.shieldScore >= 75 ? "glass-pill--safe" : "glass-pill--warn"
                  }`}
                >
                  Shield {focusToken.shieldScore}/100
                </span>
              </div>
              <div className="ad-text-xs ad-text-muted">
                {focusToken.name ?? focusToken.kind.toUpperCase()} ·{" "}
                <button type="button" onClick={() => void handleCopyFocusId()} className="ad-link-inline">
                  {copiedId ? "Copied ID!" : `${focusAsset.slice(0, 6)}…${focusAsset.slice(-4)} (Copy)`}
                </button>
              </div>
            </div>
            <div className="ad-text-right tabular-nums">
              <div className="ad-text-lg ad-font-extrabold ad-text-gold">
                {spotXlmPerToken
                  ? `${spotXlmPerToken < 0.01 ? spotXlmPerToken.toFixed(6) : spotXlmPerToken.toFixed(4)} XLM`
                  : "Quoting..."}
              </div>
              {spotXlmPerToken && xlmUsd && xlmUsd > 0 && (
                <div className="ad-text-xs ad-text-muted">
                  ≈ ${(spotXlmPerToken * xlmUsd).toFixed(4)} USD
                </div>
              )}
            </div>
          </div>

          <div className="ad-row ad-row-wrap ad-text-xs ad-text-muted">
            <span className="tabular-nums">
              {ammPair
                ? `Pool Reserve: ${ammPair.reserveQuote} XLM · ${ammPair.reserveBase} ${focusToken.code}`
                : "Multi-Venue Liquidity Active"}
            </span>
            <div className="ad-flex-6">
              <button
                type="button"
                className={`glass-pill ad-clickable ${tradeSubTab === "swap" ? "glass-pill--gold" : ""}`}
                onClick={() => setTradeSubTab("swap")}
              >
                Chart &amp; Swap
              </button>
              <button
                type="button"
                className={`glass-pill ad-clickable ${tradeSubTab === "pools" ? "glass-pill--gold" : ""}`}
                onClick={() => setTradeSubTab("pools")}
              >
                AMMs ({tokenHub?.ammPools.length ?? 0})
              </button>
              <button
                type="button"
                className={`glass-pill ad-clickable ${tradeSubTab === "holders" ? "glass-pill--gold" : ""}`}
                onClick={() => setTradeSubTab("holders")}
              >
                Holders ({tokenHub?.topHolders?.length ?? 0})
              </button>
              <button
                type="button"
                className={`glass-pill ad-clickable ${tradeSubTab === "safety" ? "glass-pill--gold" : ""}`}
                onClick={() => setTradeSubTab("safety")}
              >
                X-Ray
              </button>
            </div>
          </div>

          {tokenHub?.marketStats && (
            <div className="ad-grid-2 ad-text-xs tabular-nums">
              <div className="ad-subcard">
                <div className="ad-text-muted">USD Price / 24h</div>
                <div className="ad-font-bold">
                  {tokenHub.marketStats.priceUsd
                    ? `$${tokenHub.marketStats.priceUsd < 0.01 ? tokenHub.marketStats.priceUsd.toFixed(6) : tokenHub.marketStats.priceUsd.toFixed(4)}`
                    : "--"}
                  {tokenHub.marketStats.change24hPct !== null && (
                    <span
                      className={
                        tokenHub.marketStats.change24hPct >= 0 ? "ad-text-safe" : "ad-text-danger"
                      }
                      style={{ marginLeft: 6 }}
                    >
                      {tokenHub.marketStats.change24hPct >= 0 ? "+" : ""}
                      {tokenHub.marketStats.change24hPct.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="ad-subcard">
                <div className="ad-text-muted">Holders / 7d Vol</div>
                <div className="ad-font-bold">
                  {tokenHub.marketStats.holdersCount
                    ? tokenHub.marketStats.holdersCount.toLocaleString("en-US")
                    : "--"}
                  {tokenHub.marketStats.volume7dUsd
                    ? ` · $${Math.round(tokenHub.marketStats.volume7dUsd).toLocaleString("en-US")}`
                    : ""}
                </div>
              </div>
            </div>
          )}

          <div className="ad-chip-row" aria-label="Chart Timeframe">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                className={`glass-pill ad-clickable ${timeframe === tf ? "glass-pill--gold" : ""}`}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </section>
      )}

      {tradeSubTab === "pools" && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-base">
              AMM Pools &amp; Orderbook · {focusToken?.code ?? focusAsset}
            </strong>
            <span className="glass-pill">
              {hubLoading ? "Syncing..." : `${tokenHub?.ammPools.length ?? 0} pools`}
            </span>
          </div>

          {tokenHub && tokenHub.ammPools.length > 0 ? (
            <div className="ad-stack-6">
              {tokenHub.ammPools.map((pool) => (
                <div key={pool.poolId} className="ad-row ad-item-card">
                  <div className="ad-min-w-0">
                    <div className="ad-font-bold ad-text-sm">
                      {pool.venue.toUpperCase()} · {focusToken?.code ?? focusAsset}/{pool.counterCode}
                    </div>
                    <div className="ad-text-xs ad-text-muted tabular-nums">
                      Fee {(pool.feeBps / 100).toFixed(2)}%
                      {pool.totalTrustlines > 0 ? ` · ${pool.totalTrustlines} LPs` : ""}
                      {pool.reserves.map((r) => ` · ${Number(r.amount).toFixed(2)} ${r.code}`).join("")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ad-btn-secondary ad-btn-sm ad-no-shrink"
                    onClick={() => {
                      setFromAsset(pool.counterAssetKey);
                      setToAsset(focusAsset);
                      setTradeSubTab("swap");
                    }}
                  >
                    Swap Pair
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-banner">
              {hubLoading
                ? "Loading live AMM pools across Horizon & Soroswap..."
                : "No AMM pools indexed for this token yet; Classic SDEX pathfinding still active."}
            </div>
          )}

          {tokenHub?.orderbook && (
            <div className="ad-grid-2">
              <div className="ad-stack-4">
                <div className="ad-text-xs ad-text-muted">Top Bids</div>
                {tokenHub.orderbook.bids.slice(0, 5).map((b, idx) => (
                  <div key={`bid-${idx}`} className="ad-book-bid ad-text-xs tabular-nums">
                    {b.price} · {b.amount}
                  </div>
                ))}
              </div>
              <div className="ad-stack-4">
                <div className="ad-text-xs ad-text-muted">Top Asks</div>
                {tokenHub.orderbook.asks.slice(0, 5).map((a, idx) => (
                  <div key={`ask-${idx}`} className="ad-book-ask ad-text-xs tabular-nums">
                    {a.price} · {a.amount}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tokenHub && tokenHub.recentTrades.length > 0 && (
            <div className="ad-stack-4">
              <div className="ad-text-xs ad-text-muted">Recent Ledger Trades</div>
              {tokenHub.recentTrades.slice(0, 6).map((t) => (
                <div key={t.id} className="ad-row ad-text-xs tabular-nums">
                  <span className={t.side === "buy" ? "ad-text-safe" : "ad-text-danger"}>
                    {t.side.toUpperCase()} {t.baseAmount} {t.baseCode}
                  </span>
                  <span className="ad-text-muted">@ {t.price} {t.counterCode}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tradeSubTab === "holders" && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-base">
              Top On-Chain Holders · {focusToken?.code ?? focusAsset}
            </strong>
            <span className="glass-pill">
              {tokenHub?.marketStats?.holdersCount
                ? `${tokenHub.marketStats.holdersCount.toLocaleString("en-US")} total`
                : `${tokenHub?.topHolders?.length ?? 0} shown`}
            </span>
          </div>
          {tokenHub?.topHolders && tokenHub.topHolders.length > 0 ? (
            <div className="ad-stack-6">
              {tokenHub.topHolders.map((h, idx) => (
                <div key={h.address} className="ad-row ad-item-card">
                  <div className="ad-min-w-0">
                    <div className="ad-font-bold ad-text-sm tabular-nums">
                      #{idx + 1} ·{" "}
                      <a
                        href={`https://stellar.expert/explorer/${feedNetwork === "mainnet" ? "public" : "testnet"}/account/${h.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ad-link-inline"
                      >
                        {h.address.slice(0, 6)}…{h.address.slice(-4)}
                      </a>
                    </div>
                  </div>
                  <div className="ad-text-right ad-text-xs tabular-nums">
                    <strong>{Number(h.balance).toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
                    {h.sharePct !== null && (
                      <div className="ad-text-muted">{h.sharePct.toFixed(2)}%</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-banner">
              {hubLoading
                ? "Loading live holders from Stellar Horizon..."
                : "No public holder snapshot returned for this asset on Horizon."}
            </div>
          )}
        </section>
      )}

      {tradeSubTab === "safety" && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-base">
              Astro Shield X-Ray · {focusToken?.code ?? focusAsset}
            </strong>
            <span
              className={`glass-pill ${
                (tokenHub?.audit?.astroShieldScore ?? 0) >= 75
                  ? "glass-pill--safe"
                  : "glass-pill--warn"
              }`}
            >
              Score {tokenHub?.audit?.astroShieldScore ?? "--"}/100
            </span>
          </div>
          <div className="ad-grid-2">
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Verdict</div>
              <div className="ad-font-bold">{tokenHub?.audit?.verdict ?? "Scanning..."}</div>
            </div>
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Holders / Supply</div>
              <div className="ad-font-bold tabular-nums">
                {tokenHub?.audit?.holdersCount ?? "--"} · {tokenHub?.audit?.circulatingSupply ?? "--"}
              </div>
            </div>
          </div>
          {tokenHub?.audit?.findings && tokenHub.audit.findings.length > 0 ? (
            <div className="ad-stack-6">
              {tokenHub.audit.findings.map((f, i) => (
                <div key={i} className="ad-banner ad-banner--warn ad-text-xs">
                  <strong>{f.severity.toUpperCase()}:</strong> {f.title}
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-banner">
              No critical risk findings detected on {feedNetwork.toUpperCase()} for {focusToken?.code ?? focusAsset}.
            </div>
          )}
        </section>
      )}

      {tradeSubTab === "swap" && (
        <>
          <ChartCanvas
            mode={mode}
            candles={candles}
            depth={depth}
            quoteLabel={focusAsset === "XLM" ? "USDC" : "XLM"}
            timeframe={timeframe}
          />

      <section className="glass-card ad-stack-10">
        <div className="ad-row">
          <strong className="ad-text-lg">
            {executionDisabled
              ? `5-Way Router Simulator (${feedNetwork.toUpperCase()} Live)`
              : "5-Way Smart Router Swap"}
          </strong>
          <div className="ad-flex-6">
            <button
              type="button"
              className="glass-pill ad-clickable"
              onClick={() => setShowTokenFinder((prev) => !prev)}
            >
              {showTokenFinder ? "Hide Search" : "🔍 Find Token"}
            </button>
            <span className="glass-pill">
              {activeAccount?.kind === "smart" ? "Smart C..." : "Classic G..."}
            </span>
          </div>
        </div>

        {showTokenFinder && (
          <TokenSearchInput
            query={finderQuery}
            onQueryChange={setFinderQuery}
            placeholder="Search token by name/ticker (ASTRO, USDC, STELA)..."
            primaryActionLabel="Set To"
            secondaryActionLabel="Set From"
            onSelectToken={(item, action) => {
              if (action === "secondary") {
                setFromAsset(item.assetKey);
              } else {
                setToAsset(item.assetKey);
                setSelectedAsset(item.assetKey);
              }
              setShowTokenFinder(false);
              setFinderQuery("");
            }}
          />
        )}

        <div className="ad-stack-8">
          <div className="ad-grid-swap">
            <select
              className="ad-input"
              value={fromAsset}
              onChange={(e) => setFromAsset(e.target.value)}
              aria-label="From Asset"
            >
              {catalog.length === 0 && <option value="XLM">XLM (Native)</option>}
              {catalog.map((t) => (
                <option key={`from-${t.assetKey}`} value={t.assetKey}>
                  {formatSelectLabel(t.code, t.name, t.assetKey, t.reviewStatus)}
                </option>
              ))}
              {!catalog.some((t) => t.assetKey === fromAsset) && (
                <option value={fromAsset}>{fromAsset}</option>
              )}
            </select>

            <button
              type="button"
              className="ad-btn-secondary ad-btn-flip"
              onClick={handleFlipPair}
              aria-label="Flip Swap Pair"
            >
              ⇄
            </button>

            <select
              className="ad-input"
              value={toAsset}
              onChange={(e) => {
                setToAsset(e.target.value);
                setSelectedAsset(e.target.value);
              }}
              aria-label="To Asset"
            >
              <option value="">Select token...</option>
              {catalog.map((t) => (
                <option key={`to-${t.assetKey}`} value={t.assetKey}>
                  {formatSelectLabel(t.code, t.name, t.assetKey, t.reviewStatus)}
                </option>
              ))}
              {!catalog.some((t) => t.assetKey === toAsset) && toAsset && (
                <option value={toAsset}>{toAsset}</option>
              )}
            </select>
          </div>

          <div className="ad-stack-6">
            <input
              type="text"
              className="ad-input tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              aria-label="Swap Amount"
            />
            <div className="ad-row ad-row-wrap">
              <div className="ad-chip-row">
                {QUICK_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`glass-pill tabular-nums ad-clickable ${amount === preset ? "glass-pill--gold" : ""}`}
                    onClick={() => setAmount(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              {mode === "pro" && (
                <div className="ad-chip-row" aria-label="Slippage Tolerance">
                  {SLIPPAGE_PRESETS.map((s) => (
                    <button
                      key={s.bps}
                      type="button"
                      className={`glass-pill tabular-nums ad-clickable ${slippageBps === s.bps ? "glass-pill--gold" : ""}`}
                      onClick={() => setSlippageBps(s.bps)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {activeToToken?.reviewStatus === "unreviewed_warning" && (
          <div className="ad-banner ad-banner--warn">
            <strong>⚠️ Unreviewed Community Token:</strong>{" "}
            {activeToToken.reviewNote ?? "Not yet reviewed by AstroDex moderators. Verify before signing."}
          </div>
        )}

        <div className="ad-quote-slot">
          {quoting ? (
            <div className="ad-banner">Racing 5 liquidity venues in parallel...</div>
          ) : quote?.blockedReason ? (
            <div className="ad-banner ad-banner--danger">{quote.blockedReason}</div>
          ) : quote?.bestRoute ? (
            <div className="ad-banner ad-stack-6">
              <div className="ad-row">
                <strong>Best Route ({quote.bestRoute.venue})</strong>
                {effectiveRateLabel && (
                  <span className="ad-text-xs ad-text-muted tabular-nums">{effectiveRateLabel}</span>
                )}
              </div>
              <div className="tabular-nums ad-text-base ad-font-bold">
                {quote.bestRoute.inputAmount} {activeFromToken?.code ?? "FROM"} →{" "}
                <span className="ad-text-emerald">
                  {quote.bestRoute.expectedOutputAmount} {activeToToken?.code ?? quote.bestRoute.toAsset}
                </span>
              </div>
              <div className="ad-text-xs ad-text-muted tabular-nums">
                Min Received ({(slippageBps / 100).toFixed(1)}% slip): {quote.bestRoute.minOutputAmount} · Fee {(quote.bestRoute.feeBps / 100).toFixed(2)}% · Impact {quote.bestRoute.priceImpactPct}%
              </div>

              {mode === "pro" && quote.routes.length > 0 && (
                <div className="ad-route-matrix">
                  <div className="ad-text-xs ad-font-bold">5-Venue Route Matrix</div>
                  {quote.routes.map((r, i) => (
                    <div key={`${r.venue}-${i}`} className="ad-row tabular-nums ad-text-xs">
                      <span>{i === 0 ? "★ " : ""}{r.venue}</span>
                      <span>
                        {r.expectedOutputAmount} {activeToToken?.code ?? ""} ({(r.feeBps / 100).toFixed(2)}%)
                      </span>
                    </div>
                  ))}
                  {quote.skippedVenues.map((s) => (
                    <div key={s.venue} className="ad-row ad-text-xxs ad-text-muted">
                      <span>{s.venue}</span>
                      <span>{s.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="ad-banner">
              {toAsset
                ? "No active liquidity pool found on Testnet for this pair/amount. Try XLM / ASTRO, XLM / USDC, or XLM / STELA."
                : "Pick a pair & amount for a live 5-Way routing quote."}
            </div>
          )}
        </div>

        {errorMsg && <div className="ad-banner ad-banner--danger">{errorMsg}</div>}
        {statusMsg && <div className="ad-banner">{statusMsg}</div>}

        <button
          type="button"
          className="ad-btn-primary"
          disabled={executionDisabled || submitting || Boolean(quote?.blockedReason) || !quote?.bestRoute}
          onClick={() => void handleHandoffSwap()}
        >
          {executionDisabled
            ? `🔒 Trading Disabled (${feedNetwork.toUpperCase()} Visualizer Mode)`
            : submitting
              ? "Pre-Scanning Swap XDR..."
              : "Sign Swap in AstroWallet"}
        </button>
      </section>

      {mode === "pro" && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-lg">Classic SDEX Limit Order (G... Only)</strong>
            <span className="glass-pill glass-pill--gold">manageBuy/SellOffer</span>
          </div>

          {activeAccount?.kind === "smart" ? (
            <div className="ad-banner ad-banner--warn">
              Smart Accounts (`C...`) cannot place Classic SDEX offers. Switch to your Classic `G...` pill above.
            </div>
          ) : (
            <>
              <div className="ad-flex-8 ad-row-wrap">
                <button
                  type="button"
                  className={limitSide === "buy" ? "ad-btn-primary" : "ad-btn-secondary"}
                  onClick={() => setLimitSide("buy")}
                >
                  Buy Limit
                </button>
                <button
                  type="button"
                  className={limitSide === "sell" ? "ad-btn-primary" : "ad-btn-secondary"}
                  onClick={() => setLimitSide("sell")}
                >
                  Sell Limit
                </button>
                {spotXlmPerToken && (
                  <button
                    type="button"
                    className="glass-pill ad-clickable"
                    onClick={() => setLimitPrice(spotXlmPerToken.toFixed(6))}
                  >
                    Use Spot ({spotXlmPerToken.toFixed(4)})
                  </button>
                )}
              </div>
              <div className="ad-grid-2">
                <input
                  type="text"
                  className="ad-input tabular-nums"
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                  placeholder="Amount"
                />
                <input
                  type="text"
                  className="ad-input tabular-nums"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Price in XLM"
                />
              </div>
              <button
                type="button"
                className="ad-btn-gold"
                disabled={executionDisabled || submitting || !toAsset}
                onClick={() => void handleHandoffLimitOrder()}
              >
                {executionDisabled
                  ? "🔒 Limit Orders Disabled (Visualizer Mode)"
                  : submitting
                    ? "Pre-Scanning XDR..."
                    : "Place Limit Order via AstroWallet"}
              </button>
            </>
          )}
        </section>
      )}
        </>
      )}
    </div>
  );
}
