import type { CatalogTokenItem } from "@astrodex/domain";
import { buildAstroDexDeepLink } from "@astrodex/tg-protocol";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TokenSearchInput } from "../components/TokenSearchInput.js";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink, triggerTelegramHaptic } from "../telegram/webapp.js";

type CatalogFilter = "all" | "movers" | "defi" | "rwa" | "community" | "launchpad";
type CatalogSort = "rank" | "change24h" | "volume7d" | "holders";

const DEFI_CODES = new Set([
  "AQUA",
  "KALE",
  "SSLX",
  "VELO",
  "XRF",
  "ASTRO",
  "YBX",
  "LSP",
  "HITZ",
  "BLND",
  "PHO",
  "SCOP",
  "SHX",
]);
const COMMUNITY_CODES = new Set(["ACT", "SSLX", "XTAR", "MIXT", "LMT", "KALE", "ASTRO"]);
const RWA_CODES = new Set([
  "USDC",
  "EURC",
  "CETES",
  "USTRY",
  "USDY",
  "USDGLO",
  "USDT0",
  "SUSDE",
  "YXLM",
  "YUSDC",
  "YBTC",
  "GBPX",
  "EURX",
  "NGNC",
  "OUSD",
  "DEJTRSY",
  "HYB",
]);

function formatUsdPrice(val?: number): string {
  if (!val || !Number.isFinite(val) || val <= 0) return "--";
  if (val < 0.0001) return `$${val.toFixed(6)}`;
  if (val < 0.01) return `$${val.toFixed(5)}`;
  if (val < 1) return `$${val.toFixed(4)}`;
  if (val < 1000) return `$${val.toFixed(2)}`;
  return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatCompactUsd(val?: number): string {
  if (!val || !Number.isFinite(val) || val <= 0) return "--";
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatCompactCount(val?: number): string {
  if (!val || !Number.isFinite(val) || val <= 0) return "--";
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}

function Sparkline({ points, positive }: { points?: number[] | undefined; positive: boolean }) {
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 62;
  const h = 22;
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - 2 - ((p - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline
        fill="none"
        stroke={positive ? "#10B981" : "#F15A24"}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords}
      />
    </svg>
  );
}
type AmmVenueChoice = "soroswap" | "aquarius" | "phoenix" | "sdex_pool" | "astrogate_curve";

function reviewBadge(token: CatalogTokenItem) {
  if (token.reviewStatus === "official") {
    return <span className="glass-pill glass-pill--safe">Official</span>;
  }
  if (token.reviewStatus === "verified") {
    return <span className="glass-pill glass-pill--gold">Verified</span>;
  }
  return <span className="glass-pill glass-pill--warn">⚠️ Unreviewed</span>;
}

function venueLabel(venue?: string): string {
  switch (venue) {
    case "soroswap":
      return "Soroswap AMM";
    case "astrogate_curve":
      return "AstroGate Curve";
    case "sdex_pool":
      return "Classic SDEX";
    case "aquarius":
      return "Aquarius AMM";
    case "phoenix":
      return "Phoenix DEX";
    default:
      return "Stellar Ledger";
  }
}

function shortKey(key: string): string {
  if (key.length <= 16) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function catalogRank(item: CatalogTokenItem): number {
  const code = item.code.toUpperCase();
  if (code === "USDC" && item.reviewStatus === "official") return 100;
  if (item.assetKey === "XLM") return 96;
  if (code === "AQUA" || code === "KALE" || code === "CETES" || code === "USDY" || code === "USTRY") return 92;
  if (code === "YXLM" || code === "YUSDC" || code === "EURC" || code === "USDT0" || code === "USDGLO") return 90;
  if (code === "XRP" || code === "BTCLN" || code === "SSLX" || code === "VELO" || code === "XRF" || code === "YBTC") return 86;
  if (code === "ASTRO") return 85;
  if (code === "HEY" || code === "DOGEE" || code === "STELA") return 80;
  if (item.reviewStatus === "verified") return 70;
  if (item.reviewStatus === "official") return 50;
  return 20;
}

export function RadarView() {
  const {
    config,
    feedNetwork,
    executionDisabled,
    catalog,
    xlmUsd,
    launchpadTokens,
    catalogLoading,
    refreshCatalog,
    setSelectedAsset,
    setActiveTab,
  } = useAppState();

  const [query, setQuery] = useState("");
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [sortBy, setSortBy] = useState<CatalogSort>("rank");
  const [showListForm, setShowListForm] = useState(false);

  // Instant self-serve listing state
  const [listAssetId, setListAssetId] = useState("");
  const [listSuggestions, setListSuggestions] = useState<CatalogTokenItem[]>([]);
  const [listVenue, setListVenue] = useState<AmmVenueChoice>("soroswap");
  const [listPairId, setListPairId] = useState("");
  const [listCommunityUrl, setListCommunityUrl] = useState("");
  const [listingBusy, setListingBusy] = useState(false);
  const [listingResult, setListingResult] = useState<{
    ok: boolean;
    message: string;
    assetKey?: string | undefined;
    warning?: boolean | undefined;
  } | null>(null);

  const handleOpenAsset = (assetId: string, tab: "trade" | "scanner" | "book") => {
    setSearchHint(null);
    setSelectedAsset(assetId.trim());
    setActiveTab(tab);
  };

  useEffect(() => {
    const q = listAssetId.trim();
    if (!showListForm || q.length < 2 || /^(?:XLM|[GC][A-Z2-7]{55}|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/i.test(q)) {
      setListSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/markets/search?q=${encodeURIComponent(q)}&limit=5`);
        if (!res.ok) return;
        const json = (await res.json()) as { results?: CatalogTokenItem[] };
        if (!cancelled && Array.isArray(json.results)) {
          setListSuggestions(json.results);
        }
      } catch {
        // Ignore transient search errors
      }
    }, 260);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config.apiBaseUrl, listAssetId, showListForm]);

  const handleSubmitListing = async (e: FormEvent) => {
    e.preventDefault();
    if (!listAssetId.trim()) return;
    setListingBusy(true);
    setListingResult(null);
    try {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/v1/markets/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: listAssetId.trim(),
          ammVenue: listVenue,
          pairId: listPairId.trim() || undefined,
          communityUrl: listCommunityUrl.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        reviewStatus?: string;
        reviewNote?: string;
        token?: { assetKey?: string; code?: string };
      };
      if (!res.ok || !json.ok) {
        triggerTelegramHaptic("error");
        setListingResult({
          ok: false,
          message: json.error ?? "Listing blocked or invalid asset.",
        });
        return;
      }
      triggerTelegramHaptic("success");
      await refreshCatalog();
      setListingResult({
        ok: true,
        warning: json.reviewStatus === "unreviewed_warning",
        assetKey: json.token?.assetKey,
        message:
          json.reviewStatus === "unreviewed_warning"
            ? `Published with warning: ${json.reviewNote ?? "Pending full review."}`
            : `Verified & published: ${json.token?.code ?? "Token"} is now live!`,
      });
      setListAssetId("");
      setListPairId("");
      setListCommunityUrl("");
      setListSuggestions([]);
    } catch (err) {
      triggerTelegramHaptic("error");
      setListingResult({
        ok: false,
        message: err instanceof Error ? err.message : "Network error while listing token.",
      });
    } finally {
      setListingBusy(false);
    }
  };

  const quickChips = useMemo(() => {
    const seenCodes = new Set<string>();
    const prioritized = [...catalog].sort((a, b) => {
      const diff = catalogRank(b) - catalogRank(a);
      if (diff !== 0) return diff;
      return b.shieldScore - a.shieldScore;
    });
    const out: CatalogTokenItem[] = [];
    for (const item of prioritized) {
      if (item.assetKey === "XLM") continue;
      const codeKey = item.code.toUpperCase();
      if (seenCodes.has(codeKey)) continue;
      seenCodes.add(codeKey);
      out.push(item);
      if (out.length >= 7) break;
    }
    return out;
  }, [catalog]);

  const defiCount = useMemo(
    () =>
      catalog.filter(
        (item) =>
          DEFI_CODES.has(item.code.toUpperCase()) ||
          item.ammVenue === "soroswap" ||
          item.ammVenue === "aquarius",
      ).length,
    [catalog],
  );
  const rwaCount = useMemo(
    () => catalog.filter((item) => RWA_CODES.has(item.code.toUpperCase())).length,
    [catalog],
  );
  const moversCount = useMemo(
    () => catalog.filter((item) => typeof item.change24hPct === "number" && item.change24hPct !== 0).length,
    [catalog],
  );
  const topMovers = useMemo(
    () =>
      [...catalog]
        .filter((item) => typeof item.change24hPct === "number" && Number.isFinite(item.change24hPct))
        .sort((a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0))
        .slice(0, 6),
    [catalog],
  );
  const communityCount = useMemo(
    () =>
      catalog.filter(
        (item) => COMMUNITY_CODES.has(item.code.toUpperCase()) || item.reviewStatus !== "official",
      ).length,
    [catalog],
  );

  const filteredCatalog = useMemo(() => {
    const rawQ = query.trim().toLowerCase();
    const q = rawQ.includes("/") ? (rawQ.split("/")[0]?.trim() ?? rawQ) : rawQ;
    return catalog
      .filter((item) => {
        const codeUp = item.code.toUpperCase();
        if (filter === "movers" && typeof item.change24hPct !== "number") return false;
        if (
          filter === "defi" &&
          !DEFI_CODES.has(codeUp) &&
          item.ammVenue !== "soroswap" &&
          item.ammVenue !== "aquarius"
        ) {
          return false;
        }
        if (filter === "rwa" && !RWA_CODES.has(codeUp)) return false;
        if (filter === "community" && !COMMUNITY_CODES.has(codeUp) && item.reviewStatus === "official") {
          return false;
        }
        if (
          q &&
          !item.code.toLowerCase().includes(q) &&
          !(item.name ?? "").toLowerCase().includes(q) &&
          !item.assetKey.toLowerCase().includes(q) &&
          !(item.issuer ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (filter === "movers" || sortBy === "change24h") {
          return (b.change24hPct ?? -9999) - (a.change24hPct ?? -9999);
        }
        if (sortBy === "volume7d") {
          return (b.volume7dUsd ?? 0) - (a.volume7dUsd ?? 0);
        }
        if (sortBy === "holders") {
          return (b.holdersCount ?? 0) - (a.holdersCount ?? 0);
        }
        const diff = catalogRank(b) - catalogRank(a);
        if (diff !== 0) return diff;
        return (b.holdersCount ?? b.shieldScore) - (a.holdersCount ?? a.shieldScore);
      });
  }, [catalog, filter, query, sortBy]);

  return (
    <div className="ad-stack-12">
      <section className="glass-card ad-stack-10">
        <div className="ad-row">
          <div>
            <div className="ad-text-sm ad-text-muted">
              Live {feedNetwork.toUpperCase()} Market Radar
            </div>
            <h2 className="ad-heading-sm">
              XLM:{" "}
              <span className="tabular-nums ad-text-gold">
                {xlmUsd && xlmUsd > 0 ? `$${xlmUsd.toFixed(4)}` : "Live Feed"}
              </span>
            </h2>
          </div>
          <div className="ad-flex-6">
            <button
              type="button"
              className="ad-btn-secondary"
              onClick={() => void refreshCatalog()}
              disabled={catalogLoading}
            >
              {catalogLoading ? "Sync..." : "↻ Sync"}
            </button>
            {!executionDisabled && (
              <button
                type="button"
                className="ad-btn-secondary"
                onClick={() => setShowListForm((prev) => !prev)}
              >
                {showListForm ? "Close" : "+ List"}
              </button>
            )}
          </div>
        </div>

        <TokenSearchInput
          query={query}
          onQueryChange={(val) => {
            setQuery(val);
            setSearchHint(null);
          }}
          placeholder={
            feedNetwork === "mainnet"
              ? "Search Mainnet token or pair (AQUA/XLM, KALE, CETES, USDC) or CODE:G..."
              : "Search Testnet token or pair (ASTRO/XLM, USDC, STELA) or CODE:G..."
          }
          submitLabel="Scan"
          primaryActionLabel="Quote"
          secondaryActionLabel="Scan"
          onSelectToken={(item, action) =>
            handleOpenAsset(item.assetKey, action === "secondary" ? "scanner" : "trade")
          }
          onSubmitRaw={(raw, bestMatch) => {
            if (bestMatch) {
              handleOpenAsset(bestMatch.assetKey, "scanner");
              return;
            }
            if (/^(?:XLM|[GC][A-Z2-7]{55}|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/i.test(raw)) {
              handleOpenAsset(raw, "scanner");
              return;
            }
            setSearchHint(
              `Pick a matching token from the live suggestions below or paste a full CODE:G... / C... ID in "+ List".`,
            );
          }}
        />
        {searchHint && <div className="ad-banner ad-banner--warn">{searchHint}</div>}

        {quickChips.length > 0 && (
          <div className="ad-chip-row" aria-label="1-Tap Official Pairs">
            {quickChips.map((chip) => (
              <button
                key={chip.assetKey}
                type="button"
                className="glass-pill ad-clickable"
                onClick={() => handleOpenAsset(chip.assetKey, "trade")}
              >
                <span>XLM / {chip.code}</span>
                {chip.reviewStatus === "unreviewed_warning" && <span>⚠️</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {showListForm && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-base">Instant Token &amp; AMM Listing</strong>
            <span className="glass-pill">Auto-Shield</span>
          </div>
          <div className="ad-text-sm ad-text-muted">
            Search by ticker or paste any Stellar asset ID (<code>CODE:G...</code> or <code>C...</code>) to publish instantly.
          </div>
          <form onSubmit={(e) => void handleSubmitListing(e)} className="ad-stack-8">
            <input
              type="text"
              className="ad-input"
              placeholder="Search ticker (ASTRO, USDC) or paste CODE:G... / C..."
              value={listAssetId}
              onChange={(e) => setListAssetId(e.target.value)}
              required
            />
            {listSuggestions.length > 0 && (
              <div className="ad-stack-4">
                {listSuggestions.map((item) => (
                  <button
                    key={`suggest-${item.assetKey}`}
                    type="button"
                    className="ad-row ad-suggest-btn"
                    onClick={() => {
                      setListAssetId(item.assetKey);
                      if (item.pairId) setListPairId(item.pairId);
                      setListSuggestions([]);
                    }}
                  >
                    <span className="ad-text-sm ad-font-bold">
                      ${item.code} {item.name ? `· ${item.name}` : ""}
                    </span>
                    <span className="ad-text-xs ad-text-muted">{shortKey(item.assetKey)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="ad-grid-2">
              <select
                className="ad-input"
                value={listVenue}
                onChange={(e) => setListVenue(e.target.value as AmmVenueChoice)}
                aria-label="AMM Venue"
              >
                <option value="soroswap">Soroswap AMM</option>
                <option value="aquarius">Aquarius Pool</option>
                <option value="phoenix">Phoenix DEX</option>
                <option value="sdex_pool">Classic SDEX / CAP-38</option>
                <option value="astrogate_curve">AstroGate Curve</option>
              </select>
              <input
                type="text"
                className="ad-input"
                placeholder="Pool C... (optional)"
                value={listPairId}
                onChange={(e) => setListPairId(e.target.value)}
              />
            </div>
            <input
              type="text"
              className="ad-input"
              placeholder="Telegram group or @handle (optional)"
              value={listCommunityUrl}
              onChange={(e) => setListCommunityUrl(e.target.value)}
            />
            <button type="submit" className="ad-btn-primary" disabled={listingBusy}>
              {listingBusy ? "Running Astro Shield..." : "Publish Token & AMM Now"}
            </button>
          </form>

          {listingResult && (
            <div
              className={`ad-banner ad-stack-6 ${
                !listingResult.ok
                  ? "ad-banner--danger"
                  : listingResult.warning
                    ? "ad-banner--warn"
                    : ""
              }`}
            >
              <div>{listingResult.message}</div>
              {listingResult.ok && listingResult.assetKey && (
                <div className="ad-flex-8">
                  <button
                    type="button"
                    className="ad-btn-secondary"
                    onClick={() => handleOpenAsset(listingResult.assetKey!, "trade")}
                  >
                    Trade Now
                  </button>
                  <button
                    type="button"
                    className="glass-pill ad-clickable"
                    onClick={() =>
                      openTelegramDeepLink(
                        buildAstroDexDeepLink({
                          tgBotUsername: config.tgBotUsername,
                          tgMiniAppShortName: config.tgMiniAppShortName,
                          startParam: `token_${listingResult.assetKey}`,
                        }),
                      )
                    }
                  >
                    Share Link
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="glass-card ad-stack-10">
        <div className="ad-row">
          <strong className="ad-text-base">Official, Community &amp; Launchpad</strong>
          <span className="glass-pill">{catalogLoading ? "Syncing..." : `${catalog.length} listed`}</span>
        </div>

        {topMovers.length > 0 && (
          <div className="ad-stack-4">
            <div className="ad-text-xs ad-text-muted">Top Movers (24h)</div>
            <div className="ad-chip-row" aria-label="Top Movers 24h">
              {topMovers.map((m) => {
                const pct = m.change24hPct ?? 0;
                return (
                  <button
                    key={`mover-${m.assetKey}`}
                    type="button"
                    className="glass-pill ad-clickable tabular-nums"
                    onClick={() => handleOpenAsset(m.assetKey, "trade")}
                  >
                    <strong>{m.code}</strong>{" "}
                    <span className={pct >= 0 ? "ad-text-safe" : "ad-text-danger"}>
                      {pct >= 0 ? "+" : ""}
                      {pct.toFixed(1)}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="ad-chip-row" role="tablist" aria-label="Token Category Filter">
          {(
            [
              { id: "all", label: `All (${catalog.length})` },
              { id: "movers", label: `Movers (${moversCount})` },
              { id: "defi", label: `DeFi (${defiCount})` },
              { id: "rwa", label: `Stables & RWA (${rwaCount})` },
              { id: "community", label: `Community (${communityCount})` },
              { id: "launchpad", label: `Launchpad (${launchpadTokens.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`glass-pill ad-clickable ${filter === tab.id ? "glass-pill--gold" : ""}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ad-chip-row" aria-label="Sort Tokens">
          {(
            [
              { id: "rank", label: "Rank" },
              { id: "change24h", label: "24h %" },
              { id: "volume7d", label: "7d Vol" },
              { id: "holders", label: "Holders" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              className={`glass-pill ad-clickable ${sortBy === s.id ? "glass-pill--safe" : ""}`}
              style={{ fontSize: 11, padding: "3px 9px" }}
              onClick={() => setSortBy(s.id)}
            >
              Sort: {s.label}
            </button>
          ))}
        </div>

        {filter === "launchpad" ? (
          launchpadTokens.length === 0 ? (
            <div className="ad-banner">
              {catalogLoading
                ? "Syncing AstroGate v4.5 Launchpad curves..."
                : "No active AstroGate v4.5 curves indexed right now."}
            </div>
          ) : (
            <div className="ad-stack-8">
              {launchpadTokens.slice(0, 12).map((item) => (
                <div key={item.id ?? item.symbol} className="ad-item-card">
                  <div className="ad-row">
                    <div className="ad-min-w-0">
                      <div className="ad-font-bold ad-text-base">
                        ${item.symbol ?? "TOKEN"} · {item.name ?? "Soroban Token"}
                      </div>
                      <div className="ad-text-xs ad-text-muted tabular-nums">
                        {item.graduated
                          ? `Graduated (Soroswap 7Y Lock) · Reserve ${item.reserveXlm ?? "0"} XLM`
                          : `Bonding Curve ${item.graduationPercent ?? 0}% -> 1,000 XLM · Reserve ${item.reserveXlm ?? "0"} XLM`}
                      </div>
                    </div>
                    {item.id && (
                      <div className="ad-flex-6 ad-no-shrink">
                        <button
                          type="button"
                          className="ad-btn-secondary ad-btn-sm"
                          onClick={() => handleOpenAsset(item.id!, "trade")}
                        >
                          Trade
                        </button>
                        <button
                          type="button"
                          className="glass-pill ad-clickable"
                          onClick={() => handleOpenAsset(item.id!, "book")}
                        >
                          Book
                        </button>
                        <button
                          type="button"
                          className="glass-pill ad-clickable"
                          onClick={() => handleOpenAsset(item.id!, "scanner")}
                        >
                          Scan
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : catalogLoading && catalog.length === 0 ? (
          <div className="ad-banner">Syncing live Stellar &amp; AstroGate markets...</div>
        ) : filteredCatalog.length === 0 ? (
          <div className="ad-banner">
            No matching tokens in the local catalog. Check the live network results above or click &quot;+ List&quot;.
          </div>
        ) : (
          <div className="ad-stack-8">
            {filteredCatalog.slice(0, 35).map((item, idx) => {
              const pct24 = item.change24hPct;
              const positive7d = (item.change7dPct ?? pct24 ?? 0) >= 0;
              return (
                <div
                  key={item.assetKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenAsset(item.assetKey, "trade")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpenAsset(item.assetKey, "trade");
                    }
                  }}
                  className={`ad-item-card ad-clickable ${item.reviewStatus === "unreviewed_warning" ? "ad-item-card--warn" : ""}`}
                >
                  <div className="ad-row" style={{ gap: 8, alignItems: "center" }}>
                    <div className="ad-min-w-0 ad-stack-3" style={{ flex: 1 }}>
                      <div className="ad-font-bold ad-text-base ad-flex-wrap" style={{ alignItems: "center" }}>
                        <span className="ad-text-xs ad-text-muted tabular-nums">#{idx + 1}</span>
                        <span>{item.code}</span>
                        {reviewBadge(item)}
                      </div>
                      <div className="ad-text-xs ad-text-muted">
                        {item.name ?? item.domain ?? venueLabel(item.ammVenue)}
                      </div>
                    </div>

                    <Sparkline points={item.sparkline7d} positive={positive7d} />

                    <div className="ad-text-right ad-no-shrink tabular-nums">
                      <div className="ad-font-bold ad-text-sm">
                        {formatUsdPrice(item.priceUsd)}
                      </div>
                      {typeof pct24 === "number" ? (
                        <span
                          className={`glass-pill ${pct24 >= 0 ? "glass-pill--safe" : "glass-pill--warn"}`}
                          style={{ fontSize: 10, padding: "1px 6px" }}
                        >
                          {pct24 >= 0 ? "+" : ""}
                          {pct24.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="ad-text-xxs ad-text-muted">Shield {item.shieldScore}</span>
                      )}
                    </div>
                  </div>

                  <div className="ad-row ad-text-xxs ad-text-muted tabular-nums" style={{ marginTop: 4 }}>
                    <span>
                      MCap {formatCompactUsd(item.marketCapUsd)} · 7d Vol {formatCompactUsd(item.volume7dUsd)}
                    </span>
                    <span>
                      {item.holdersCount
                        ? `${formatCompactCount(item.holdersCount)} holders`
                        : shortKey(item.assetKey)}
                    </span>
                  </div>

                  {item.reviewStatus === "unreviewed_warning" && item.reviewNote && (
                    <div className="ad-text-xs ad-text-warn">⚠️ {item.reviewNote}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
