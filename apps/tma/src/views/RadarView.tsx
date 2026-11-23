import type { CatalogTokenItem } from "@astrodex/domain";
import { buildAstroDexDeepLink } from "@astrodex/tg-protocol";
import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  if (!points || points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 56;
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

export function RadarView() {
  const {
    config,
    feedNetwork,
    executionDisabled,
    catalog,
    favorites,
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
  const [activeFilter, setActiveFilter] = useState<MarketFilter>("all");
  const [quoteUnit, setQuoteUnit] = useState<"usd" | "xlm">("usd");
  const [showListForm, setShowListForm] = useState(false);

  const xlmItem = useMemo(() => catalog.find((c) => c.assetKey === "XLM"), [catalog]);
  const liveXlmUsd = xlmUsd && xlmUsd > 0 ? xlmUsd : (xlmItem?.priceUsd ?? 0.135);
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
    setActiveTab("trade");
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

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const filteredCatalog = useMemo(() => {
    const rawQ = query.trim().toLowerCase();
    const q = rawQ.includes("/") ? (rawQ.split("/")[0]?.trim() ?? rawQ) : rawQ;
    return catalog
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
        if (aFav !== bFav) return bFav - aFav;

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
        if (diff !== 0) return diff;
        return (b.holdersCount ?? b.shieldScore) - (a.holdersCount ?? a.shieldScore);
      });
  }, [catalog, favSet, query, activeFilter]);

  return (
    <div className="ad-stack-12">
      <section className="glass-card ad-stack-10">
        <div className="ad-row ad-row-wrap">
          <div className="ad-flex-8 ad-min-w-0">
            <h2 className="ad-heading-sm" style={{ margin: 0 }}>
              Stellar Markets
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
            {!executionDisabled && (
              <button
                type="button"
                className="glass-pill ad-clickable ad-no-shrink"
                style={{ padding: "5px 10px" }}
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
              ? "Search token (USDC, AQUA, KALE, CETES) or CODE:G..."
              : "Search Testnet token (ASTRO, USDC, STELA) or CODE:G..."
          }
          submitLabel="Swap"
          primaryActionLabel="Swap"
          secondaryActionLabel="X-Ray"
          onSelectToken={(item, action) =>
            handleOpenAsset(item.assetKey, action === "secondary" ? "safety" : "swap")
          }
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
              `Pick a matching token from the suggestions or paste a full CODE:G... / C... ID in "+ List".`,
            );
          }}
        />
        {searchHint && <div className="ad-banner ad-banner--warn">{searchHint}</div>}

        <div className="ad-chip-row" role="tablist" aria-label="Market Filters">
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === "favorites"}
            className={`glass-pill ad-clickable ${activeFilter === "favorites" ? "glass-pill--gold" : ""}`}
            style={{ padding: "6px 12px", fontSize: 12 }}
            onClick={() => setActiveFilter("favorites")}
          >
            ♥ Favorites{favorites.length > 0 ? ` (${favorites.length})` : ""}
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

      <section className="glass-card ad-stack-8">
        <div className="ad-row ad-text-xs ad-text-muted" style={{ padding: "0 4px" }}>
          <span>Asset ({filteredCatalog.length})</span>
          <span>7d</span>
          <span>Price / 24h</span>
        </div>

        {catalogLoading && catalog.length === 0 ? (
          <div className="ad-banner">Syncing live Stellar markets...</div>
        ) : filteredCatalog.length === 0 ? (
          <div className="ad-banner">
            No matching tokens found. Try another filter or paste a token ID in Search.
          </div>
        ) : (
          <div className="ad-stack-6">
            {filteredCatalog.slice(0, 35).map((item, idx) => {
              const isXlm = item.assetKey === "XLM";
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
                    : formatXlmPrice(item.priceUsd && liveXlmUsd > 0 ? item.priceUsd / liveXlmUsd : undefined);
              const displayMcap =
                quoteUnit === "usd"
                  ? formatCompactUsd(item.marketCapUsd)
                  : formatCompactXlm(item.marketCapUsd && liveXlmUsd > 0 ? item.marketCapUsd / liveXlmUsd : undefined);
              const displayVol =
                quoteUnit === "usd"
                  ? formatCompactUsd(item.volume7dUsd)
                  : formatCompactXlm(item.volume7dUsd && liveXlmUsd > 0 ? item.volume7dUsd / liveXlmUsd : undefined);

              return (
                <div
                  key={item.assetKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenAsset(item.assetKey, "swap")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpenAsset(item.assetKey, "swap");
                    }
                  }}
                  className={`ad-item-card ad-clickable ${item.reviewStatus === "unreviewed_warning" ? "ad-item-card--warn" : ""}`}
                >
                  <div className="ad-row" style={{ gap: 8, alignItems: "center" }}>
                    <button
                      type="button"
                      className={`ad-fav-btn ${favSet.has(item.assetKey) ? "ad-fav-btn--active" : ""}`}
                      aria-label={
                        favSet.has(item.assetKey)
                          ? `Remove ${item.code} from favorites`
                          : `Add ${item.code} to favorites`
                      }
                      aria-pressed={favSet.has(item.assetKey)}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleFavorite(item.assetKey);
                      }}
                    >
                      {favSet.has(item.assetKey) ? "♥" : "♡"}
                    </button>

                    <div className="ad-min-w-0 ad-stack-3" style={{ flex: 1 }}>
                      <div className="ad-font-bold ad-text-base ad-flex-6" style={{ alignItems: "center" }}>
                        <span className="ad-text-xs ad-text-muted tabular-nums">#{idx + 1}</span>
                        <span className="ad-ellipsis">{item.code}</span>
                        {reviewBadge(item)}
                      </div>
                      <div className="ad-text-xs ad-text-muted ad-ellipsis">
                        {item.name ?? item.domain ?? venueLabel(item.ammVenue)}
                      </div>
                    </div>

                    <Sparkline points={sparkPts} positive={positive7d} />

                    <div className="ad-text-right ad-no-shrink tabular-nums">
                      <div className="ad-font-bold ad-text-sm">{displayPrice}</div>
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

                  <div className="ad-row ad-text-xxs ad-text-muted tabular-nums" style={{ marginTop: 2 }}>
                    <span>
                      MCap {displayMcap} · 7d Vol {displayVol}
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
          </div>
        )}
      </section>
    </div>
  );
}
