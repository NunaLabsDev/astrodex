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
    feedNetwork,
    setFeedNetwork,
    executionDisabled,
    astroId,
    activeAccount,
    setActiveAccountAddress,
    resolvePublicIdentity,
    disconnectPublicIdentity,
    retryAuth,
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
            <div className="ad-font-extrabold ad-flex-wrap ad-text-lg">
              <span>AstroDex</span>
              <div role="group" aria-label="Stellar Network" className="ad-mode-group">
                <button
                  type="button"
                  className={`glass-pill ad-mode-btn ${feedNetwork === "mainnet" ? "glass-pill--safe" : ""}`}
                  onClick={() => setFeedNetwork("mainnet")}
                >
                  Mainnet
                </button>
                <button
                  type="button"
                  className={`glass-pill ad-mode-btn ${feedNetwork === "testnet" ? "glass-pill--gold" : ""}`}
                  onClick={() => setFeedNetwork("testnet")}
                >
                  Testnet
                </button>
              </div>
            </div>
            <div className="ad-text-xs ad-text-muted">
              {astroId.found && activeAccount
                ? `● AstroWallet Connected · @${astroId.usernameLower ?? "astroid"} · ${shortAddr(activeAccount.address)}`
                : executionDisabled
                  ? "AstroWallet Disconnected · Sign in below"
                  : "Sign in with AstroWallet (@AstroID)"}
            </div>
          </div>
        </div>

        <div className="ad-flex-6">
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
              Pro
            </button>
          </div>
          <button
            type="button"
            className="glass-pill ad-clickable"
            onClick={() => setShowConnectSheet((prev) => !prev)}
          >
            {showConnectSheet
              ? "Close"
              : astroId.found
                ? activeAccount
                  ? shortAddr(activeAccount.address)
                  : "Account"
                : "Menu"}
          </button>
        </div>
      </div>

      {astroId.found && astroId.accounts.length > 0 && (
        <div
          className="ad-flex-wrap"
          style={{
            gap: 6,
            paddingTop: 6,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            alignItems: "center",
          }}
        >
          <span className="ad-text-xs ad-text-muted" style={{ fontWeight: 600 }}>
            AstroWallet Keys:
          </span>
          {astroId.accounts.map((acc, idx) => {
            const isSelected = activeAccount?.address === acc.address;
            return (
              <button
                key={acc.address}
                type="button"
                className={`glass-pill ad-clickable ${isSelected ? "glass-pill--safe" : ""}`}
                onClick={() => setActiveAccountAddress(acc.address)}
                title={acc.address}
              >
                {isSelected ? "● " : ""}
                {acc.label ?? `#${idx + 1}`} ({shortAddr(acc.address)})
              </button>
            );
          })}
        </div>
      )}

      {showConnectSheet && (
        <div className="ad-sub-panel">
          <div className="ad-row ad-row-wrap">
            <div className="ad-flex-wrap">
              <button
                type="button"
                className={`glass-pill ad-clickable ${feedNetwork === "mainnet" ? "glass-pill--safe" : ""}`}
                onClick={() => setFeedNetwork("mainnet")}
              >
                Mainnet
              </button>
              <button
                type="button"
                className={`glass-pill ad-clickable ${feedNetwork === "testnet" ? "glass-pill--gold" : ""}`}
                onClick={() => setFeedNetwork("testnet")}
              >
                Testnet
              </button>
              {astroId.accounts.map((acc) => (
                <button
                  key={acc.address}
                  type="button"
                  className={`glass-pill ad-clickable ${activeAccount?.address === acc.address ? "glass-pill--gold" : ""}`}
                  onClick={() => setActiveAccountAddress(acc.address)}
                >
                  {acc.kind === "smart" ? "C..." : "G..."} {shortAddr(acc.address)}
                </button>
              ))}
            </div>
          </div>

          <div className="ad-text-sm ad-text-muted">
            {executionDisabled
              ? `Read-only ${feedNetwork.toUpperCase()} quotes, charts, orderbooks, and X-Ray scans are active.`
              : `Live ${feedNetwork.toUpperCase()} routing and X-Ray scans active.`}{" "}
            Load any public <code>@AstroID</code> or <code>G...</code>/<code>C...</code> address to inspect orders.
          </div>

          <div className="ad-flex-wrap">
            <button
              type="button"
              className="ad-btn-secondary ad-btn-md"
              onClick={() => {
                retryAuth();
                setLookupFeedback({ ok: true, text: "Syncing active network & keys from AstroWallet..." });
              }}
            >
              🔄 Sync Wallet
            </button>
            <button
              type="button"
              className="ad-btn-secondary ad-btn-md"
              onClick={() => openTelegramDeepLink(walletConnectUrl)}
            >
              Open AstroWallet
            </button>
            {astroGateUrl && (
              <button
                type="button"
                className="ad-btn-secondary ad-btn-md"
                onClick={() => openTelegramDeepLink(astroGateUrl)}
              >
                Open AstroGate
              </button>
            )}
            {astroId.found && (
              <button
                type="button"
                className="ad-btn-secondary ad-btn-md"
                onClick={() => {
                  disconnectPublicIdentity();
                  setLookupFeedback(null);
                }}
              >
                Clear Preview
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
