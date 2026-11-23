import type { CatalogTokenItem } from "@astrodex/domain";
import { buildAstroDexDeepLink } from "@astrodex/tg-protocol";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TokenSearchInput } from "../components/TokenSearchInput.js";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink, triggerTelegramHaptic } from "../telegram/webapp.js";

type CatalogFilter = "all" | "official" | "community" | "launchpad";
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
  if (code === "YXLM" || code === "YUSDC" || code === "AQUA" || code === "EURC") return 90;
  if (code === "XRP" || code === "BTCLN" || code === "SSLX") return 86;
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
    mode,
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
  const [showListForm, setShowListForm] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const handleCopyId = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(value);
      triggerTelegramHaptic("selection");
      setTimeout(() => setCopiedKey((cur) => (cur === value ? null : cur)), 1500);
    } catch {
      // Clipboard unavailable in restricted WebView
    }
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

  const officialCount = useMemo(
    () => catalog.filter((item) => item.reviewStatus === "official").length,
    [catalog],
  );
  const communityCount = useMemo(
    () => catalog.filter((item) => item.reviewStatus !== "official").length,
    [catalog],
  );

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((item) => {
        if (filter === "official" && item.reviewStatus !== "official") return false;
        if (filter === "community" && item.reviewStatus === "official") return false;
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
        const diff = catalogRank(b) - catalogRank(a);
        if (diff !== 0) return diff;
        return b.shieldScore - a.shieldScore;
      });
  }, [catalog, filter, query]);

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
              ? "Search Mainnet token (USDC, AQUA, yXLM, EURC, XRP) or CODE:G... / C..."
              : "Search Testnet token (ASTRO, USDC, STELA) or CODE:G... / C..."
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

        <div className="ad-chip-row" role="tablist" aria-label="Token Category Filter">
          {(
            [
              { id: "all", label: `All (${catalog.length})` },
              { id: "official", label: `Official (${officialCount})` },
              { id: "community", label: `Community & AMMs (${communityCount})` },
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
            {filteredCatalog.slice(0, 25).map((item) => (
              <div
                key={item.assetKey}
                className={`ad-item-card ${item.reviewStatus === "unreviewed_warning" ? "ad-item-card--warn" : ""}`}
              >
                <div className="ad-row ad-row-start">
                  <div className="ad-min-w-0 ad-stack-3">
                    <div className="ad-font-bold ad-text-base ad-flex-wrap">
                      <span>${item.code}</span>
                      {reviewBadge(item)}
                      <span className="glass-pill tabular-nums">Shield {item.shieldScore}/100</span>
                    </div>
                    <div className="ad-text-xs ad-text-muted">
                      {item.name ?? item.kind.toUpperCase()} · {venueLabel(item.ammVenue)} ·{" "}
                      <button
                        type="button"
                        onClick={() => void handleCopyId(item.assetKey)}
                        className="ad-link-inline"
                        title="Copy Asset ID"
                      >
                        {copiedKey === item.assetKey ? "Copied!" : shortKey(item.assetKey)}
                      </button>
                    </div>
                    {mode === "pro" && (item.issuer || item.pairId) && (
                      <div className="ad-text-xxs ad-text-muted tabular-nums">
                        {item.issuer ? `Issuer: ${shortKey(item.issuer)}` : ""}
                        {item.issuer && item.pairId ? " · " : ""}
                        {item.pairId ? `Pair: ${shortKey(item.pairId)}` : ""}
                      </div>
                    )}
                  </div>
                  <div className="ad-flex-6 ad-no-shrink">
                    <button
                      type="button"
                      className="ad-btn-secondary ad-btn-sm"
                      onClick={() => handleOpenAsset(item.assetKey, "trade")}
                    >
                      Quote
                    </button>
                    <button
                      type="button"
                      className="glass-pill ad-clickable"
                      onClick={() => handleOpenAsset(item.assetKey, "book")}
                    >
                      Book
                    </button>
                    <button
                      type="button"
                      className="glass-pill ad-clickable"
                      onClick={() => handleOpenAsset(item.assetKey, "scanner")}
                    >
                      Scan
                    </button>
                  </div>
                </div>
                {item.reviewStatus === "unreviewed_warning" && item.reviewNote && (
                  <div className="ad-text-xs ad-text-warn">⚠️ {item.reviewNote}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
