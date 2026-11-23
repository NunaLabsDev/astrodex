import { useAppState, type DockTab } from "../state/app-context.js";

const TABS: Array<{ id: DockTab; icon: string; label: string; ariaLabel: string }> = [
  { id: "radar", icon: "◎", label: "Markets", ariaLabel: "Stellar Markets" },
  { id: "trade", icon: "⇄", label: "Swap", ariaLabel: "Swap & Token Analysis" },
  { id: "orders", icon: "◈", label: "Portfolio", ariaLabel: "Portfolio, Orders & Alerts" },
];

export function BottomDock() {
  const { activeTab, setActiveTab } = useAppState();
  return (
    <nav className="glass-dock" aria-label="AstroDex Primary Navigation">
      {TABS.map((tab) => {
        const isActive =
          activeTab === tab.id ||
          (tab.id === "trade" && (activeTab === "book" || activeTab === "scanner"));
        return (
          <button
            key={tab.id}
            type="button"
            className={`ad-dock-btn ${isActive ? "ad-dock-btn--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            aria-label={tab.ariaLabel}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="ad-dock-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="ad-dock-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
