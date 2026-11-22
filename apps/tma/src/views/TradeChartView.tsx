import type { MultiVenueQuoteResult, OhlcvCandle } from "@astrodex/domain";
import { useEffect, useState } from "react";
import { ChartCanvas } from "../components/ChartCanvas.js";
import { useAppState } from "../state/app-context.js";
import {
  openTelegramDeepLink,
  setTelegramClosingConfirmation,
  triggerTelegramHaptic,
} from "../telegram/webapp.js";

export function TradeChartView() {
  const { config, mode, activeAccount, sessionToken, selectedAsset } = useAppState();
  const [fromAsset, setFromAsset] = useState("XLM");
  const [toAsset, setToAsset] = useState(selectedAsset === "XLM" ? "" : selectedAsset);
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

  useEffect(() => {
    if (selectedAsset && selectedAsset !== "XLM") {
      setToAsset(selectedAsset);
    }
  }, [selectedAsset]);

  useEffect(() => {
    setTelegramClosingConfirmation(submitting);
    return () => setTelegramClosingConfirmation(false);
  }, [submitting]);

  useEffect(() => {
    let cancelled = false;
    async function loadCandles() {
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const pair = `${encodeURIComponent(selectedAsset)}-XLM`;
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
  }, [config.apiBaseUrl, selectedAsset]);

  useEffect(() => {
    if (!toAsset.trim() || !amount.trim()) {
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
    }, 380);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config.apiBaseUrl, fromAsset, toAsset, amount, activeAccount]);

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
          humanSummary: `SDEX ${limitSide.toUpperCase()} ${limitAmount} ${toAsset} @ ${limitPrice} XLM`,
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
      <ChartCanvas mode={mode} candles={candles} depth={[]} quoteLabel="XLM" />

      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>5-Way Smart Router Swap</strong>
          <span className="glass-pill">
            {activeAccount?.kind === "smart" ? "Smart C... (Soroban)" : "Classic G... (Full SDEX+AMM)"}
          </span>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <input
            type="text"
            className="ad-input"
            value={fromAsset}
            onChange={(e) => setFromAsset(e.target.value)}
            placeholder="From asset (XLM or CODE:G... or C...)"
          />
          <input
            type="text"
            className="ad-input"
            value={toAsset}
            onChange={(e) => setToAsset(e.target.value)}
            placeholder="To asset (CODE:G... or C...)"
          />
          <input
            type="text"
            className="ad-input tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
          />
        </div>

        <div className="ad-quote-slot">
          {quoting ? (
            <div className="ad-banner">Racing 5 liquidity venues in parallel...</div>
          ) : quote?.blockedReason ? (
            <div className="ad-banner ad-banner--danger">{quote.blockedReason}</div>
          ) : quote?.bestRoute ? (
            <div className="ad-banner">
              <strong>Best Route ({quote.bestRoute.venue}):</strong>{" "}
              <span className="tabular-nums">
                {quote.bestRoute.expectedOutputAmount} {quote.bestRoute.toAsset}
              </span>{" "}
              (Min {quote.bestRoute.minOutputAmount})
            </div>
          ) : (
            <div className="ad-banner">Enter pair &amp; amount for live 5-Way routing quote.</div>
          )}
        </div>

        {errorMsg && <div className="ad-banner ad-banner--danger">{errorMsg}</div>}
        {statusMsg && <div className="ad-banner">{statusMsg}</div>}

        <button
          type="button"
          className="ad-btn-primary"
          disabled={submitting || Boolean(quote?.blockedReason) || !quote?.bestRoute}
          onClick={() => {
            if (quote?.bestRoute?.unsignedXdr && sessionToken && activeAccount) {
              // Handoff unsignedXdr directly
            } else {
              setStatusMsg(
                "Route quoted cleanly. Connect AstroWallet and build unsigned swap XDR to authorize.",
              );
            }
          }}
        >
          Sign Swap in AstroWallet
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
