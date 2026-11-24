import { Suspense, lazy } from "react";
import { AstroIdHeader } from "./components/AstroIdHeader.js";
import { BottomDock } from "./components/BottomDock.js";
import { TelegramOnlyGate } from "./components/TelegramOnlyGate.js";
import { AppProvider, useAppState } from "./state/app-context.js";
import {
  isInsideTelegramMiniApp,
  shouldAllowMiniAppAccess,
  useTelegramBackButton,
} from "./telegram/webapp.js";
import { RadarView } from "./views/RadarView.js";

const TokenDetailView = lazy(() =>
  import("./views/TokenDetailView.js").then((m) => ({ default: m.TokenDetailView })),
);

function AstroDexShell() {
  const { config, authStatus, authError, activeTab, goBackFromToken, retryAuth } = useAppState();
  const inTelegram = isInsideTelegramMiniApp();
  const allowed = shouldAllowMiniAppAccess({
    inTelegram,
    allowDevOutsideTelegram: config.allowDevOutsideTelegram,
    authStatus,
  });

  const isDetailView =
    activeTab === "token" ||
    activeTab === "trade" ||
    activeTab === "scanner" ||
    activeTab === "book";

  useTelegramBackButton(isDetailView, goBackFromToken);

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
    <main className={`glass-canvas ${isDetailView ? "glass-canvas--no-dock" : ""}`}>
      <div className="ad-shell">
        <AstroIdHeader />
        <Suspense
          fallback={
            <section className="glass-card ad-stack-8" aria-label="Loading view">
              <div className="ad-shimmer" style={{ height: 48 }} />
              <div className="ad-shimmer" style={{ height: 180 }} />
            </section>
          }
        >
          {isDetailView ? (
            <TokenDetailView />
          ) : (
            <RadarView mode={activeTab === "watchlist" ? "watchlist" : "markets"} />
          )}
        </Suspense>
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
