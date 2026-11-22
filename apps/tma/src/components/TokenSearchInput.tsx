import type { CatalogTokenItem } from "@astrodex/domain";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAppState } from "../state/app-context.js";

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
  placeholder = "Search by name/ticker (ASTRO, USDC, STELA) or paste CODE:G... / C...",
  submitLabel,
  onSubmitRaw,
  onSelectToken,
  primaryActionLabel = "Select",
  secondaryActionLabel,
  showResultsWhenEmpty = false,
  maxResults = 6,
}: TokenSearchInputProps) {
  const { config, catalog } = useAppState();
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
          `${base}/v1/markets/search?q=${encodeURIComponent(q)}&limit=${maxResults}`,
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
  }, [config.apiBaseUrl, maxResults, query]);

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
    <div style={{ display: "grid", gap: 6 }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
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
        <div
          style={{
            display: "grid",
            gap: 4,
            padding: 6,
            borderRadius: 14,
            background: "rgba(11, 20, 51, 0.92)",
            border: "1px solid rgba(165, 139, 224, 0.32)",
          }}
        >
          {searchingRemote && combinedResults.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)", padding: "4px 6px" }}>
              Searching Stellar network &amp; AstroGate...
            </div>
          )}
          {combinedResults.map((item) => (
            <div
              key={item.assetKey}
              className="ad-row"
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                background: "rgba(23, 44, 105, 0.52)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
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
                <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }}>
                  {item.name ? `${item.name} · ` : ""}
                  {shortKey(item.assetKey)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="ad-btn-secondary"
                  style={{ minHeight: 34, padding: "4px 10px", fontSize: 12 }}
                  onClick={() => onSelectToken(item, "primary")}
                >
                  {primaryActionLabel}
                </button>
                {secondaryActionLabel && (
                  <button
                    type="button"
                    className="glass-pill"
                    style={{ cursor: "pointer" }}
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
