import {
  buildAstroGateDeepLink,
  buildAstroWalletOnboardingLink,
} from "@astrodex/tg-protocol";
import { useState, type FormEvent } from "react";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink } from "../telegram/webapp.js";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function AstroIdHeader() {
  const {
    config,
    astroId,
    activeAccount,
    setActiveAccountAddress,
    resolvePublicIdentity,
    disconnectPublicIdentity,
    mode,
    setMode,
  } = useAppState();

  const [showConnectSheet, setShowConnectSheet] = useState(false);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupFeedback, setLookupFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const walletConnectUrl = buildAstroWalletOnboardingLink({
    astroWalletBotUsername: config.astroWalletBotUsername,
    astroWalletMiniAppShortName: config.astroWalletMiniAppShortName,
  });

  const astroGateUrl = config.astroGateBotUsername
    ? buildAstroGateDeepLink({
        astroGateBotUsername: config.astroGateBotUsername,
        startParam: "launch",
      })
    : null;

  const handleResolveSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!lookupInput.trim()) return;
    setLookupBusy(true);
    setLookupFeedback(null);
    const res = await resolvePublicIdentity(lookupInput);
    setLookupFeedback({ ok: res.ok, text: res.message });
    setLookupBusy(false);
    if (res.ok) {
      setLookupInput("");
    }
  };

  return (
    <header className="glass-card ad-stack-10">
      <div className="ad-row">
        <div className="ad-flex-8 ad-min-w-0">
          {astroId.sorobitSvg ? (
            <img
              alt="Sorobit Avatar"
              src={`data:image/svg+xml;utf8,${encodeURIComponent(astroId.sorobitSvg)}`}
              className="ad-avatar"
            />
          ) : (
            <div aria-hidden="true" className="ad-avatar-fallback">
              AD
            </div>
          )}
          <div className="ad-min-w-0">
            <div className="ad-lg ad-font-extrabold ad-flex-6 ad-text-lg">
              <span>AstroDex</span>
              <span className="glass-pill">{config.network.toUpperCase()}</span>
            </div>
            <div className="ad-text-xs ad-text-muted">
              {astroId.found && activeAccount
                ? `@${astroId.usernameLower ?? "astroid"} · ${shortAddr(activeAccount.address)}`
                : "Read-Only Mode · Tap Connect for AstroID"}
            </div>
          </div>
        </div>

        <div role="group" aria-label="UI Disclosure Mode" className="ad-mode-group">
          <button
            type="button"
            className={`glass-pill ad-mode-btn ${mode === "basic" ? "ad-mode-btn--basic-active" : ""}`}
            onClick={() => setMode("basic")}
          >
            Basic
          </button>
          <button
            type="button"
            className={`glass-pill ad-mode-btn ${mode === "pro" ? "ad-mode-btn--pro-active" : ""}`}
            onClick={() => setMode("pro")}
          >
            Pro Scanner
          </button>
        </div>
      </div>

      <div className="ad-row ad-row-wrap">
        <div className="ad-flex-wrap">
          {astroId.accounts.length > 0 ? (
            astroId.accounts.map((acc) => (
              <button
                key={acc.address}
                type="button"
                className={`glass-pill ad-clickable ${activeAccount?.address === acc.address ? "glass-pill--gold" : ""}`}
                onClick={() => setActiveAccountAddress(acc.address)}
              >
                {acc.kind === "smart" ? "C... Smart" : "G... Classic"} {shortAddr(acc.address)}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="glass-pill glass-pill--gold ad-clickable"
              onClick={() => setShowConnectSheet((prev) => !prev)}
            >
              ⚡ Connect AstroID / Address
            </button>
          )}
        </div>

        <div className="ad-flex-6">
          <button
            type="button"
            className="glass-pill ad-clickable"
            onClick={() => setShowConnectSheet((prev) => !prev)}
          >
            {showConnectSheet ? "Close" : astroId.found ? "Switch" : "Lookup"}
          </button>
          <button
            type="button"
            className="glass-pill ad-clickable"
            onClick={() => openTelegramDeepLink(walletConnectUrl)}
          >
            Wallet
          </button>
          {astroGateUrl && (
            <button
              type="button"
              className="glass-pill ad-clickable"
              onClick={() => openTelegramDeepLink(astroGateUrl)}
            >
              Launchpad
            </button>
          )}
        </div>
      </div>

      {showConnectSheet && (
        <div className="ad-sub-panel">
          <div className="ad-text-sm ad-text-muted">
            Non-custodial SSO powered exclusively by <strong>AstroWallet</strong>. Sign transactions inside Telegram or preview any public <code>@AstroID</code> / <code>G...</code> / <code>C...</code> address.
          </div>

          <div className="ad-flex-wrap">
            <button
              type="button"
              className="ad-btn-primary ad-btn-md"
              onClick={() => openTelegramDeepLink(walletConnectUrl)}
            >
              Open AstroWallet SSO
            </button>
            {astroId.found && (
              <button
                type="button"
                className="ad-btn-secondary ad-btn-md"
                onClick={() => {
                  disconnectPublicIdentity();
                  setLookupFeedback(null);
                }}
              >
                Disconnect Preview
              </button>
            )}
          </div>

          <form onSubmit={(e) => void handleResolveSubmit(e)} className="ad-flex-6">
            <input
              type="text"
              className="ad-input ad-input-compact"
              placeholder="@AstroID username or public G... / C... address"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
            />
            <button
              type="submit"
              className="ad-btn-secondary ad-btn-md"
              disabled={lookupBusy}
            >
              {lookupBusy ? "..." : "Load"}
            </button>
          </form>

          {lookupFeedback && (
            <div className={`ad-banner ${lookupFeedback.ok ? "" : "ad-banner--danger"}`}>
              {lookupFeedback.text}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
