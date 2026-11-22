import { useEffect, useState } from "react";
import { useAppState } from "../state/app-context.js";

export function OrdersAlertsView() {
  const { config, sessionToken, activeAccount } = useAppState();
  const [watchlist, setWatchlist] = useState<string[]>([]);

  useEffect(() => {
    if (!sessionToken) return undefined;
    let cancelled = false;
    async function loadWatchlist() {
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/watchlists`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: string[] };
        if (!cancelled && json.items) setWatchlist(json.items);
      } catch {
        // Ignore
      }
    }
    void loadWatchlist();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, sessionToken]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>Open Orders &amp; Price Alerts</strong>
          <span className="glass-pill">
            {activeAccount ? activeAccount.kind.toUpperCase() : "READ-ONLY"}
          </span>
        </div>

        <div className="ad-banner">
          {activeAccount
            ? `Monitoring active ${activeAccount.kind === "classic" ? "Classic SDEX offers" : "Soroban positions"} for ${activeAccount.address}.`
            : "Connect your AstroWallet (AstroID) to manage Classic SDEX limit offers and alerts."}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700 }}>Watchlist ({watchlist.length})</div>
        {watchlist.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ad-ink-secondary)" }}>
            No watchlisted tokens yet.
          </div>
        ) : (
          watchlist.map((item) => (
            <div key={item} className="ad-banner">
              {item}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
