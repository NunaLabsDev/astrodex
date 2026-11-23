import { useAppState, type DockTab } from "../state/app-context.js";

const TABS: Array<{ id: DockTab; label: string; short: string }> = [
  { id: "radar", label: "Markets", short: "Markets" },
  { id: "book", label: "Pools & APY", short: "Pools" },
  { id: "trade", label: "Trade", short: "Trade" },
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
