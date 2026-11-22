import type { OrderbookSnapshot } from "@astrodex/domain";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../state/app-context.js";

export function BookPoolsView() {
  const { config, catalog, selectedAsset, setSelectedAsset, setActiveTab } = useAppState();
  const [snapshot, setSnapshot] = useState<OrderbookSnapshot | null>(null);

  const selectedToken = useMemo(
    () => catalog.find((item) => item.assetKey === selectedAsset),
    [catalog, selectedAsset],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadBook() {
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const pair = `${encodeURIComponent(selectedAsset || "XLM")}-XLM`;
        const res = await fetch(`${base}/v1/orderbook/${pair}`);
        if (!res.ok) return;
        const json = (await res.json()) as { snapshot?: OrderbookSnapshot };
        if (!cancelled && json.snapshot) setSnapshot(json.snapshot);
      } catch {
        // Ignore offline errors
      }
    }
    void loadBook();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, selectedAsset]);

  const poolVenues = useMemo(
    () => [
      {
        name: "Soroswap AMM",
        status: selectedToken?.ammVenue === "soroswap" ? "Primary Pool" : "Active Router",
        fee: "0.30%",
      },
      {
        name: "Classic SDEX + CAP-38",
        status: snapshot && (snapshot.bids.length > 0 || snapshot.asks.length > 0) ? "Live Depth" : "Orderbook",
        fee: "0.00%–0.30%",
      },
      {
        name: "Aquarius & Phoenix",
        status:
          selectedToken?.ammVenue === "aquarius" || selectedToken?.ammVenue === "phoenix"
            ? "Listed Community Venue"
            : "Aggregated",
        fee: "Dynamic",
      },
    ],
    [selectedToken, snapshot],
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>
            AMM Pools &amp; Venues ({selectedToken?.code ?? selectedAsset})
          </strong>
          <button
            type="button"
            className="ad-btn-secondary"
            onClick={() => {
              setSelectedAsset(selectedAsset);
              setActiveTab("trade");
            }}
          >
            Trade Pair
          </button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {poolVenues.map((v) => (
            <div
              key={v.name}
              className="ad-row"
              style={{
                padding: "8px 12px",
                borderRadius: 12,
                background: "rgba(11, 20, 51, 0.65)",
                border: "1px solid rgba(165, 139, 224, 0.2)",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{v.name}</div>
                <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }}>{v.status}</div>
              </div>
              <span className="glass-pill tabular-nums">Fee {v.fee}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card ad-orderbook-stage">
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>
            Classic SDEX Orderbook ({selectedToken?.code ?? selectedAsset} / XLM)
          </strong>
          <span className="glass-pill tabular-nums">
            Spread: {snapshot?.spreadPct ?? "N/A"}%
          </span>
        </div>

        {!snapshot || (snapshot.asks.length === 0 && snapshot.bids.length === 0) ? (
          <div className="ad-banner">
            No resting Classic SDEX orderbook depth found for this asset against XLM.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6, fontSize: 12 }} className="tabular-nums">
            {snapshot.asks.slice(0, 8).map((a, idx) => (
              <div key={`ask-${idx}`} className="ad-row" style={{ color: "var(--ad-ask-coral)" }}>
                <span>ASK {a.price}</span>
                <span>{a.amount}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid rgba(165,139,224,0.25)", margin: "4px 0" }} />
            {snapshot.bids.slice(0, 8).map((b, idx) => (
              <div key={`bid-${idx}`} className="ad-row" style={{ color: "var(--ad-bid-emerald)" }}>
                <span>BID {b.price}</span>
                <span>{b.amount}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
