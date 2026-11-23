import {
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
  } = useAppState();

  const [showConnectSheet, setShowConnectSheet] = useState(false);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupFeedback, setLookupFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const walletConnectUrl = buildAstroWalletOnboardingLink({
    astroWalletBotUsername: config.astroWalletBotUsername,
    astroWalletMiniAppShortName: config.astroWalletMiniAppShortName,
  });

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

  const accountLabel = showConnectSheet
    ? "Close ✕"
    : astroId.found && activeAccount
      ? astroId.usernameLower
        ? `@${astroId.usernameLower} ▾`
        : `${shortAddr(activeAccount.address)} ▾`
      : "Account ▾";

  return (
    <header className="glass-card ad-header-bar ad-stack-10">
      <div className="ad-row">
        <div className="ad-flex-8 ad-min-w-0">
          <div aria-hidden="true" className="ad-avatar-fallback">
            AD
          </div>
          <div className="ad-flex-6 ad-min-w-0">
            <span className="ad-font-extrabold ad-text-base">AstroDex</span>
            <span
              className={`glass-pill ad-net-badge ${
                feedNetwork === "mainnet" ? "glass-pill--safe" : "glass-pill--gold"
              }`}
              title={`Active network: ${feedNetwork}`}
            >
              ● {feedNetwork === "mainnet" ? "Mainnet" : "Testnet"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="glass-pill glass-pill--truncate ad-clickable ad-account-pill"
          onClick={() => setShowConnectSheet((prev) => !prev)}
          aria-expanded={showConnectSheet}
        >
          {accountLabel}
        </button>
      </div>

      {showConnectSheet && (
        <div className="ad-sub-panel ad-stack-10">
          {astroId.found && astroId.accounts.length > 0 && (
            <div className="ad-stack-6">
              <div className="ad-text-xs ad-text-muted ad-font-bold">Active Wallet Key</div>
              <div className="ad-flex-wrap">
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
                      {acc.kind === "smart" ? "C…" : "G…"} {acc.label ?? `#${idx + 1}`} (
                      {shortAddr(acc.address)})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="ad-stack-6">
            <div className="ad-text-xs ad-text-muted ad-font-bold">Network Environment</div>
            <div className="ad-grid-2">
              <button
                type="button"
                className={`ad-btn-secondary ad-btn-sm ${
                  feedNetwork === "mainnet" ? "ad-btn-net-active-mainnet" : ""
                }`}
                onClick={() => setFeedNetwork("mainnet")}
              >
                {feedNetwork === "mainnet" ? "● " : ""}Mainnet (Live)
              </button>
              <button
                type="button"
                className={`ad-btn-secondary ad-btn-sm ${
                  feedNetwork === "testnet" ? "ad-btn-net-active-testnet" : ""
                }`}
                onClick={() => setFeedNetwork("testnet")}
              >
                {feedNetwork === "testnet" ? "● " : ""}Testnet (Sandbox)
              </button>
            </div>
          </div>

          <div className="ad-text-xs ad-text-muted">
            {executionDisabled
              ? `Read-only ${feedNetwork.toUpperCase()} quotes, charts, orderbooks, and X-Ray scans are active.`
              : `Live ${feedNetwork.toUpperCase()} routing and X-Ray scans active.`}
          </div>

          <div className="ad-flex-wrap">
            <button
              type="button"
              className="ad-btn-secondary ad-btn-sm"
              onClick={() => {
                retryAuth();
                setLookupFeedback({ ok: true, text: "Syncing active network & keys from AstroWallet..." });
              }}
            >
              🔄 Sync Wallet
            </button>
            <button
              type="button"
              className="ad-btn-secondary ad-btn-sm"
              onClick={() => openTelegramDeepLink(walletConnectUrl)}
            >
              Open AstroWallet
            </button>
            {astroId.found && (
              <button
                type="button"
                className="ad-btn-secondary ad-btn-sm"
                onClick={() => {
                  disconnectPublicIdentity();
                  setLookupFeedback(null);
                  setShowConnectSheet(false);
                }}
              >
                Disconnect
              </button>
            )}
          </div>

          <form onSubmit={(e) => void handleResolveSubmit(e)} className="ad-flex-6">
            <input
              type="text"
              className="ad-input ad-input-compact"
              placeholder="Inspect @AstroID or public G... / C... address"
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
