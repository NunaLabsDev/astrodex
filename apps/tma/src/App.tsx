import { buildAstroWalletOnboardingLink } from "@astrodex/tg-protocol";
import { useState, type FormEvent } from "react";
import { AstroIdHeader } from "./components/AstroIdHeader.js";
import { BottomDock } from "./components/BottomDock.js";
import { TelegramOnlyGate } from "./components/TelegramOnlyGate.js";
import { AppProvider, useAppState } from "./state/app-context.js";
import {
  isInsideTelegramMiniApp,
  openTelegramDeepLink,
  shouldAllowMiniAppAccess,
  useTelegramBackButton,
} from "./telegram/webapp.js";
import { OrdersAlertsView } from "./views/OrdersAlertsView.js";
import { RadarView } from "./views/RadarView.js";
import { TradeChartView } from "./views/TradeChartView.js";

function AstroWalletLoginGate() {
  const { config, retryAuth, resolvePublicIdentity } = useAppState();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const walletConnectUrl = buildAstroWalletOnboardingLink({
    astroWalletBotUsername: config.astroWalletBotUsername,
    astroWalletMiniAppShortName: config.astroWalletMiniAppShortName,
  });

  const handleManualConnect = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setFeedback(null);
    const res = await resolvePublicIdentity(query);
    setFeedback({ ok: res.ok, text: res.message });
    setBusy(false);
  };

  return (
    <section className="glass-card ad-stack-12" aria-label="AstroWallet Login Gate">
      <div className="ad-stack-4">
        <div className="ad-text-lg ad-font-extrabold">Sign In with AstroWallet (@AstroID)</div>
        <p className="ad-text-sm ad-text-muted" style={{ margin: 0 }}>
          Connect your non-custodial AstroWallet to unlock live trading, orderbooks, and portfolio
          views. All public keys derived from your seed phrase or imported into AstroWallet sync
          automatically.
        </p>
      </div>

      <div className="ad-flex-wrap" style={{ gap: 8 }}>
        <button
          type="button"
          className="ad-btn-primary ad-btn-md"
          onClick={() => openTelegramDeepLink(walletConnectUrl)}
        >
          Open AstroWallet to Connect
        </button>
        <button
          type="button"
          className="ad-btn-secondary ad-btn-md"
          onClick={() => void retryAuth()}
        >
          Verify Connection
        </button>
      </div>

      <form onSubmit={(e) => void handleManualConnect(e)} className="ad-flex-6">
        <input
          type="text"
          className="ad-input ad-input-compact"
          placeholder="Or enter @AstroID username / G... public key"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="ad-btn-secondary ad-btn-md" disabled={busy}>
          {busy ? "..." : "Connect"}
        </button>
      </form>

      {feedback && (
        <div className={`ad-banner ${feedback.ok ? "" : "ad-banner--danger"}`}>
          {feedback.text}
        </div>
      )}
    </section>
  );
}

function AstroDexShell() {
  const { config, authStatus, authError, activeTab, setActiveTab, astroId, retryAuth } = useAppState();
  const inTelegram = isInsideTelegramMiniApp();
  const allowed = shouldAllowMiniAppAccess({
    inTelegram,
    allowDevOutsideTelegram: config.allowDevOutsideTelegram,
    authStatus,
  });

  useTelegramBackButton(astroId.found && activeTab !== "radar", () => setActiveTab("radar"));

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
        {!astroId.found ? (
          <AstroWalletLoginGate />
        ) : (
          <>
            {activeTab === "radar" ? (
              <RadarView />
            ) : activeTab === "orders" ? (
              <OrdersAlertsView />
            ) : (
              <TradeChartView />
            )}
          </>
        )}
      </div>
      {astroId.found && <BottomDock />}
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
