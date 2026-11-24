import type { CatalogTokenItem } from "@astrodex/domain";
import { buildAstroDexDeepLink } from "@astrodex/tg-protocol";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MicroPrice } from "../components/MicroPrice.js";
import { TokenAvatar } from "../components/TokenAvatar.js";
import { TokenSearchInput } from "../components/TokenSearchInput.js";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink, triggerTelegramHaptic } from "../telegram/webapp.js";

type MarketFilter =
  | "all"
  | "favorites"
  | "ethena"
  | "stables"
  | "community"
  | "launchpad"
  | "gainers"
  | "losers"
  | "volume"
  | "official"
  | "rwa";

const RWA_CODES = new Set([
  "USDC",
  "EURC",
  "CETES",
  "USTRY",
  "USDY",
  "USDGLO",
  "USDT0",
  "USDE",
  "SUSDE",
  "PYUSD",
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

const ETHENA_CODES = new Set(["USDE", "SUSDE"]);
const OMNICHAIN_STABLE_CODES = new Set(["USDC", "USDT0", "USDE", "SUSDE", "EURC", "PYUSD"]);
const COMMUNITY_HUB_CODES = new Set(["LIBRE", "XLMNR", "SVR", "ACT", "SSLX", "XTAR", "MIXT", "LMT"]);

function formatUsdPrice(val?: number): string {
  if (!val || !Number.isFinite(val) || val <= 0) return "--";
  if (val < 0.0001) return `$${val.toFixed(6)}`;
  if (val < 0.01) return `$${val.toFixed(5)}`;
  if (val < 1) return `$${val.toFixed(4)}`;
  if (val < 1000) return `$${val.toFixed(2)}`;
  return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatXlmPrice(val?: number): string {
  if (!val || !Number.isFinite(val) || val <= 0) return "--";
  if (val < 0.0001) return `${val.toFixed(6)} XLM`;
  if (val < 0.01) return `${val.toFixed(5)} XLM`;
  if (val < 10) return `${val.toFixed(4)} XLM`;
  return `${val.toLocaleString("en-US", { maximumFractionDigits: 2 })} XLM`;
}

function formatCompactXlm(val?: number): string {
  if (!val || !Number.isFinite(val) || val <= 0) return "--";
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B XLM`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M XLM`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K XLM`;
  return `${val.toFixed(0)} XLM`;
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
  if (!points || points.length < 2) {
    return <span style={{ width: 52, height: 22, flexShrink: 0, opacity: 0.25 }} aria-hidden="true" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 52;
  const h = 22;
  const coords = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - 2 - ((p - min) / span) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = positive ? "#10B981" : "#F15A24";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={coords}
      />
    </svg>
  );
}

type AmmVenueChoice = "soroswap" | "aquarius" | "phoenix" | "sdex_pool";

function reviewBadge(token: CatalogTokenItem) {
  const isEthena = token.category === "ethena_yield" || ETHENA_CODES.has(token.code.toUpperCase());
  const isOft = token.category === "omnichain_stable" || token.code.toUpperCase() === "USDT0";
  if (isEthena) {
    return (
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <span className="glass-pill glass-pill--gold" style={{ fontSize: 10, padding: "1px 6px", color: "#0B1433", fontWeight: 700 }}>
          Ethena Yield
        </span>
      </span>
    );
  }
  if (isOft) {
    return (
      <span className="glass-pill" style={{ fontSize: 10, padding: "1px 6px", borderColor: "rgba(165, 139, 224, 0.55)", color: "#E9D5FF" }}>
        LayerZero OFT
      </span>
    );
  }
  if (token.reviewStatus === "official") {
    return <span className="glass-pill glass-pill--safe" style={{ fontSize: 10, padding: "1px 6px" }}>Official</span>;
  }
  if (token.reviewStatus === "verified") {
    return <span className="glass-pill glass-pill--gold" style={{ fontSize: 10, padding: "1px 6px" }}>Verified</span>;
  }
  return <span className="glass-pill glass-pill--warn" style={{ fontSize: 10, padding: "1px 6px" }}>⚠️</span>;
}

function venueLabel(venue?: string): string {
  switch (venue) {
    case "soroswap":
      return "Soroswap AMM";
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
  if (code === "USDE" || code === "SUSDE" || code === "USDT0") return 95;
  if (code === "AQUA" || code === "KALE" || code === "CETES" || code === "USDY" || code === "USTRY") return 92;
  if (code === "YXLM" || code === "YUSDC" || code === "EURC" || code === "PYUSD" || code === "USDGLO") return 90;
  if (code === "XRP" || code === "BTCLN" || code === "SSLX" || code === "VELO" || code === "XRF" || code === "YBTC") return 86;
  if (code === "ASTRO") return 85;
  if (code === "XLMNR" || code === "LIBRE" || code === "SVR" || code === "ACT") return 82;
  if (code === "HEY" || code === "DOGEE" || code === "STELA") return 80;
  if (item.reviewStatus === "verified") return 70;
  if (item.reviewStatus === "official") return 50;
  return 20;
}

const FILTER_CHIPS: Array<{ id: MarketFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ethena", label: "⚡ Ethena & Yield" },
  { id: "stables", label: "💵 Stables / OFT" },
  { id: "community", label: "🌐 Community Hub" },
  { id: "gainers", label: "🟢 Gainers" },
  { id: "losers", label: "🔴 Losers" },
  { id: "volume", label: "🔥 Volume" },
  { id: "official", label: "🛡️ Official" },
  { id: "rwa", label: "🏦 RWA" },
];

export function RadarView({ mode = "markets" }: { mode?: "markets" | "watchlist" }) {
  const {
    config,
    feedNetwork,
    sessionToken,
    catalog,
    catalogError,
    favorites,
    starredMeta,
    toggleFavorite,
    xlmUsd,
    catalogLoading,
    refreshCatalog,
    setSelectedAsset,
    setActiveTab,
    setTradeScrollTarget,
  } = useAppState();

  const [query, setQuery] = useState("");
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<MarketFilter>(
    mode === "watchlist" ? "favorites" : "all",
  );
  const [sortBy, setSortBy] = useState<"rank" | "price" | "change24h">("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [quoteUnit, setQuoteUnit] = useState<"usd" | "xlm">("usd");
  const showListForm = false;
  const [visibleLimit, setVisibleLimit] = useState(35);

  useEffect(() => {
    setActiveFilter(mode === "watchlist" ? "favorites" : "all");
  }, [mode]);

  const xlmItem = useMemo(() => catalog.find((c) => c.assetKey === "XLM"), [catalog]);
  const liveXlmUsd = xlmUsd && xlmUsd > 0 ? xlmUsd : (xlmItem?.priceUsd ?? null);
  const xlmChange24h = xlmItem?.change24hPct ?? 0;
  const xlmSpark = xlmItem?.sparkline7d;

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

  const handleOpenAsset = (assetId: string, scrollTo: "swap" | "safety" = "swap") => {
    setSearchHint(null);
    setSelectedAsset(assetId.trim());
    setTradeScrollTarget(scrollTo);
    setActiveTab("token");
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
        const res = await fetch(
          `${base}/v1/markets/search?q=${encodeURIComponent(q)}&limit=5&net=${encodeURIComponent(feedNetwork)}`,
        );
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
      const res = await fetch(`${base}/v1/markets/listings?net=${encodeURIComponent(feedNetwork)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
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

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const rankByAssetKey = useMemo(() => {
    const sorted = [...catalog].sort((a, b) => catalogRank(b) - catalogRank(a));
    const map = new Map<string, number>();
    sorted.forEach((item, idx) => map.set(item.assetKey, idx + 1));
    return map;
  }, [catalog]);

  const total7dVolUsd = useMemo(
    () => catalog.reduce((sum, item) => sum + (item.volume7dUsd ?? 0), 0),
    [catalog],
  );

  const filteredCatalog = useMemo(() => {
    const rawQ = query.trim().toLowerCase();
    const q = rawQ.includes("/") ? (rawQ.split("/")[0]?.trim() ?? rawQ) : rawQ;
    const basePool: CatalogTokenItem[] =
      activeFilter === "favorites"
        ? (() => {
            const byKey = new Map<string, CatalogTokenItem>();
            for (const item of catalog) {
              if (favSet.has(item.assetKey)) byKey.set(item.assetKey.toUpperCase(), item);
            }
            for (const key of favorites) {
              if (!byKey.has(key.toUpperCase())) {
                const cached = starredMeta[key];
                byKey.set(
                  key.toUpperCase(),
                  cached ?? {
                    assetKey: key,
                    kind: key.startsWith("C") ? "soroban" : "classic",
                    code: key.includes(":") ? key.split(":")[0]! : key.slice(0, 6),
                    decimals: 7,
                    shieldScore: 55,
                    reviewStatus: "unreviewed_warning",
                    ammVenue: key.startsWith("C") ? "soroswap" : "sdex_pool",
                  },
                );
              }
            }
            return Array.from(byKey.values());
          })()
        : catalog;

    return basePool
      .filter((item) => {
        const codeUp = item.code.toUpperCase();
        if (activeFilter === "favorites" && !favSet.has(item.assetKey)) return false;
        if (
          activeFilter === "ethena" &&
          item.category !== "ethena_yield" &&
          !ETHENA_CODES.has(codeUp)
        ) {
          return false;
        }
        if (
          activeFilter === "stables" &&
          item.category !== "omnichain_stable" &&
          item.category !== "ethena_yield" &&
          !OMNICHAIN_STABLE_CODES.has(codeUp)
        ) {
          return false;
        }
        if (
          activeFilter === "community" &&
          item.category !== "community_hub" &&
          !COMMUNITY_HUB_CODES.has(codeUp)
        ) {
          return false;
        }
        if (activeFilter === "official" && item.reviewStatus !== "official") return false;
        if (activeFilter === "rwa" && !RWA_CODES.has(codeUp)) return false;
        if (activeFilter === "gainers" && !(typeof item.change24hPct === "number" && item.change24hPct > 0)) {
          return false;
        }
        if (activeFilter === "losers" && !(typeof item.change24hPct === "number" && item.change24hPct < 0)) {
          return false;
        }
        if (activeFilter === "volume" && !(typeof item.volume7dUsd === "number" && item.volume7dUsd > 0)) {
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
        const aFav = favSet.has(a.assetKey) ? 1 : 0;
        const bFav = favSet.has(b.assetKey) ? 1 : 0;
        if (aFav !== bFav && activeFilter !== "favorites") return bFav - aFav;

        if (sortBy === "price") {
          const ap = typeof a.priceUsd === "number" && a.priceUsd > 0 ? a.priceUsd : null;
          const bp = typeof b.priceUsd === "number" && b.priceUsd > 0 ? b.priceUsd : null;
          if (ap === null && bp !== null) return 1;
          if (bp === null && ap !== null) return -1;
          if (ap !== null && bp !== null && ap !== bp) {
            return sortDir === "desc" ? bp - ap : ap - bp;
          }
        }
        if (sortBy === "change24h") {
          const ac = typeof a.change24hPct === "number" ? a.change24hPct : null;
          const bc = typeof b.change24hPct === "number" ? b.change24hPct : null;
          if (ac === null && bc !== null) return 1;
          if (bc === null && ac !== null) return -1;
          if (ac !== null && bc !== null && ac !== bc) {
            return sortDir === "desc" ? bc - ac : ac - bc;
          }
        }
        if (activeFilter === "gainers") {
          return (b.change24hPct ?? -9999) - (a.change24hPct ?? -9999);
        }
        if (activeFilter === "losers") {
          return (a.change24hPct ?? 9999) - (b.change24hPct ?? 9999);
        }
        if (activeFilter === "volume") {
          return (b.volume7dUsd ?? 0) - (a.volume7dUsd ?? 0);
        }
        const diff = catalogRank(b) - catalogRank(a);
        if (diff !== 0) return sortDir === "asc" && sortBy === "rank" ? -diff : diff;
        return (b.holdersCount ?? b.shieldScore) - (a.holdersCount ?? a.shieldScore);
      });
  }, [catalog, favSet, favorites, starredMeta, query, activeFilter, sortBy, sortDir]);

  return (
    <div className="ad-stack-12">
      <section className="glass-card ad-stack-10">
        <div className="ad-row ad-row-wrap">
          <div className="ad-flex-8 ad-min-w-0">
            <h2 className="ad-heading-sm" style={{ margin: 0 }}>
              {mode === "watchlist" ? "★ Starred Watchlist" : "Stellar Markets"}
            </h2>
            <span className="glass-pill tabular-nums">
              XLM {xlmUsd && xlmUsd > 0 ? `$${xlmUsd.toFixed(4)}` : "Live"}
            </span>
          </div>

          <div className="ad-flex-6">
            <div role="group" aria-label="Quote Unit" className="ad-mode-group">
              <button
                type="button"
                className={`glass-pill ad-mode-btn ${quoteUnit === "usd" ? "glass-pill--gold" : ""}`}
                onClick={() => setQuoteUnit("usd")}
              >
                $ USD
              </button>
              <button
                type="button"
                className={`glass-pill ad-mode-btn ${quoteUnit === "xlm" ? "glass-pill--gold" : ""}`}
                onClick={() => setQuoteUnit("xlm")}
              >
                ✦ XLM
              </button>
            </div>
            <button
              type="button"
              className="glass-pill ad-clickable ad-no-shrink"
              style={{ padding: "5px 10px" }}
              onClick={() => void refreshCatalog()}
              disabled={catalogLoading}
              aria-label="Refresh Markets"
              title="Refresh Markets"
            >
              {catalogLoading ? "Sync…" : "↻ Sync"}
            </button>
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
              ? "Search coin, ticker, or paste CODE:G... / C..."
              : "Search Testnet coin, ticker, or paste CODE:G... / C..."
          }
          onSelectToken={(item) => handleOpenAsset(item.assetKey, "swap")}
          onSubmitRaw={(raw, bestMatch) => {
            if (bestMatch) {
              handleOpenAsset(bestMatch.assetKey, "swap");
              return;
            }
            if (/^(?:XLM|[GC][A-Z2-7]{55}|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/i.test(raw)) {
              handleOpenAsset(raw, "swap");
              return;
            }
            setSearchHint(
              `Pick a matching coin from the suggestions or paste a full CODE:G... / C... ID.`,
            );
          }}
        />
        {searchHint && <div className="ad-banner ad-banner--warn">{searchHint}</div>}

        {mode === "markets" && (
          <div className="ad-chip-row" role="tablist" aria-label="Market Filters">
            <button
              type="button"
              role="tab"
              aria-selected={activeFilter === "favorites"}
              className={`glass-pill ad-clickable ${activeFilter === "favorites" ? "glass-pill--gold" : ""}`}
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => setActiveFilter("favorites")}
            >
              ★ Watchlist{favorites.length > 0 ? ` (${favorites.length})` : ""}
            </button>
            {FILTER_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={activeFilter === chip.id}
                className={`glass-pill ad-clickable ${activeFilter === chip.id ? "glass-pill--gold" : ""}`}
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setActiveFilter(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {catalog.length > 0 && mode === "markets" && (
          <div className="ad-row ad-text-xxs ad-text-muted tabular-nums" style={{ paddingTop: 2 }}>
            <span>Coins: {catalog.length}</span>
            <span>
              XLM {liveXlmUsd ? `$${liveXlmUsd.toFixed(4)}` : "—"}
              {xlmChange24h !== 0
                ? ` (${xlmChange24h >= 0 ? "+" : ""}${xlmChange24h.toFixed(2)}%)`
                : ""}
            </span>
            <span>7d Vol: {total7dVolUsd > 0 ? formatCompactUsd(total7dVolUsd) : "—"}</span>
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
                    onClick={() => handleOpenAsset(listingResult.assetKey!, "swap")}
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

      {query.trim().length === 0 && (
      <section className="glass-card ad-stack-8">
        {catalogError ? (
          <div className="ad-banner ad-banner--danger ad-row ad-row-wrap">
            <span>{catalogError}</span>
            <button
              type="button"
              className="ad-btn-secondary ad-btn-sm"
              onClick={() => void refreshCatalog()}
            >
              Retry
            </button>
          </div>
        ) : catalogLoading && catalog.length === 0 ? (
          <div className="ad-stack-6">
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="ad-row" style={{ gap: 10, padding: "8px 4px" }}>
                <div className="ad-shimmer" style={{ width: 34, height: 34, borderRadius: "999px" }} />
                <div style={{ flex: 1, display: "grid", gap: 6 }}>
                  <div className="ad-shimmer" style={{ height: 14, width: "45%" }} />
                  <div className="ad-shimmer" style={{ height: 10, width: "65%" }} />
                </div>
                <div className="ad-shimmer" style={{ width: 52, height: 22 }} />
                <div className="ad-shimmer" style={{ width: 64, height: 26 }} />
              </div>
            ))}
          </div>
        ) : filteredCatalog.length === 0 ? (
          <div className="ad-banner ad-stack-8">
            <div>
              {activeFilter === "favorites"
                ? "Your watchlist is empty. Tap ★ next to any coin to track it here."
                : "No matching coins found. Try another filter or search above."}
            </div>
            {mode === "watchlist" && (
              <button
                type="button"
                className="ad-btn-secondary ad-btn-sm"
                onClick={() => setActiveTab("radar")}
              >
                Explore Markets
              </button>
            )}
          </div>
        ) : (
          <div className="ad-stack-6">
            <div className="ad-table-head">
              <button
                type="button"
                className="ad-table-sort-btn"
                onClick={() => {
                  if (sortBy === "rank") setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                  else {
                    setSortBy("rank");
                    setSortDir("desc");
                  }
                }}
              >
                <span># Coin ({filteredCatalog.length})</span>
                {sortBy === "rank" && <span>{sortDir === "desc" ? "↓" : "↑"}</span>}
              </button>
              <div className="ad-flex-8">
                <button
                  type="button"
                  className="ad-table-sort-btn"
                  onClick={() => {
                    if (sortBy === "price") setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                    else {
                      setSortBy("price");
                      setSortDir("desc");
                    }
                  }}
                >
                  <span>Price</span>
                  {sortBy === "price" && <span>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </button>
                <button
                  type="button"
                  className="ad-table-sort-btn"
                  onClick={() => {
                    if (sortBy === "change24h") setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                    else {
                      setSortBy("change24h");
                      setSortDir("desc");
                    }
                  }}
                >
                  <span>24h %</span>
                  {sortBy === "change24h" && <span>{sortDir === "desc" ? "↓" : "↑"}</span>}
                </button>
              </div>
            </div>
            {filteredCatalog.slice(0, visibleLimit).map((item) => {
              const isXlm = item.assetKey === "XLM";
              const stableRank = rankByAssetKey.get(item.assetKey);
              const pct24 =
                quoteUnit === "usd"
                  ? item.change24hPct
                  : isXlm
                    ? 0
                    : typeof item.change24hPct === "number"
                      ? Number(
                          ((((1 + item.change24hPct / 100) / (1 + xlmChange24h / 100)) - 1) * 100).toFixed(2),
                        )
                      : undefined;
              const sparkPts =
                quoteUnit === "xlm" &&
                !isXlm &&
                item.sparkline7d &&
                xlmSpark &&
                item.sparkline7d.length === xlmSpark.length
                  ? item.sparkline7d.map((p, sIdx) => (xlmSpark[sIdx]! > 0 ? p / xlmSpark[sIdx]! : p))
                  : item.sparkline7d;
              const positive7d =
                sparkPts && sparkPts.length >= 2
                  ? sparkPts[sparkPts.length - 1]! >= sparkPts[0]!
                  : (pct24 ?? 0) >= 0;
              const displayPrice =
                quoteUnit === "usd"
                  ? formatUsdPrice(item.priceUsd)
                  : isXlm
                    ? "1.0000 XLM"
                    : formatXlmPrice(
                        item.priceUsd && liveXlmUsd && liveXlmUsd > 0
                          ? item.priceUsd / liveXlmUsd
                          : undefined,
                      );
              const displayMcap =
                quoteUnit === "usd"
                  ? formatCompactUsd(item.marketCapUsd)
                  : formatCompactXlm(
                      item.marketCapUsd && liveXlmUsd && liveXlmUsd > 0
                        ? item.marketCapUsd / liveXlmUsd
                        : undefined,
                    );
              const displayVol =
                quoteUnit === "usd"
                  ? formatCompactUsd(item.volume7dUsd)
                  : formatCompactXlm(
                      item.volume7dUsd && liveXlmUsd && liveXlmUsd > 0
                        ? item.volume7dUsd / liveXlmUsd
                        : undefined,
                    );

              return (
                <div
                  key={item.assetKey}
                  className={`ad-item-card ${item.reviewStatus === "unreviewed_warning" ? "ad-item-card--warn" : ""}`}
                >
                  <div className="ad-row" style={{ gap: 6, alignItems: "center" }}>
                    <button
                      type="button"
                      className={`ad-star-btn ${favSet.has(item.assetKey) ? "ad-star-btn--active" : ""}`}
                      aria-label={
                        favSet.has(item.assetKey)
                          ? `Unstar ${item.code}`
                          : `Star ${item.code}`
                      }
                      aria-pressed={favSet.has(item.assetKey)}
                      onClick={() => void toggleFavorite(item.assetKey, item)}
                    >
                      {favSet.has(item.assetKey) ? "★" : "☆"}
                    </button>

                    <button
                      type="button"
                      className="ad-search-row-btn"
                      onClick={() => handleOpenAsset(item.assetKey, "swap")}
                    >
                      <TokenAvatar
                        code={item.code}
                        icon={item.logoUrl}
                        isNative={isXlm}
                        size={34}
                        verified={item.reviewStatus === "official" || item.reviewStatus === "verified"}
                      />

                      <div className="ad-min-w-0 ad-stack-3" style={{ flex: 1 }}>
                        <div className="ad-font-bold ad-text-base ad-ellipsis">
                          {item.code}
                        </div>
                        <div className="ad-text-xs ad-text-muted ad-ellipsis tabular-nums">
                          {stableRank ? `#${stableRank} · ` : ""}
                          {displayMcap !== "--"
                            ? displayMcap
                            : (item.name ?? item.domain ?? venueLabel(item.ammVenue))}
                        </div>
                      </div>

                      <Sparkline points={sparkPts} positive={positive7d} />

                      <div className="ad-text-right ad-no-shrink tabular-nums">
                        <div className="ad-font-bold ad-text-sm">
                          {quoteUnit === "usd" ? (
                            <MicroPrice value={item.priceUsd} fallback={displayPrice} />
                          ) : (
                            displayPrice
                          )}
                        </div>
                        {typeof pct24 === "number" ? (
                          <span
                            className={`glass-pill ${pct24 >= 0 ? "glass-pill--safe" : "glass-pill--coral"}`}
                            style={{ fontSize: 10, padding: "1px 6px" }}
                          >
                            {pct24 >= 0 ? "▲ " : "▼ "}
                            {Math.abs(pct24).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="ad-text-xxs ad-text-muted">Shield {item.shieldScore}</span>
                        )}
                      </div>
                    </button>
                  </div>

                  <div className="ad-row ad-text-xxs ad-text-muted tabular-nums" style={{ marginTop: 2, paddingLeft: 44 }}>
                    <span className="ad-flex-6" style={{ alignItems: "center" }}>
                      {reviewBadge(item)}
                      <span>7d Vol {displayVol}</span>
                    </span>
                    <span>
                      {item.holdersCount
                        ? `${formatCompactCount(item.holdersCount)} holders`
                        : shortKey(item.assetKey)}
                    </span>
                  </div>
                </div>
              );
            })}
            {filteredCatalog.length > visibleLimit && (
              <button
                type="button"
                className="ad-btn-secondary ad-btn-block"
                onClick={() => setVisibleLimit((n) => n + 35)}
              >
                Load more ({filteredCatalog.length - visibleLimit} remaining)
              </button>
            )}
          </div>
        )}
      </section>
      )}
    </div>
  );
}
