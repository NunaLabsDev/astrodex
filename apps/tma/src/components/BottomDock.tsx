import { useAppState, type DockTab } from "../state/app-context.js";

function DockIcon({ tab }: { tab: DockTab }) {
  if (tab === "radar") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      </svg>
    );
  }
  if (tab === "trade") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 16V4m0 0L3 8m4-4 4 4" />
        <path d="M17 8v12m0 0 4-4m-4 4-4-4" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

const TABS: Array<{ id: DockTab; label: string; ariaLabel: string }> = [
  { id: "radar", label: "Markets", ariaLabel: "Stellar Markets" },
  { id: "trade", label: "Swap", ariaLabel: "Swap & Token Analysis" },
  { id: "orders", label: "Orders", ariaLabel: "Orders, Watchlist & Price Alerts" },
];

export function BottomDock() {
  const { activeTab, setActiveTab, openOffersCount } = useAppState();
  return (
    <nav className="glass-dock" aria-label="AstroDex Primary Navigation">
      {TABS.map((tab) => {
        const isActive =
          activeTab === tab.id ||
          (tab.id === "trade" &&
            (activeTab === "trade" || activeTab === "scanner" || activeTab === "book"));
        return (
          <button
            key={tab.id}
            type="button"
            className={`ad-dock-btn ${isActive ? "ad-dock-btn--active" : ""}`}
            style={{ position: "relative" }}
            onClick={() => setActiveTab(tab.id)}
            aria-label={tab.ariaLabel}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="ad-dock-icon" aria-hidden="true">
              <DockIcon tab={tab.id} />
            </span>
            <span className="ad-dock-label">{tab.label}</span>
            {tab.id === "orders" && openOffersCount > 0 && (
              <span className="ad-dock-badge tabular-nums">{openOffersCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
