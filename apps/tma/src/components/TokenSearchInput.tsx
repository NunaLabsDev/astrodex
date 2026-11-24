import type { CatalogTokenItem } from "@astrodex/domain";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAppState } from "../state/app-context.js";
import { MicroPrice } from "./MicroPrice.js";
import { TokenAvatar } from "./TokenAvatar.js";

function shortKey(key: string): string {
  if (key.length <= 16) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export interface TokenSearchInputProps {
  query: string;
  onQueryChange: (val: string) => void;
  placeholder?: string;
  submitLabel?: string;
  onSubmitRaw?: (raw: string, bestMatch: CatalogTokenItem | null) => void;
  onSelectToken: (item: CatalogTokenItem, action?: "primary" | "secondary") => void;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  showResultsWhenEmpty?: boolean;
  maxResults?: number;
}

export function TokenSearchInput({
  query,
  onQueryChange,
  placeholder = "Search coin, ticker, or paste CODE:G... / C...",
  submitLabel,
  onSubmitRaw,
  onSelectToken,
  showResultsWhenEmpty = false,
  maxResults = 8,
}: TokenSearchInputProps) {
  const { config, feedNetwork, catalog, favorites, toggleFavorite } = useAppState();
  const [remoteResults, setRemoteResults] = useState<CatalogTokenItem[]>([]);
  const [searchingRemote, setSearchingRemote] = useState(false);

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const localResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return showResultsWhenEmpty ? catalog.slice(0, maxResults) : [];
    }
    return catalog
      .filter(
        (item) =>
          item.code.toLowerCase().includes(q) ||
          (item.name ?? "").toLowerCase().includes(q) ||
          item.assetKey.toLowerCase().includes(q) ||
          (item.issuer ?? "").toLowerCase().includes(q) ||
          (item.sacId ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aExact = a.code.toLowerCase() === q ? 1 : 0;
        const bExact = b.code.toLowerCase() === q ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aVer = a.reviewStatus === "official" || a.reviewStatus === "verified" ? 1 : 0;
        const bVer = b.reviewStatus === "official" || b.reviewStatus === "verified" ? 1 : 0;
        if (aVer !== bVer) return bVer - aVer;
        return b.shieldScore - a.shieldScore;
      })
      .slice(0, maxResults);
  }, [catalog, maxResults, query, showResultsWhenEmpty]);

  useEffect(() => {
    const q = query.trim();
    setRemoteResults([]);
    if (q.length < 2) {
      setSearchingRemote(false);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingRemote(true);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(
          `${base}/v1/markets/search?q=${encodeURIComponent(q)}&limit=${maxResults}&net=${encodeURIComponent(feedNetwork)}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { results?: CatalogTokenItem[] };
        if (!cancelled && Array.isArray(json.results)) {
          setRemoteResults(json.results);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Keep local catalog fallback cleanly
      } finally {
        if (!cancelled) setSearchingRemote(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [config.apiBaseUrl, feedNetwork, maxResults, query]);

  const combinedResults = useMemo(() => {
    const seen = new Set<string>();
    const out: CatalogTokenItem[] = [];
    for (const item of [...localResults, ...remoteResults]) {
      const key = item.assetKey.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= maxResults) break;
    }
    return out;
  }, [localResults, maxResults, remoteResults]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!onSubmitRaw) return;
    const q = query.trim();
    if (!q) return;
    onSubmitRaw(q, combinedResults[0] ?? null);
  };

  const showDropdown = query.trim().length > 0 || showResultsWhenEmpty;

  return (
    <div className="ad-stack-6">
      <form onSubmit={handleSubmit} className="ad-flex-8">
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <input
            type="text"
            className="ad-input"
            style={{ width: "100%", paddingRight: query.length > 0 ? 36 : undefined }}
            placeholder={placeholder}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Token Search Input"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange("")}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 36,
                height: 36,
                borderRadius: "999px",
                border: "none",
                background: "rgba(255, 255, 255, 0.12)",
                color: "var(--ad-ink-secondary)",
                fontSize: 13,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✕
            </button>
          )}
        </div>
        {submitLabel && (
          <button type="submit" className="ad-btn-secondary ad-btn-md">
            {submitLabel}
          </button>
        )}
      </form>

      {showDropdown && (
        <div className="ad-dropdown-list">
          {searchingRemote && combinedResults.length === 0 && (
            <div className="ad-text-xs ad-text-muted">
              Searching Stellar network &amp; StellarExpert...
            </div>
          )}
          {!searchingRemote && combinedResults.length === 0 && query.trim().length > 0 && (
            <div className="ad-text-xs ad-text-muted" style={{ padding: "6px 4px" }}>
              No coins found on {feedNetwork.toUpperCase()} for &ldquo;{query.trim()}&rdquo;. Paste a full{" "}
              <code>CODE:G...</code> or <code>C...</code> contract ID to inspect directly.
            </div>
          )}
          {combinedResults.map((item) => {
            const isStarred = favSet.has(item.assetKey);
            return (
              <div key={item.assetKey} className="ad-row ad-dropdown-item" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="ad-search-row-btn"
                  onClick={() => onSelectToken(item, "primary")}
                >
                  <TokenAvatar
                    code={item.code}
                    icon={item.logoUrl}
                    isNative={item.assetKey === "XLM"}
                    size={32}
                    verified={item.reviewStatus === "official" || item.reviewStatus === "verified"}
                  />
                  <div className="ad-min-w-0" style={{ flex: 1 }}>
                    <div className="ad-text-md ad-font-bold ad-flex-6" style={{ alignItems: "center" }}>
                      <span>{item.code}</span>
                      <span
                        className={`glass-pill ${
                          item.reviewStatus === "official"
                            ? "glass-pill--safe"
                            : item.reviewStatus === "verified"
                              ? "glass-pill--gold"
                              : "glass-pill--warn"
                        }`}
                        style={{ fontSize: 10, padding: "1px 6px" }}
                      >
                        {item.reviewStatus === "official"
                          ? "Official"
                          : item.reviewStatus === "verified"
                            ? "Verified"
                            : "Unlisted"}
                      </span>
                    </div>
                    <div className="ad-text-xs ad-text-muted ad-ellipsis">
                      {item.name && item.name !== item.code ? `${item.name} · ` : ""}
                      {item.domain ?? shortKey(item.assetKey)}
                    </div>
                  </div>
                  <div className="ad-text-right ad-no-shrink tabular-nums" style={{ marginRight: 2 }}>
                    {typeof item.priceUsd === "number" && item.priceUsd > 0 ? (
                      <div className="ad-text-xs ad-font-bold">
                        <MicroPrice value={item.priceUsd} />
                      </div>
                    ) : null}
                    <div className="ad-text-xxs ad-text-muted">Explore ›</div>
                  </div>
                </button>
                <button
                  type="button"
                  className={`ad-star-btn ${isStarred ? "ad-star-btn--active" : ""}`}
                  aria-label={isStarred ? `Unstar ${item.code}` : `Star ${item.code}`}
                  aria-pressed={isStarred}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFavorite(item.assetKey, item);
                  }}
                >
                  {isStarred ? "★" : "☆"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
