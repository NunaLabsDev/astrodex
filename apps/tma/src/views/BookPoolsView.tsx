import type { OrderbookSnapshot } from "@astrodex/domain";
import { useEffect, useMemo, useState } from "react";
import { TokenSearchInput } from "../components/TokenSearchInput.js";
import { useAppState } from "../state/app-context.js";

interface AmmPairInfo {
  venue: "soroswap" | "astrogate_curve";
  pairId?: string;
  reserveBase: string;
  reserveQuote: string;
  spotPriceQuotePerBase: number;
}

export function BookPoolsView() {
  const { config, mode, catalog, selectedAsset, defaultPairAsset, setSelectedAsset, setActiveTab } =
    useAppState();
  const [snapshot, setSnapshot] = useState<OrderbookSnapshot | null>(null);
  const [ammPair, setAmmPair] = useState<AmmPairInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [pairQuery, setPairQuery] = useState("");

  const effectiveAsset =
    selectedAsset && selectedAsset !== "XLM" ? selectedAsset : defaultPairAsset;

  const selectedToken = useMemo(
    () => catalog.find((item) => item.assetKey === effectiveAsset),
    [catalog, effectiveAsset],
  );

  const quickChips = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const item of catalog) {
      if (item.assetKey === "XLM") continue;
      const code = item.code.toUpperCase();
      if (seen.has(code)) continue;
      seen.add(code);
      out.push(item);
      if (out.length >= 6) break;
    }
    return out;
  }, [catalog]);

  useEffect(() => {
    if (!effectiveAsset || effectiveAsset === "XLM") return;
    let cancelled = false;
    async function loadBook() {
      setLoading(true);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const pair = `${encodeURIComponent(effectiveAsset)}-XLM`;
        const res = await fetch(`${base}/v1/orderbook/${pair}`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          snapshot?: OrderbookSnapshot;
          ammPair?: AmmPairInfo | null;
        };
        if (!cancelled) {
          setSnapshot(json.snapshot ?? null);
          setAmmPair(json.ammPair ?? null);
        }
      } catch {
        // Ignore offline errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadBook();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, effectiveAsset]);

  const poolVenues = useMemo(
    () => [
      {
        name: "Soroswap AMM",
        status:
          ammPair?.venue === "soroswap"
            ? `Live Reserves: ${ammPair.reserveBase} ${selectedToken?.code ?? "TOK"} / ${ammPair.reserveQuote} XLM`
            : selectedToken?.ammVenue === "soroswap"
              ? "Primary Pool"
              : "Active Router",
        fee: "0.30%",
      },
      {
        name: "Classic SDEX + CAP-38",
        status:
          snapshot && snapshot.bids.some((b) => b.venue === "sdex")
            ? "Live Classic Orderbook Depth"
            : "Orderbook / Path Payment",
        fee: "0.00%–0.30%",
      },
      {
        name: "AstroGate Curve / Community AMMs",
        status:
          ammPair?.venue === "astrogate_curve"
            ? `Live Curve Vault: ${ammPair.reserveQuote} XLM`
            : selectedToken?.ammVenue === "aquarius" || selectedToken?.ammVenue === "phoenix"
              ? "Listed Community Venue"
              : "Aggregated",
        fee: "Dynamic",
      },
    ],
    [ammPair, selectedToken, snapshot],
  );

  const isSyntheticAmm =
    Boolean(snapshot?.bids.some((b) => b.venue === "amm_synthetic")) ||
    Boolean(snapshot?.asks.some((a) => a.venue === "amm_synthetic"));

  return (
    <div className="ad-stack-12">
      <section className="glass-card ad-stack-10">
        <TokenSearchInput
          query={pairQuery}
          onQueryChange={setPairQuery}
          placeholder="Switch Book pair by name/ticker (ASTRO, USDC, STELA)..."
          primaryActionLabel="View Book"
          onSelectToken={(item) => {
            if (item.assetKey !== "XLM") {
              setSelectedAsset(item.assetKey);
            }
            setPairQuery("");
          }}
        />

        {quickChips.length > 0 && (
          <div className="ad-chip-row">
            {quickChips.map((chip) => (
              <button
                key={chip.assetKey}
                type="button"
                className={`glass-pill ad-clickable ${effectiveAsset === chip.assetKey ? "glass-pill--gold" : ""}`}
                onClick={() => setSelectedAsset(chip.assetKey)}
              >
                {chip.code} / XLM
              </button>
            ))}
          </div>
        )}

        <div className="ad-row">
          <strong className="ad-text-lg">
            AMM Pools &amp; Venues ({selectedToken?.code ?? effectiveAsset})
          </strong>
          <button
            type="button"
            className="ad-btn-secondary"
            onClick={() => {
              setSelectedAsset(effectiveAsset);
              setActiveTab("trade");
            }}
          >
            Trade Pair
          </button>
        </div>

        {ammPair && (
          <div className="ad-banner ad-stack-4 tabular-nums">
            <div className="ad-row">
              <strong>Live Spot Price:</strong>
              <span className="ad-text-gold ad-font-bold">
                1 {selectedToken?.code ?? "TOK"} ={" "}
                {ammPair.spotPriceQuotePerBase < 0.01
                  ? ammPair.spotPriceQuotePerBase.toFixed(6)
                  : ammPair.spotPriceQuotePerBase.toFixed(4)}{" "}
                XLM
              </span>
            </div>
            <div className="ad-text-xs ad-text-muted">
              Pool Liquidity: {ammPair.reserveBase} {selectedToken?.code ?? "TOK"} · {ammPair.reserveQuote} XLM
              {mode === "pro" && ammPair.pairId
                ? ` · Pair ${ammPair.pairId.slice(0, 6)}…${ammPair.pairId.slice(-4)}`
                : ""}
            </div>
          </div>
        )}

        <div className="ad-stack-8">
          {poolVenues.map((v) => (
            <div key={v.name} className="ad-row ad-item-card">
              <div>
                <div className="ad-text-md ad-font-bold">{v.name}</div>
                <div className="ad-text-xs ad-text-muted">{v.status}</div>
              </div>
              <span className="glass-pill tabular-nums">Fee {v.fee}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card ad-orderbook-stage">
        <div className="ad-row">
          <strong className="ad-text-lg">
            {isSyntheticAmm ? "Live AMM Depth" : "Classic SDEX Orderbook"} ({selectedToken?.code ?? effectiveAsset} / XLM)
          </strong>
          <span className="glass-pill tabular-nums">
            Spread: {snapshot?.spreadPct ?? "N/A"}%
          </span>
        </div>

        {loading ? (
          <div className="ad-banner">Loading live orderbook &amp; Soroban pool reserves...</div>
        ) : !snapshot || (snapshot.asks.length === 0 && snapshot.bids.length === 0) ? (
          <div className="ad-banner">
            No resting Classic SDEX or AMM pool depth found for {selectedToken?.code ?? effectiveAsset} / XLM.
          </div>
        ) : (
          <div className="ad-stack-6 ad-text-sm tabular-nums">
            <div className="ad-row ad-text-xxs ad-text-muted">
              <span>PRICE (XLM)</span>
              <span>AMOUNT ({selectedToken?.code ?? "TOK"}) · TOTAL (XLM)</span>
            </div>
            {[...snapshot.asks].slice(0, 8).reverse().map((a, idx) => (
              <div key={`ask-${idx}`} className="ad-row ad-book-ask">
                <span>ASK {Number(a.price).toFixed(5)}</span>
                <span>
                  {a.amount} ({a.totalQuote})
                </span>
              </div>
            ))}
            <div className="ad-divider" />
            {snapshot.bids.slice(0, 8).map((b, idx) => (
              <div key={`bid-${idx}`} className="ad-row ad-book-bid">
                <span>BID {Number(b.price).toFixed(5)}</span>
                <span>
                  {b.amount} ({b.totalQuote})
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
