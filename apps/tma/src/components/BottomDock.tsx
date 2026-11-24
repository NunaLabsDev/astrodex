import { useAppState } from "../state/app-context.js";

function MarketsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function BottomDock() {
  const { activeTab, setActiveTab, favorites } = useAppState();

  if (activeTab !== "radar" && activeTab !== "watchlist") {
    return null;
  }

  const isMarketsActive = activeTab === "radar";
  const isWatchlistActive = activeTab === "watchlist";

  return (
    <nav className="glass-dock ad-dock-2" aria-label="AstroDex Markets Navigation">
      <button
        type="button"
        className={`ad-dock-btn ${isMarketsActive ? "ad-dock-btn--active" : ""}`}
        onClick={() => setActiveTab("radar")}
        aria-label="Stellar Markets"
        aria-current={isMarketsActive ? "page" : undefined}
      >
        <span className="ad-dock-icon" aria-hidden="true">
          <MarketsIcon />
        </span>
        <span className="ad-dock-label">Markets</span>
      </button>

      <button
        type="button"
        className={`ad-dock-btn ${isWatchlistActive ? "ad-dock-btn--active" : ""}`}
        style={{ position: "relative" }}
        onClick={() => setActiveTab("watchlist")}
        aria-label="Starred Watchlist"
        aria-current={isWatchlistActive ? "page" : undefined}
      >
        <span className="ad-dock-icon" aria-hidden="true">
          <StarIcon filled={isWatchlistActive} />
        </span>
        <span className="ad-dock-label">Watchlist</span>
        {favorites.length > 0 && (
          <span className="ad-dock-badge tabular-nums">{favorites.length}</span>
        )}
      </button>
    </nav>
  );
}
