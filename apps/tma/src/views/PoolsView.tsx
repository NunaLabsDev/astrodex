import { useEffect, useState } from "react";
import { useAppState } from "../state/app-context.js";

interface TopPoolItem {
  poolId: string;
  poolType: string;
  feePct: number;
  tokenA: { assetKey: string; code: string; reserve: string };
  tokenB: { assetKey: string; code: string; reserve: string };
  tvlUsd: number;
  volume24hUsd: number;
  feeApyPct: number;
  rewardsApyPct: number;
  totalApyPct: number;
}

type PoolSort = "volume" | "liquidity" | "apy";

function formatCompactUsd(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return "--";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function poolTypeBadge(raw: string): string {
  if (raw === "concentrated") return "Concentrated";
  if (raw === "stable") return "Stable";
  return "Constant";
}

export function PoolsView() {
  const { config, feedNetwork, openTradePair } = useAppState();
  const [sort, setSort] = useState<PoolSort>("volume");
  const [query, setQuery] = useState("");
  const [pools, setPools] = useState<TopPoolItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const qs = new URLSearchParams({
          net: feedNetwork,
          sort,
          ...(query.trim() ? { q: query.trim() } : {}),
        });
        const res = await fetch(`${base}/v1/pools/top?${qs.toString()}`);
        if (!res.ok) return;
        const json = (await res.json()) as { pools?: TopPoolItem[] };
        if (!cancelled) {
          setPools(json.pools ?? []);
        }
      } catch {
        // ignore transient network failure
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 240 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config.apiBaseUrl, feedNetwork, query, sort]);

  return (
    <div className="ad-stack-12">
      <section className="glass-card ad-stack-10">
        <div className="ad-row">
          <div>
            <div className="ad-text-sm ad-text-muted">
              {feedNetwork === "mainnet" ? "Aquarius AMM & Rewards" : "Stellar Testnet Pools"}
            </div>
            <h2 className="ad-heading-sm">Liquidity Pools &amp; APY</h2>
          </div>
          <span className="glass-pill tabular-nums">
            {loading ? "Sync..." : `${pools.length} pools`}
          </span>
        </div>

        <input
          type="text"
          className="ad-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter pools: XLM, USDC, AQUA, SHX, VELO..."
          aria-label="Filter pools"
        />

        <div className="ad-grid-3">
          {(
            [
              { id: "volume", label: "🔥 Volume" },
              { id: "liquidity", label: "💧 TVL" },
              { id: "apy", label: "✨ APY" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              className={`glass-pill ad-clickable ${sort === s.id ? "glass-pill--gold" : ""}`}
              style={{ justifyContent: "center" }}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {loading && pools.length === 0 ? (
          <div className="ad-banner">Loading live pools from Aquarius &amp; Horizon...</div>
        ) : pools.length === 0 ? (
          <div className="ad-banner">No matching liquidity pools found for &quot;{query}&quot;.</div>
        ) : (
          <div className="ad-stack-8">
            {pools.map((pool) => (
              <div key={pool.poolId} className="ad-item-card ad-stack-6">
                <div className="ad-row" style={{ alignItems: "center" }}>
                  <div className="ad-min-w-0">
                    <div className="ad-font-bold ad-text-base ad-flex-wrap" style={{ alignItems: "center" }}>
                      <span>
                        {pool.tokenA.code} / {pool.tokenB.code}
                      </span>
                      <span className="glass-pill" style={{ fontSize: 10, padding: "1px 6px" }}>
                        {poolTypeBadge(pool.poolType)} · {pool.feePct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ad-btn-secondary ad-btn-sm ad-no-shrink"
                    onClick={() => openTradePair(pool.tokenA.assetKey, pool.tokenB.assetKey)}
                  >
                    Swap
                  </button>
                </div>

                <div className="ad-grid-3 ad-text-xs tabular-nums">
                  <div className="ad-subcard">
                    <div className="ad-text-muted">TVL</div>
                    <div className="ad-font-bold">{formatCompactUsd(pool.tvlUsd)}</div>
                  </div>
                  <div className="ad-subcard">
                    <div className="ad-text-muted">24h Vol</div>
                    <div className="ad-font-bold">{formatCompactUsd(pool.volume24hUsd)}</div>
                  </div>
                  <div className="ad-subcard">
                    <div className="ad-text-muted">Total APY</div>
                    <div className="ad-font-bold ad-text-safe">
                      {pool.totalApyPct > 0 ? `${pool.totalApyPct.toFixed(1)}%` : "--"}
                      {pool.rewardsApyPct > 0 && (
                        <span className="ad-text-gold" style={{ marginLeft: 4, fontSize: 10 }}>
                          +{pool.rewardsApyPct.toFixed(1)}% AQUA
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
