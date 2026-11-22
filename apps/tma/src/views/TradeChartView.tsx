import type { MultiVenueQuoteResult, OhlcvCandle } from "@astrodex/domain";
import { useEffect, useMemo, useState } from "react";
import { ChartCanvas } from "../components/ChartCanvas.js";
import { useAppState } from "../state/app-context.js";
import {
  openTelegramDeepLink,
  setTelegramClosingConfirmation,
  triggerTelegramHaptic,
} from "../telegram/webapp.js";

const QUICK_AMOUNTS = ["10", "50", "100", "500"] as const;

export function TradeChartView() {
  const {
    config,
    mode,
    activeAccount,
    sessionToken,
    selectedAsset,
    setSelectedAsset,
    catalog,
  } = useAppState();

  const [fromAsset, setFromAsset] = useState("XLM");
  const [toAsset, setToAsset] = useState(selectedAsset === "XLM" ? "" : selectedAsset);
  const [customToInput, setCustomToInput] = useState("");
  const [showCustomTo, setShowCustomTo] = useState(false);
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<MultiVenueQuoteResult | null>(null);
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Classic SDEX Limit Order fields (Pro Mode)
  const [limitSide, setLimitSide] = useState<"buy" | "sell">("buy");
  const [limitPrice, setLimitPrice] = useState("1.0");
  const [limitAmount, setLimitAmount] = useState("10");

  // Auto-select first non-XLM official/verified token when user hasn't chosen one yet
  useEffect(() => {
    if (selectedAsset && selectedAsset !== "XLM") {
      setToAsset(selectedAsset);
      setShowCustomTo(false);
      return;
    }
    if (!toAsset && catalog.length > 1) {
      const firstPair = catalog.find((item) => item.assetKey !== "XLM");
      if (firstPair) {
        setToAsset(firstPair.assetKey);
      }
    }
  }, [selectedAsset, catalog, toAsset]);

  useEffect(() => {
    setTelegramClosingConfirmation(submitting);
    return () => setTelegramClosingConfirmation(false);
  }, [submitting]);

  const activeToToken = useMemo(
    () => catalog.find((item) => item.assetKey === toAsset),
    [catalog, toAsset],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadCandles() {
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const target = toAsset || selectedAsset || "XLM";
        const pair = `${encodeURIComponent(target)}-XLM`;
        const res = await fetch(`${base}/v1/candles/${pair}?tf=1h`);
        if (!res.ok) return;
        const json = (await res.json()) as { candles?: OhlcvCandle[] };
        if (!cancelled) setCandles(json.candles ?? []);
      } catch {
        // Ignore offline chart errors
      }
    }
    void loadCandles();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, selectedAsset, toAsset]);

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
            slippageBps: 50,
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
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config.apiBaseUrl, fromAsset, toAsset, amount, activeAccount]);

  const handleFlipPair = () => {
    if (!toAsset) return;
    triggerTelegramHaptic("selection");
    const prevFrom = fromAsset;
    setFromAsset(toAsset);
    setToAsset(prevFrom);
  };

  const handleHandoffSwap = async () => {
    if (!quote?.bestRoute) return;
    if (!activeAccount || !sessionToken) {
      setErrorMsg("Open inside Telegram and connect AstroWallet (AstroID) to sign swaps.");
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
          humanSummary: `Swap ${quote.bestRoute.inputAmount} ${fromAsset === "XLM" ? "XLM" : "Token"} -> ~${quote.bestRoute.expectedOutputAmount} ${toLabel} via ${quote.bestRoute.venue}`,
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
            baseAsset: toAsset || "XLM",
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
      {catalog.length > 1 && (
        <div className="ad-chip-row" aria-label="1-Tap Trading Pairs">
          {catalog
            .filter((item) => item.assetKey !== "XLM")
            .slice(0, 8)
            .map((item) => (
              <button
                key={item.assetKey}
                type="button"
                className={`glass-pill ${toAsset === item.assetKey ? "glass-pill--gold" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setFromAsset("XLM");
                  setToAsset(item.assetKey);
                  setSelectedAsset(item.assetKey);
                  setShowCustomTo(false);
                }}
              >
                <span>XLM / {item.code}</span>
                {item.reviewStatus === "unreviewed_warning" && <span>⚠️</span>}
              </button>
            ))}
        </div>
      )}

      <ChartCanvas mode={mode} candles={candles} depth={[]} quoteLabel="XLM" />

      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>5-Way Smart Router Swap</strong>
          <span className="glass-pill">
            {activeAccount?.kind === "smart" ? "Smart C... (Soroban)" : "Classic G... (SDEX+AMM)"}
          </span>
        </div>

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
                  {t.code} {t.reviewStatus === "official" ? "🛡️" : t.reviewStatus === "unreviewed_warning" ? "⚠️" : "✓"}
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
              value={showCustomTo ? "__custom__" : toAsset}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setShowCustomTo(true);
                } else {
                  setShowCustomTo(false);
                  setToAsset(e.target.value);
                  setSelectedAsset(e.target.value);
                }
              }}
              aria-label="To Asset"
            >
              <option value="">Select token...</option>
              {catalog.map((t) => (
                <option key={`to-${t.assetKey}`} value={t.assetKey}>
                  {t.code} {t.reviewStatus === "official" ? "🛡️" : t.reviewStatus === "unreviewed_warning" ? "⚠️ Unreviewed" : "✓"}
                </option>
              ))}
              {!catalog.some((t) => t.assetKey === toAsset) && toAsset && (
                <option value={toAsset}>{toAsset}</option>
              )}
              <option value="__custom__">+ Paste CODE:G... or C...</option>
            </select>
          </div>

          {showCustomTo && (
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                className="ad-input"
                value={customToInput}
                onChange={(e) => setCustomToInput(e.target.value)}
                placeholder="Paste CODE:G... or Soroban C..."
              />
              <button
                type="button"
                className="ad-btn-secondary"
                onClick={() => {
                  if (customToInput.trim()) {
                    setToAsset(customToInput.trim());
                    setSelectedAsset(customToInput.trim());
                    setShowCustomTo(false);
                  }
                }}
              >
                Use
              </button>
            </div>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            <input
              type="text"
              className="ad-input tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              aria-label="Swap Amount"
            />
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
            <div className="ad-banner">
              <strong>Best Route ({quote.bestRoute.venue}):</strong>{" "}
              <span className="tabular-nums">
                {quote.bestRoute.expectedOutputAmount} {activeToToken?.code ?? quote.bestRoute.toAsset}
              </span>{" "}
              (Min {quote.bestRoute.minOutputAmount})
            </div>
          ) : (
            <div className="ad-banner">Pick a pair &amp; amount for a live 5-Way routing quote.</div>
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
              <div style={{ display: "flex", gap: 8 }}>
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
