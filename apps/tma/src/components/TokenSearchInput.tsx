import type { CatalogTokenItem } from "@astrodex/domain";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAppState } from "../state/app-context.js";
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
  placeholder = "Search by name/ticker (USDC, AQUA, yXLM, XLM) or paste CODE:G... / C...",
  submitLabel,
  onSubmitRaw,
  onSelectToken,
  primaryActionLabel = "Select",
  secondaryActionLabel,
  showResultsWhenEmpty = false,
  maxResults = 6,
}: TokenSearchInputProps) {
  const { config, feedNetwork, catalog } = useAppState();
  const [remoteResults, setRemoteResults] = useState<CatalogTokenItem[]>([]);
  const [searchingRemote, setSearchingRemote] = useState(false);

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
    if (q.length < 2) {
      setRemoteResults([]);
      setSearchingRemote(false);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchingRemote(true);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(
          `${base}/v1/markets/search?q=${encodeURIComponent(q)}&limit=${maxResults}&net=${encodeURIComponent(feedNetwork)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { results?: CatalogTokenItem[] };
        if (!cancelled && Array.isArray(json.results)) {
          setRemoteResults(json.results);
        }
      } catch {
        // Keep local catalog fallback cleanly
      } finally {
        if (!cancelled) setSearchingRemote(false);
      }
    }, 280);
    return () => {
      cancelled = true;
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
        <input
          type="text"
          className="ad-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Token Search Input"
        />
        {submitLabel && (
          <button type="submit" className="ad-btn-primary">
            {submitLabel}
          </button>
        )}
      </form>

      {showDropdown && (combinedResults.length > 0 || searchingRemote) && (
        <div className="ad-dropdown-list">
          {searchingRemote && combinedResults.length === 0 && (
            <div className="ad-text-xs ad-text-muted">
              Searching Stellar network...
            </div>
          )}
          {combinedResults.map((item) => (
            <div key={item.assetKey} className="ad-row ad-dropdown-item">
              <div className="ad-flex-8 ad-min-w-0">
                <TokenAvatar
                  code={item.code}
                  icon={item.logoUrl}
                  isNative={item.assetKey === "XLM"}
                  size={30}
                  verified={item.reviewStatus === "official" || item.reviewStatus === "verified"}
                />
                <div className="ad-min-w-0">
                  <div className="ad-text-md ad-font-bold ad-flex-wrap">
                    <span>${item.code}</span>
                    <span
                      className={`glass-pill ${
                        item.reviewStatus === "official"
                          ? "glass-pill--safe"
                          : item.reviewStatus === "verified"
                            ? "glass-pill--gold"
                            : "glass-pill--warn"
                      }`}
                    >
                      {item.reviewStatus === "official"
                        ? "Official"
                        : item.reviewStatus === "verified"
                          ? "Verified"
                          : "Unreviewed"}
                    </span>
                  </div>
                  <div className="ad-text-xs ad-text-muted">
                    {item.name ? `${item.name} · ` : ""}
                    {shortKey(item.assetKey)}
                  </div>
                </div>
              </div>
              <div className="ad-flex-6 ad-no-shrink">
                <button
                  type="button"
                  className="ad-btn-secondary ad-btn-sm"
                  onClick={() => onSelectToken(item, "primary")}
                >
                  {primaryActionLabel}
                </button>
                {secondaryActionLabel && (
                  <button
                    type="button"
                    className="glass-pill ad-clickable"
                    onClick={() => onSelectToken(item, "secondary")}
                  >
                    {secondaryActionLabel}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
