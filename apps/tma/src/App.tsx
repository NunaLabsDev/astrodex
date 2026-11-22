import { AstroIdHeader } from "./components/AstroIdHeader.js";
import { BottomDock } from "./components/BottomDock.js";
import { TelegramOnlyGate } from "./components/TelegramOnlyGate.js";
import { AppProvider, useAppState } from "./state/app-context.js";
import { isInsideTelegramMiniApp, shouldAllowMiniAppAccess } from "./telegram/webapp.js";
import { BookPoolsView } from "./views/BookPoolsView.js";
import { OrdersAlertsView } from "./views/OrdersAlertsView.js";
import { RadarView } from "./views/RadarView.js";
import { ScannerView } from "./views/ScannerView.js";
import { TradeChartView } from "./views/TradeChartView.js";

function AstroDexShell() {
  const { config, authStatus, authError, activeTab, retryAuth } = useAppState();
  const inTelegram = isInsideTelegramMiniApp();
  const allowed = shouldAllowMiniAppAccess({
    inTelegram,
    allowDevOutsideTelegram: config.allowDevOutsideTelegram,
    authStatus,
  });

  if (!allowed) {
    return (
      <TelegramOnlyGate
        config={config}
        authStatus={authStatus}
        authError={authError}
        onRetry={retryAuth}
      />
    );
  }

  return (
    <main className="glass-canvas">
      <div className="ad-shell">
        <AstroIdHeader />
        {activeTab === "radar" && <RadarView />}
        {activeTab === "trade" && <TradeChartView />}
        {activeTab === "scanner" && <ScannerView />}
        {activeTab === "book" && <BookPoolsView />}
        {activeTab === "orders" && <OrdersAlertsView />}
      </div>
      <BottomDock />
    </main>
  );
}

export function App() {
  return (
    <AppProvider>
      <AstroDexShell />
    </AppProvider>
  );
}
