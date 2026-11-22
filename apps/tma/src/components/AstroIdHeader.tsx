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
    <header className="glass-card" style={{ display: "grid", gap: 10 }}>
      <div className="ad-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {astroId.sorobitSvg ? (
            <img
              alt="Sorobit Avatar"
              src={`data:image/svg+xml;utf8,${encodeURIComponent(astroId.sorobitSvg)}`}
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              aria-hidden="true"
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: "var(--ad-grad-aurora)",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              AD
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
              <span>AstroDex</span>
              <span className="glass-pill">{config.network.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--ad-ink-secondary)" }}>
              {astroId.found && activeAccount
                ? `@${astroId.usernameLower ?? "astroid"} · ${shortAddr(activeAccount.address)}`
                : "Read-Only Mode · Tap Connect for AstroID"}
            </div>
          </div>
        </div>

        <div
          role="group"
          aria-label="UI Disclosure Mode"
          style={{
            display: "inline-flex",
            padding: 3,
            borderRadius: 999,
            background: "rgba(11, 20, 51, 0.72)",
            border: "1px solid rgba(165, 139, 224, 0.28)",
          }}
        >
          <button
            type="button"
            className="glass-pill"
            onClick={() => setMode("basic")}
            style={{
              border: "none",
              cursor: "pointer",
              background: mode === "basic" ? "var(--ad-solar-blaze)" : "transparent",
              color: mode === "basic" ? "#fff" : "var(--ad-ink-secondary)",
            }}
          >
            Basic
          </button>
          <button
            type="button"
            className="glass-pill"
            onClick={() => setMode("pro")}
            style={{
              border: "none",
              cursor: "pointer",
              background: mode === "pro" ? "var(--ad-cosmic-purple)" : "transparent",
              color: mode === "pro" ? "#fff" : "var(--ad-ink-secondary)",
            }}
          >
            Pro Scanner
          </button>
        </div>
      </div>

      <div className="ad-row" style={{ flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {astroId.accounts.length > 0 ? (
            astroId.accounts.map((acc) => (
              <button
                key={acc.address}
                type="button"
                className={`glass-pill ${activeAccount?.address === acc.address ? "glass-pill--gold" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setActiveAccountAddress(acc.address)}
              >
                {acc.kind === "smart" ? "C... Smart" : "G... Classic"} {shortAddr(acc.address)}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="glass-pill glass-pill--gold"
              style={{ cursor: "pointer" }}
              onClick={() => setShowConnectSheet((prev) => !prev)}
            >
              ⚡ Connect AstroID / Address
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="glass-pill"
            style={{ cursor: "pointer" }}
            onClick={() => setShowConnectSheet((prev) => !prev)}
          >
            {showConnectSheet ? "Close" : astroId.found ? "Switch" : "Lookup"}
          </button>
          <button
            type="button"
            className="glass-pill"
            style={{ cursor: "pointer" }}
            onClick={() => openTelegramDeepLink(walletConnectUrl)}
          >
            Wallet
          </button>
          {astroGateUrl && (
            <button
              type="button"
              className="glass-pill"
              style={{ cursor: "pointer" }}
              onClick={() => openTelegramDeepLink(astroGateUrl)}
            >
              Launchpad
            </button>
          )}
        </div>
      </div>

      {showConnectSheet && (
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: 10,
            borderRadius: 14,
            background: "rgba(11, 20, 51, 0.78)",
            border: "1px solid rgba(165, 139, 224, 0.3)",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--ad-ink-secondary)" }}>
            Non-custodial SSO powered exclusively by <strong>AstroWallet</strong>. Sign transactions inside Telegram or preview any public <code>@AstroID</code> / <code>G...</code> / <code>C...</code> address.
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="ad-btn-primary"
              style={{ minHeight: 38, fontSize: 13 }}
              onClick={() => openTelegramDeepLink(walletConnectUrl)}
            >
              Open AstroWallet SSO
            </button>
            {astroId.found && (
              <button
                type="button"
                className="ad-btn-secondary"
                style={{ minHeight: 38, fontSize: 12 }}
                onClick={() => {
                  disconnectPublicIdentity();
                  setLookupFeedback(null);
                }}
              >
                Disconnect Preview
              </button>
            )}
          </div>

          <form onSubmit={(e) => void handleResolveSubmit(e)} style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              className="ad-input"
              style={{ minHeight: 38 }}
              placeholder="@AstroID username or public G... / C... address"
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
            />
            <button
              type="submit"
              className="ad-btn-secondary"
              style={{ minHeight: 38 }}
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
