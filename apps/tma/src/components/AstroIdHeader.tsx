import {
  buildAstroGateDeepLink,
  buildAstroWalletOnboardingLink,
} from "@astrodex/tg-protocol";
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
    mode,
    setMode,
  } = useAppState();

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

  return (
    <header className="glass-card" style={{ display: "grid", gap: 10 }}>
      <div className="ad-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {astroId.sorobitSvg ? (
            <div
              aria-label="Sorobit Avatar"
              style={{ width: 32, height: 32, borderRadius: 10, overflow: "hidden", flexShrink: 0 }}
              dangerouslySetInnerHTML={{ __html: astroId.sorobitSvg }}
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
                : "Read-Only Mode · Connect via AstroWallet"}
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
                {acc.kind === "smart" ? "C..." : "G..."} {shortAddr(acc.address)}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="glass-pill glass-pill--gold"
              style={{ cursor: "pointer" }}
              onClick={() => openTelegramDeepLink(walletConnectUrl)}
            >
              Connect AstroWallet (AstroID)
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
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
    </header>
  );
}
