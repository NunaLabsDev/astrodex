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
    tvlUsd?: number;
    volume24hUsd?: number;
    totalApyPct?: number;
    rewardsApyPct?: number;
    poolType?: string;
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
  if (assetKey === "XLM") return "✦ XLM (Native)";
  const shortName =
    name && name.toUpperCase() !== code.toUpperCase() ? ` · ${name.slice(0, 12)}` : "";
  return `${icon} ${code}${shortName}`;
}

export function TradeChartView() {
  const {
    config,
    feedNetwork,
    executionDisabled,
    activeAccount,
    sessionToken,
    selectedAsset,
    setSelectedAsset,
    tradeScrollTarget,
    setTradeScrollTarget,
    tradePairOverride,
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

  // Classic SDEX Limit Order fields
  const [limitSide, setLimitSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState("1.0");
  const [limitAmount, setLimitAmount] = useState("10");

  useEffect(() => {
    if (!tradeScrollTarget || tradeScrollTarget === "swap") {
      if (tradeScrollTarget === "swap") setTradeScrollTarget(null);
      return;
    }
    const idMap: Record<"pools" | "safety" | "limit", string> = {
      pools: "astro-pools",
      safety: "astro-xray",
      limit: "astro-limit-order",
    };
    const el = document.getElementById(idMap[tradeScrollTarget]);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setTradeScrollTarget(null);
  }, [tradeScrollTarget, setTradeScrollTarget]);

  useEffect(() => {
    if (tradePairOverride) {
      setFromAsset(tradePairOverride.fromAsset);
      setToAsset(tradePairOverride.toAsset);
    }
  }, [tradePairOverride]);

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

  const shieldScore = tokenHub?.audit?.astroShieldScore ?? focusToken?.shieldScore;

  return (
    <div className="ad-stack-12">
      {/* BLOCK 1 (Top — Novice Friendly): Minimalist Instant Swap Card */}
      <section className="glass-card ad-stack-10">
        <div className="ad-row ad-row-wrap">
          <div className="ad-min-w-0">
            <div className="ad-text-lg ad-font-extrabold ad-flex-6">
              <span>{focusToken ? `${focusToken.code} / XLM` : "Instant Swap"}</span>
              {typeof shieldScore === "number" && (
                <span
                  className={`glass-pill ${
                    shieldScore >= 75 ? "glass-pill--safe" : "glass-pill--warn"
                  }`}
                >
                  Shield {shieldScore}
                </span>
              )}
            </div>
            <div className="ad-text-xs ad-text-muted tabular-nums">
              {spotXlmPerToken
                ? `1 ${focusToken?.code ?? "TOK"} ≈ ${
                    spotXlmPerToken < 0.01
                      ? spotXlmPerToken.toFixed(6)
                      : spotXlmPerToken.toFixed(4)
                  } XLM${
                    xlmUsd && xlmUsd > 0
                      ? ` ($${(spotXlmPerToken * xlmUsd).toFixed(4)})`
                      : ""
                  }`
                : "5-Way Smart Router"}
            </div>
          </div>

          <button
            type="button"
            className="glass-pill ad-clickable"
            onClick={() => setShowTokenFinder((prev) => !prev)}
          >
            {showTokenFinder ? "Close Search" : "🔍 Find Token"}
          </button>
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

        <div className="ad-stack-6">
          {/* You Pay */}
          <div className="ad-swap-panel">
            <div className="ad-row ad-text-xs ad-text-muted">
              <span>You Pay</span>
              <span>{activeAccount?.kind === "smart" ? "Smart C…" : "Classic G…"}</span>
            </div>
            <div className="ad-grid-swap-row">
              <select
                className="ad-input"
                value={fromAsset}
                onChange={(e) => setFromAsset(e.target.value)}
                aria-label="From Asset"
              >
                {catalog.length === 0 && <option value="XLM">✦ XLM (Native)</option>}
                {catalog.map((t) => (
                  <option key={`from-${t.assetKey}`} value={t.assetKey}>
                    {formatSelectLabel(t.code, t.name, t.assetKey, t.reviewStatus)}
                  </option>
                ))}
                {!catalog.some((t) => t.assetKey === fromAsset) && (
                  <option value={fromAsset}>{fromAsset}</option>
                )}
              </select>
              <input
                type="text"
                inputMode="decimal"
                className="ad-input tabular-nums ad-text-right ad-font-bold"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                aria-label="Swap Amount"
              />
            </div>
            <div className="ad-stack-6">
              <div className="ad-chip-row">
                <span className="ad-text-xs ad-text-muted">Quick:</span>
                {QUICK_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`glass-pill tabular-nums ad-clickable ${
                      amount === preset ? "glass-pill--gold" : ""
                    }`}
                    style={{ minHeight: 32, padding: "5px 10px" }}
                    onClick={() => setAmount(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div className="ad-chip-row" aria-label="Slippage Tolerance">
                <span className="ad-text-xs ad-text-muted">Slip:</span>
                {SLIPPAGE_PRESETS.map((s) => (
                  <button
                    key={s.bps}
                    type="button"
                    className={`glass-pill tabular-nums ad-clickable ${
                      slippageBps === s.bps ? "glass-pill--gold" : ""
                    }`}
                    style={{ minHeight: 32, padding: "5px 10px" }}
                    onClick={() => setSlippageBps(s.bps)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ad-swap-flip-row">
            <button
              type="button"
              className="ad-btn-flip-circle"
              onClick={handleFlipPair}
              aria-label="Flip Swap Pair"
              title="Flip Swap Pair"
            >
              ⇅
            </button>
          </div>

          {/* You Receive */}
          <div className="ad-swap-panel">
            <div className="ad-row ad-text-xs ad-text-muted">
              <span>You Receive</span>
              {quote?.bestRoute && (
                <span className="glass-pill glass-pill--safe" style={{ fontSize: 10, padding: "2px 8px" }}>
                  Best: {quote.bestRoute.venue}
                </span>
              )}
            </div>
            <div className="ad-grid-swap-row">
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
              <div className="ad-text-right tabular-nums">
                <div className="ad-text-lg ad-font-extrabold ad-text-emerald">
                  {quoting
                    ? "Quoting…"
                    : quote?.bestRoute
                      ? quote.bestRoute.expectedOutputAmount
                      : "--"}
                </div>
                {effectiveRateLabel && (
                  <div className="ad-text-xxs ad-text-muted">{effectiveRateLabel}</div>
                )}
              </div>
            </div>

            {quote?.bestRoute && (
              <div className="ad-stack-6">
                <div className="ad-text-xs ad-text-muted tabular-nums">
                  Min Received ({(slippageBps / 100).toFixed(1)}%): {quote.bestRoute.minOutputAmount} ·
                  Fee {(quote.bestRoute.feeBps / 100).toFixed(2)}% · Impact{" "}
                  {quote.bestRoute.priceImpactPct}%
                </div>
                {quote.routes.length > 0 && (
                  <details className="ad-details">
                    <summary>
                      <span>View 5-Venue Route Matrix ({quote.routes.length} routes)</span>
                      <span>▾</span>
                    </summary>
                    <div className="ad-route-matrix">
                      {quote.routes.map((r, i) => (
                        <div key={`${r.venue}-${i}`} className="ad-row tabular-nums ad-text-xs">
                          <span>
                            {i === 0 ? "★ " : ""}
                            {r.venue}
                          </span>
                          <span>
                            {r.expectedOutputAmount} {activeToToken?.code ?? ""} (
                            {(r.feeBps / 100).toFixed(2)}%)
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
                  </details>
                )}
              </div>
            )}

            {quote?.blockedReason && (
              <div className="ad-banner ad-banner--danger">{quote.blockedReason}</div>
            )}
          </div>
        </div>

        {activeToToken?.reviewStatus === "unreviewed_warning" && (
          <div className="ad-banner ad-banner--warn">
            <strong>⚠️ Unreviewed Community Token:</strong>{" "}
            {activeToToken.reviewNote ?? "Not yet reviewed by AstroDex moderators. Verify before signing."}
          </div>
        )}

        {errorMsg && <div className="ad-banner ad-banner--danger">{errorMsg}</div>}
        {statusMsg && <div className="ad-banner">{statusMsg}</div>}

        <button
          type="button"
          className="ad-btn-primary ad-btn-block"
          disabled={
            executionDisabled || submitting || Boolean(quote?.blockedReason) || !quote?.bestRoute
          }
          onClick={() => void handleHandoffSwap()}
        >
          {executionDisabled
            ? `🔒 Trading Disabled (${feedNetwork.toUpperCase()} Visualizer Mode)`
            : submitting
              ? "Pre-Scanning Swap XDR..."
              : "Sign Swap in AstroWallet"}
        </button>

        <div className="ad-text-center ad-text-xs ad-text-muted">
          ↓ Scroll down for Live Chart, Orderbook, Limit Orders, Pools &amp; X-Ray
        </div>
      </section>

      {/* BLOCK 2 (Scroll Down): Live Price Chart */}
      <section className="glass-card ad-stack-10">
        <div className="ad-row ad-row-wrap">
          <strong className="ad-text-base">
            Price Chart · {focusToken?.code ?? focusAsset} / {focusAsset === "XLM" ? "USDC" : "XLM"}
          </strong>
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
        </div>

        {tokenHub?.marketStats && (
          <div className="ad-grid-2 ad-text-xs tabular-nums">
            <div className="ad-subcard">
              <div className="ad-text-muted">USD Price / 24h</div>
              <div className="ad-font-bold">
                {tokenHub.marketStats.priceUsd
                  ? `$${
                      tokenHub.marketStats.priceUsd < 0.01
                        ? tokenHub.marketStats.priceUsd.toFixed(6)
                        : tokenHub.marketStats.priceUsd.toFixed(4)
                    }`
                  : "--"}
                {tokenHub.marketStats.change24hPct !== null && (
                  <span
                    className={
                      tokenHub.marketStats.change24hPct >= 0 ? "ad-text-emerald" : "ad-text-coral"
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

        <ChartCanvas
          candles={candles}
          depth={depth}
          quoteLabel={focusAsset === "XLM" ? "USDC" : "XLM"}
          timeframe={timeframe}
        />
      </section>

      {/* BLOCK 3 (Scroll Down): Live Orderbook & Classic SDEX Limit Order */}
      <section id="astro-limit-order" className="glass-card ad-stack-10">
        <div className="ad-row">
          <strong className="ad-text-base">Orderbook &amp; Limit Orders</strong>
          {tokenHub?.orderbook?.spreadPct && (
            <span className="glass-pill tabular-nums">
              Spread {tokenHub.orderbook.spreadPct}%
            </span>
          )}
        </div>

        {tokenHub?.orderbook ? (
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
        ) : (
          <div className="ad-banner">
            {hubLoading
              ? "Loading live orderbook depth..."
              : "No resting SDEX orderbook depth indexed for this pair."}
          </div>
        )}

        {tokenHub && tokenHub.recentTrades.length > 0 && (
          <div className="ad-stack-4">
            <div className="ad-text-xs ad-text-muted">Recent Ledger Trades</div>
            {tokenHub.recentTrades.slice(0, 5).map((t) => (
              <div key={t.id} className="ad-row ad-text-xs tabular-nums">
                <span className={t.side === "buy" ? "ad-text-emerald" : "ad-text-coral"}>
                  {t.side.toUpperCase()} {t.baseAmount} {t.baseCode}
                </span>
                <span className="ad-text-muted">
                  @ {t.price} {t.counterCode}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="ad-divider" />

        <div className="ad-stack-8">
          <div className="ad-row">
            <strong className="ad-text-md">Place Limit Order (Classic G…)</strong>
            <span className="glass-pill glass-pill--gold">SDEX</span>
          </div>

          {activeAccount?.kind === "smart" ? (
            <div className="ad-banner ad-banner--warn">
              Smart Accounts (<code>C...</code>) trade via AMMs. Switch to a Classic <code>G...</code>{" "}
              key in Account menu to place SDEX limit orders.
            </div>
          ) : (
            <>
              <div className="ad-flex-8 ad-row-wrap">
                <button
                  type="button"
                  className={limitSide === "buy" ? "ad-btn-primary ad-btn-sm" : "ad-btn-secondary ad-btn-sm"}
                  onClick={() => setLimitSide("buy")}
                >
                  Buy Limit
                </button>
                <button
                  type="button"
                  className={limitSide === "sell" ? "ad-btn-primary ad-btn-sm" : "ad-btn-secondary ad-btn-sm"}
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
                  inputMode="decimal"
                  className="ad-input tabular-nums"
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                  placeholder="Amount"
                  aria-label="Limit Order Amount"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="ad-input tabular-nums"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Price in XLM"
                  aria-label="Limit Order Price in XLM"
                />
              </div>
              <button
                type="button"
                className="ad-btn-gold ad-btn-block"
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
        </div>
      </section>

      {/* BLOCK 4 (Scroll Down): AMM Liquidity Pools & Top Holders */}
      <section id="astro-pools" className="glass-card ad-stack-10">
        <div className="ad-row">
          <strong className="ad-text-base">
            AMM Pools &amp; Liquidity · {focusToken?.code ?? focusAsset}
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
                    {pool.poolType
                      ? ` · ${pool.poolType === "concentrated" ? "Conc." : pool.poolType}`
                      : ""}
                  </div>
                  <div className="ad-text-xs ad-text-muted tabular-nums">
                    Fee {(pool.feeBps / 100).toFixed(2)}%
                    {pool.tvlUsd && pool.tvlUsd > 0
                      ? ` · TVL $${Math.round(pool.tvlUsd).toLocaleString("en-US")}`
                      : ""}
                    {pool.volume24hUsd && pool.volume24hUsd > 0
                      ? ` · 24h $${Math.round(pool.volume24hUsd).toLocaleString("en-US")}`
                      : ""}
                    {pool.totalApyPct && pool.totalApyPct > 0
                      ? ` · APY ${pool.totalApyPct.toFixed(1)}%`
                      : ""}
                    {pool.rewardsApyPct && pool.rewardsApyPct > 0
                      ? ` (+${pool.rewardsApyPct.toFixed(1)}% AQUA)`
                      : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="ad-btn-secondary ad-btn-sm ad-no-shrink"
                  onClick={() => {
                    setFromAsset(pool.counterAssetKey);
                    setToAsset(focusAsset);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Use Pair
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

        <div className="ad-divider" />

        <div className="ad-row">
          <strong className="ad-text-md">Top On-Chain Holders</strong>
          <span className="glass-pill">
            {tokenHub?.marketStats?.holdersCount
              ? `${tokenHub.marketStats.holdersCount.toLocaleString("en-US")} total`
              : `${tokenHub?.topHolders?.length ?? 0} shown`}
          </span>
        </div>

        {tokenHub?.topHolders && tokenHub.topHolders.length > 0 ? (
          <div className="ad-stack-6">
            {tokenHub.topHolders.slice(0, 6).map((h, idx) => (
              <div key={h.address} className="ad-row ad-item-card">
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
                <div className="ad-text-right ad-text-xs tabular-nums">
                  <strong>
                    {Number(h.balance).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </strong>
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

      {/* BLOCK 5 (Bottom of Scroll): Astro Shield X-Ray & On-Chain Audit */}
      <section id="astro-xray" className="glass-card ad-stack-10">
        <div className="ad-row">
          <strong className="ad-text-base">
            Astro Shield X-Ray · {focusToken?.code ?? focusAsset}
          </strong>
          <span
            className={`glass-pill ${
              (shieldScore ?? 0) >= 75 ? "glass-pill--safe" : "glass-pill--warn"
            }`}
          >
            Score {shieldScore ?? "--"}/100
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
            No critical risk findings detected on {feedNetwork.toUpperCase()} for{" "}
            {focusToken?.code ?? focusAsset}.
          </div>
        )}

        <details className="ad-details">
          <summary>
            <span>Asset &amp; Contract Metadata</span>
            <span>▾</span>
          </summary>
          <div className="ad-stack-6" style={{ marginTop: 8 }}>
            <div className="ad-text-xs ad-text-muted">
              Asset Key: <code className="tabular-nums">{focusAsset}</code>
            </div>
            <button
              type="button"
              className="ad-btn-secondary ad-btn-sm"
              onClick={() => void handleCopyFocusId()}
            >
              {copiedId ? "Copied Asset ID!" : "Copy Asset ID"}
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
