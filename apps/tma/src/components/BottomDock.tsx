import { useAppState, type DockTab } from "../state/app-context.js";

const TABS: Array<{ id: DockTab; label: string; short: string }> = [
  { id: "radar", label: "Radar", short: "Radar" },
  { id: "trade", label: "Trade & Chart", short: "Trade" },
  { id: "scanner", label: "Scanner", short: "Scan" },
  { id: "book", label: "Book & Pools", short: "Book" },
  { id: "orders", label: "Orders & Alerts", short: "Orders" },
];

export function BottomDock() {
  const { activeTab, setActiveTab } = useAppState();
  return (
    <nav className="glass-dock" aria-label="AstroDex Primary Navigation">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`ad-dock-btn ${activeTab === tab.id ? "ad-dock-btn--active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
          aria-label={tab.label}
          aria-current={activeTab === tab.id ? "page" : undefined}
        >
          <span>{tab.short}</span>
        </button>
      ))}
    </nav>
  );
}
