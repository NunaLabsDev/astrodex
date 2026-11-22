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
    mode,
    activeAccount,
    sessionToken,
    selectedAsset,
    setSelectedAsset,
    setActiveTab,
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
      if (!focusAsset || focusAsset === "XLM") return;
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const pair = `${encodeURIComponent(focusAsset)}-XLM`;
        const [candlesRes, bookRes] = await Promise.all([
          fetch(`${base}/v1/candles/${pair}?tf=${timeframe}`),
          fetch(`${base}/v1/orderbook/${pair}`),
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
      } catch {
        // Ignore offline chart errors
      }
    }
    void loadChartAndDepth();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, focusAsset, timeframe]);

  useEffect(() => {
    if (!toAsset.trim() || !amount.trim() || fromAsset.trim() === toAsset.trim()) {
      setQuote(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuoting(true);
      setErrorMsg(null);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromAsset: fromAsset.trim(),
            toAsset: toAsset.trim(),
            amount: amount.trim(),
            slippageBps,
            sourceAddress: activeAccount?.address,
            accountKind: activeAccount?.kind ?? "classic",
          }),
        });
        const json = (await res.json()) as { quote?: MultiVenueQuoteResult; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Quote failed");
        if (!cancelled && json.quote) {
          setQuote(json.quote);
        }
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : "Quote error");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config.apiBaseUrl, fromAsset, toAsset, amount, slippageBps, activeAccount]);

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
          returnStartAppParam: `token_${toAsset}`,
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
          sourceAddress: activeAccount.address,
          limitOrder: {
            side: limitSide,
            baseAsset: toAsset || defaultPairAsset,
            quoteAsset: "XLM",
            amount: limitAmount,
            price: limitPrice,
          },
          humanSummary: `SDEX ${limitSide.toUpperCase()} ${limitAmount} ${activeToToken?.code ?? toAsset} @ ${limitPrice} XLM`,
          returnStartAppParam: `token_${toAsset}`,
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
    <div style={{ display: "grid", gap: 12 }}>
      {quickPairChips.length > 0 && (
        <div className="ad-chip-row" aria-label="1-Tap Trading Pairs">
          {quickPairChips.map((item) => (
            <button
              key={item.assetKey}
              type="button"
              className={`glass-pill ${toAsset === item.assetKey ? "glass-pill--gold" : ""}`}
              style={{ cursor: "pointer" }}
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
        <section className="glass-card" style={{ display: "grid", gap: 8 }}>
          <div className="ad-row">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span>{focusToken.code} / XLM</span>
                <span
                  className={`glass-pill ${
                    focusToken.shieldScore >= 75
                      ? "glass-pill--safe"
                      : "glass-pill--warn"
                  }`}
                >
                  Shield {focusToken.shieldScore}/100
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }}>
                {focusToken.name ?? focusToken.kind.toUpperCase()} ·{" "}
                <button
                  type="button"
                  onClick={() => void handleCopyFocusId()}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--ad-nebula-lavender)",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {copiedId ? "Copied ID!" : `${focusAsset.slice(0, 6)}…${focusAsset.slice(-4)} (Copy)`}
                </button>
              </div>
            </div>
            <div style={{ textAlign: "right" }} className="tabular-nums">
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ad-stellar-gold)" }}>
                {spotXlmPerToken ? `${spotXlmPerToken < 0.01 ? spotXlmPerToken.toFixed(6) : spotXlmPerToken.toFixed(4)} XLM` : "Quoting..."}
              </div>
              {spotXlmPerToken && xlmUsd && xlmUsd > 0 && (
                <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }}>
                  ≈ ${(spotXlmPerToken * xlmUsd).toFixed(4)} USD
                </div>
              )}
            </div>
          </div>

          <div className="ad-row" style={{ flexWrap: "wrap", fontSize: 11, color: "var(--ad-ink-secondary)" }}>
            <span className="tabular-nums">
              {ammPair
                ? `Pool Reserve: ${ammPair.reserveQuote} XLM · ${ammPair.reserveBase} ${focusToken.code}`
                : "Multi-Venue Liquidity Active"}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="glass-pill"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setSelectedAsset(focusAsset);
                  setActiveTab("book");
                }}
              >
                Book
              </button>
              <button
                type="button"
                className="glass-pill"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setSelectedAsset(focusAsset);
                  setActiveTab("scanner");
                }}
              >
                X-Ray
              </button>
            </div>
          </div>

          <div className="ad-chip-row" aria-label="Chart Timeframe">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                className={`glass-pill ${timeframe === tf ? "glass-pill--gold" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </section>
      )}

      <ChartCanvas mode={mode} candles={candles} depth={depth} quoteLabel="XLM" />

      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>5-Way Smart Router Swap</strong>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              className="glass-pill"
              style={{ cursor: "pointer" }}
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

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
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
              className="ad-btn-secondary"
              style={{ minWidth: 44, padding: "8px 10px" }}
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

          <div style={{ display: "grid", gap: 6 }}>
            <input
              type="text"
              className="ad-input tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              aria-label="Swap Amount"
            />
            <div className="ad-row" style={{ flexWrap: "wrap" }}>
              <div className="ad-chip-row">
                {QUICK_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`glass-pill tabular-nums ${amount === preset ? "glass-pill--gold" : ""}`}
                    style={{ cursor: "pointer" }}
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
                      className={`glass-pill tabular-nums ${slippageBps === s.bps ? "glass-pill--gold" : ""}`}
                      style={{ cursor: "pointer" }}
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
            <div className="ad-banner" style={{ display: "grid", gap: 6 }}>
              <div className="ad-row">
                <strong>Best Route ({quote.bestRoute.venue})</strong>
                {effectiveRateLabel && (
                  <span style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }} className="tabular-nums">
                    {effectiveRateLabel}
                  </span>
                )}
              </div>
              <div className="tabular-nums" style={{ fontSize: 14, fontWeight: 700 }}>
                {quote.bestRoute.inputAmount} {activeFromToken?.code ?? "FROM"} →{" "}
                <span style={{ color: "var(--ad-bid-emerald)" }}>
                  {quote.bestRoute.expectedOutputAmount} {activeToToken?.code ?? quote.bestRoute.toAsset}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }} className="tabular-nums">
                Min Received ({(slippageBps / 100).toFixed(1)}% slip): {quote.bestRoute.minOutputAmount} · Fee {(quote.bestRoute.feeBps / 100).toFixed(2)}% · Impact {quote.bestRoute.priceImpactPct}%
              </div>

              {mode === "pro" && quote.routes.length > 0 && (
                <div style={{ display: "grid", gap: 4, marginTop: 4, borderTop: "1px solid rgba(165,139,224,0.2)", paddingTop: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>5-Venue Route Matrix</div>
                  {quote.routes.map((r, i) => (
                    <div key={`${r.venue}-${i}`} className="ad-row tabular-nums" style={{ fontSize: 11 }}>
                      <span>{i === 0 ? "★ " : ""}{r.venue}</span>
                      <span>
                        {r.expectedOutputAmount} {activeToToken?.code ?? ""} ({(r.feeBps / 100).toFixed(2)}%)
                      </span>
                    </div>
                  ))}
                  {quote.skippedVenues.map((s) => (
                    <div key={s.venue} className="ad-row" style={{ fontSize: 10, color: "var(--ad-ink-secondary)" }}>
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
          disabled={submitting || Boolean(quote?.blockedReason) || !quote?.bestRoute}
          onClick={() => void handleHandoffSwap()}
        >
          {submitting ? "Pre-Scanning Swap XDR..." : "Sign Swap in AstroWallet"}
        </button>
      </section>

      {mode === "pro" && (
        <section className="glass-card" style={{ display: "grid", gap: 10 }}>
          <div className="ad-row">
            <strong style={{ fontSize: 15 }}>Classic SDEX Limit Order (G... Only)</strong>
            <span className="glass-pill glass-pill--gold">manageBuy/SellOffer</span>
          </div>

          {activeAccount?.kind === "smart" ? (
            <div className="ad-banner ad-banner--warn">
              Smart Accounts (`C...`) cannot place Classic SDEX offers. Switch to your Classic `G...` pill above.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                    className="glass-pill"
                    style={{ cursor: "pointer" }}
                    onClick={() => setLimitPrice(spotXlmPerToken.toFixed(6))}
                  >
                    Use Spot ({spotXlmPerToken.toFixed(4)})
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
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
                disabled={submitting || !toAsset}
                onClick={() => void handleHandoffLimitOrder()}
              >
                {submitting ? "Pre-Scanning XDR..." : "Place Limit Order via AstroWallet"}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
