import type { TmaConfig } from "@astrodex/domain";
import { buildAstroDexDeepLink } from "@astrodex/tg-protocol";
import type { TelegramAuthStatus } from "../telegram/webapp.js";

export function TelegramOnlyGate({
  config,
  authStatus,
  authError,
  onRetry,
}: {
  config: TmaConfig;
  authStatus: TelegramAuthStatus;
  authError: string | null;
  onRetry?: () => void;
}) {
  const deepLink = buildAstroDexDeepLink({
    tgBotUsername: config.tgBotUsername,
    tgMiniAppShortName: config.tgMiniAppShortName,
  });

  return (
    <main className="glass-canvas">
      <div className="ad-shell ad-gate-shell">
        <section
          className="glass-sheet ad-stack-12 ad-text-center"
          aria-label="Open AstroDex Inside Telegram"
        >
          <div>
            <span className="glass-pill glass-pill--gold">
              Telegram-Exclusive Terminal · {config.network.toUpperCase()}
            </span>
          </div>
          <h1 className="ad-heading-lg">
            {authStatus === "checking"
              ? "Verifying Telegram Session..."
              : authStatus === "error"
                ? "Session Verification Failed"
                : "Open AstroDex Inside Telegram"}
          </h1>
          <p className="ad-text-lead">
            {authStatus === "checking"
              ? "Validating cryptographic Telegram initData and resolving your AstroID profile."
              : "AstroDex runs exclusively inside Telegram with AstroWallet AstroID SSO and zero local private keys."}
          </p>
          {authError && <div className="ad-banner ad-banner--danger">{authError}</div>}
          {authStatus !== "checking" && (
            <div className="ad-stack-8">
              <a href={deepLink} className="ad-btn-primary">
                Launch @{config.tgBotUsername}
              </a>
              {authStatus === "error" && onRetry && (
                <button type="button" className="ad-btn-secondary" onClick={onRetry}>
                  Retry Verification
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
