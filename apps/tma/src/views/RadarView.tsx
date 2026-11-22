import type { CatalogTokenItem } from "@astrodex/domain";
import { buildAstroDexDeepLink, buildAstroGateDeepLink } from "@astrodex/tg-protocol";
import { useMemo, useState, type FormEvent } from "react";
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

export function RadarView() {
  const {
    config,
    catalog,
    xlmUsd,
    launchpadTokens,
    catalogLoading,
    refreshCatalog,
    setSelectedAsset,
    setActiveTab,
  } = useAppState();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [showListForm, setShowListForm] = useState(false);

  // Instant self-serve listing state
  const [listAssetId, setListAssetId] = useState("");
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

  const handleOpenAsset = (assetId: string, tab: "trade" | "scanner") => {
    setSelectedAsset(assetId.trim());
    setActiveTab(tab);
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const match = catalog.find(
      (t) =>
        t.code.toLowerCase() === q.toLowerCase() ||
        t.assetKey.toLowerCase() === q.toLowerCase(),
    );
    handleOpenAsset(match ? match.assetKey : q, "scanner");
  };

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

  const quickChips = useMemo(
    () =>
      catalog
        .filter((t) => t.assetKey !== "XLM")
        .slice(0, 6),
    [catalog],
  );

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((item) => {
      if (filter === "official" && item.reviewStatus !== "official") return false;
      if (filter === "community" && item.reviewStatus === "official") return false;
      if (
        q &&
        !item.code.toLowerCase().includes(q) &&
        !(item.name ?? "").toLowerCase().includes(q) &&
        !item.assetKey.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [catalog, filter, query]);

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
              XLM:{" "}
              <span className="tabular-nums" style={{ color: "var(--ad-stellar-gold)" }}>
                {xlmUsd ? `$${xlmUsd.toFixed(4)}` : "Live Feed"}
              </span>
            </h2>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="ad-btn-secondary"
              onClick={() => setShowListForm((prev) => !prev)}
            >
              {showListForm ? "Close" : "+ List Token"}
            </button>
            {launchUrl && (
              <button
                type="button"
                className="ad-btn-secondary"
                onClick={() => openTelegramDeepLink(launchUrl)}
              >
                Launchpad
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            className="ad-input"
            placeholder="Filter by ticker (USDC, ASTRO) or paste CODE:G... / C..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Asset search input"
          />
          <button type="submit" className="ad-btn-primary">
            Scan
          </button>
        </form>

        {quickChips.length > 0 && (
          <div className="ad-chip-row" aria-label="1-Tap Official Pairs">
            {quickChips.map((chip) => (
              <button
                key={chip.assetKey}
                type="button"
                className="glass-pill"
                style={{ cursor: "pointer" }}
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
        <section className="glass-card" style={{ display: "grid", gap: 10 }}>
          <div className="ad-row">
            <strong style={{ fontSize: 14 }}>Instant Token &amp; AMM Listing</strong>
            <span className="glass-pill">Auto-Shield</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--ad-ink-secondary)" }}>
            Publish any Stellar token and AMM pool instantly. Spoofed tickers are blocked; unreviewed or flagged tokens display a live caution badge.
          </div>
          <form onSubmit={(e) => void handleSubmitListing(e)} style={{ display: "grid", gap: 8 }}>
            <input
              type="text"
              className="ad-input"
              placeholder="Token ID (CODE:G... or Soroban C...)"
              value={listAssetId}
              onChange={(e) => setListAssetId(e.target.value)}
              required
            />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
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
              className={`ad-banner ${
                !listingResult.ok
                  ? "ad-banner--danger"
                  : listingResult.warning
                    ? "ad-banner--warn"
                    : ""
              }`}
              style={{ display: "grid", gap: 6 }}
            >
              <div>{listingResult.message}</div>
              {listingResult.ok && listingResult.assetKey && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="ad-btn-secondary"
                    onClick={() => handleOpenAsset(listingResult.assetKey!, "trade")}
                  >
                    Trade Now
                  </button>
                  <button
                    type="button"
                    className="glass-pill"
                    style={{ cursor: "pointer" }}
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

      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 14 }}>Official, Community &amp; Launchpad</strong>
          <span className="glass-pill">{catalogLoading ? "Syncing..." : `${catalog.length} listed`}</span>
        </div>

        <div className="ad-chip-row" role="tablist" aria-label="Token Category Filter">
          {(
            [
              { id: "all", label: "All" },
              { id: "official", label: "Official" },
              { id: "community", label: "Community & AMMs" },
              { id: "launchpad", label: `Launchpad (${launchpadTokens.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`glass-pill ${filter === tab.id ? "glass-pill--gold" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filter === "launchpad" ? (
          launchpadTokens.length === 0 ? (
            <div className="ad-banner">No active AstroGate v4.5 curves indexed right now.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {launchpadTokens.slice(0, 12).map((item) => (
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
          )
        ) : filteredCatalog.length === 0 ? (
          <div className="ad-banner">
            No matching tokens found. Use "+ List Token" above to publish a new Stellar token &amp; AMM instantly.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {filteredCatalog.slice(0, 20).map((item) => (
              <div
                key={item.assetKey}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: "10px 12px",
                  borderRadius: 14,
                  background: "rgba(11, 20, 51, 0.65)",
                  border:
                    item.reviewStatus === "unreviewed_warning"
                      ? "1px solid rgba(245, 201, 40, 0.45)"
                      : "1px solid rgba(165, 139, 224, 0.2)",
                }}
              >
                <div className="ad-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>${item.code}</span>
                      {reviewBadge(item)}
                      <span className="glass-pill tabular-nums">{item.shieldScore}/100</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }}>
                      {item.name ?? item.kind.toUpperCase()}
                      {item.ammVenue ? ` · ${item.ammVenue}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="ad-btn-secondary"
                      onClick={() => handleOpenAsset(item.assetKey, "trade")}
                    >
                      Trade
                    </button>
                    <button
                      type="button"
                      className="glass-pill"
                      style={{ cursor: "pointer" }}
                      onClick={() => handleOpenAsset(item.assetKey, "scanner")}
                    >
                      Scan
                    </button>
                  </div>
                </div>
                {item.reviewStatus === "unreviewed_warning" && item.reviewNote && (
                  <div style={{ fontSize: 11, color: "#FDE68A" }}>
                    ⚠️ {item.reviewNote}
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
