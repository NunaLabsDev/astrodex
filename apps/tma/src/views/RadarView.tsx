import { buildAstroGateDeepLink } from "@astrodex/tg-protocol";
import { useEffect, useState, type FormEvent } from "react";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink } from "../telegram/webapp.js";

interface MarketOverviewItem {
  id?: string;
  symbol?: string;
  name?: string;
  graduationPercent?: number;
  graduated?: boolean;
  reserveXlm?: string;
}

export function RadarView() {
  const { config, setSelectedAsset, setActiveTab } = useAppState();
  const [query, setQuery] = useState("");
  const [xlmUsd, setXlmUsd] = useState<number | null>(null);
  const [launchpadTokens, setLaunchpadTokens] = useState<MarketOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadOverview() {
      setLoading(true);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/markets/overview`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          xlmUsd?: { priceUsd?: number } | null;
          launchpadTokens?: MarketOverviewItem[];
        };
        if (!cancelled) {
          setXlmUsd(json.xlmUsd?.priceUsd ?? null);
          setLaunchpadTokens(json.launchpadTokens ?? []);
        }
      } catch {
        // Keep graceful offline fallback
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadOverview();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl]);

  const handleOpenAsset = (assetId: string, tab: "trade" | "scanner") => {
    setSelectedAsset(assetId.trim());
    setActiveTab(tab);
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    handleOpenAsset(query.trim(), "scanner");
  };

  const launchUrl = config.astroGateBotUsername
    ? buildAstroGateDeepLink({
        astroGateBotUsername: config.astroGateBotUsername,
        startParam: "launch",
      })
    : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <div>
            <div style={{ fontSize: 12, color: "var(--ad-ink-secondary)" }}>Market Radar</div>
            <h2 style={{ margin: "2px 0 0", fontSize: 18 }}>
              XLM Reference:{" "}
              <span className="tabular-nums" style={{ color: "var(--ad-stellar-gold)" }}>
                {xlmUsd ? `$${xlmUsd.toFixed(4)}` : "Live Feed"}
              </span>
            </h2>
          </div>
          {launchUrl && (
            <button
              type="button"
              className="ad-btn-secondary"
              onClick={() => openTelegramDeepLink(launchUrl)}
            >
              Launch on AstroGate
            </button>
          )}
        </div>

        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            className="ad-input"
            placeholder="Paste CODE:G... or Soroban C... contract"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Asset search input"
          />
          <button type="submit" className="ad-btn-primary">
            Scan
          </button>
        </form>
      </section>

      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 14 }}>AstroGate Fair-Flywheel v4.5 Radar</strong>
          <span className="glass-pill">{loading ? "Syncing..." : `${launchpadTokens.length} live`}</span>
        </div>

        {launchpadTokens.length === 0 ? (
          <div className="ad-banner">
            Select XLM or paste any Stellar Classic (`CODE:G...`) or Soroban (`C...`) token above to inspect liquidity and Astro Shield score.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {launchpadTokens.slice(0, 10).map((item) => (
              <div
                key={item.id ?? item.symbol}
                className="ad-row"
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  background: "rgba(11, 20, 51, 0.65)",
                  border: "1px solid rgba(165, 139, 224, 0.2)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    ${item.symbol ?? "TOKEN"} · {item.name ?? "Soroban Token"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }} className="tabular-nums">
                    {item.graduated
                      ? `Graduated (Soroswap 7Y Lock) · Reserve ${item.reserveXlm ?? "0"} XLM`
                      : `Bonding Curve ${item.graduationPercent ?? 0}% -> 1,000 XLM`}
                  </div>
                </div>
                {item.id && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="ad-btn-secondary"
                      onClick={() => handleOpenAsset(item.id!, "trade")}
                    >
                      Trade
                    </button>
                    <button
                      type="button"
                      className="glass-pill"
                      style={{ cursor: "pointer" }}
                      onClick={() => handleOpenAsset(item.id!, "scanner")}
                    >
                      Scan
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
