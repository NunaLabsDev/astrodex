import type { OrderbookSnapshot } from "@astrodex/domain";
import { useEffect, useState } from "react";
import { useAppState } from "../state/app-context.js";

export function BookPoolsView() {
  const { config, selectedAsset } = useAppState();
  const [snapshot, setSnapshot] = useState<OrderbookSnapshot | null>(null);

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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="glass-card ad-orderbook-stage">
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>Classic SDEX Orderbook ({selectedAsset} / XLM)</strong>
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
