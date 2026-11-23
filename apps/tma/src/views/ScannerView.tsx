import type { TokenForensicAudit } from "@astrodex/domain";
import { useEffect, useState } from "react";
import { TokenSearchInput } from "../components/TokenSearchInput.js";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink, triggerTelegramHaptic } from "../telegram/webapp.js";

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function ScannerView() {
  const {
    config,
    feedNetwork,
    executionDisabled,
    selectedAsset,
    setSelectedAsset,
    setActiveTab,
    activeAccount,
    sessionToken,
  } = useAppState();
  const [searchQuery, setSearchQuery] = useState("");
  const [audit, setAudit] = useState<TokenForensicAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttlStatusMsg, setTtlStatusMsg] = useState<string | null>(null);
  const [extendingTtl, setExtendingTtl] = useState(false);
  const [rawXdrInput, setRawXdrInput] = useState("");
  const [rawXdrJson, setRawXdrJson] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function runScan() {
      setLoading(true);
      setError(null);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(
          `${base}/v1/scanner/${encodeURIComponent(selectedAsset || "XLM")}?net=${encodeURIComponent(feedNetwork)}`,
        );
        const json = (await res.json()) as { audit?: TokenForensicAudit; error?: string };
        if (!res.ok || !json.audit) {
          throw new Error(json.error ?? "Scan failed");
        }
        if (!cancelled) setAudit(json.audit);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to run X-Ray scan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void runScan();
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, feedNetwork, selectedAsset]);

  const handleCopy = async (val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedId(true);
      triggerTelegramHaptic("selection");
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      // Clipboard unavailable
    }
  };

  const handleInspectRawXdr = async () => {
    if (!rawXdrInput.trim()) return;
    // Lazy load @astrodex/security-shield worker helper on demand only
    const { inspectRawXdrInWorker } = await import("@astrodex/security-shield");
    const pretty = await inspectRawXdrInWorker(rawXdrInput.trim(), config.networkPassphrase);
    setRawXdrJson(pretty);
  };

  const handleExtendTtl = async (contractId: string) => {
    if (!activeAccount || !sessionToken) {
      setError("Open inside Telegram and connect AstroWallet (AstroID) to extend contract TTL.");
      return;
    }
    setExtendingTtl(true);
    setError(null);
    setTtlStatusMsg(null);
    try {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/v1/intents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "soroban_extend_ttl",
          sourceAddress: activeAccount.address,
          extendTtlContractId: contractId,
          humanSummary: `Extend Protocol 23 TTL for ${audit?.code ?? contractId}`,
          returnStartAppParam: `scan_${contractId}`,
        }),
      });
      const json = (await res.json()) as { deepLink?: string; error?: string };
      if (!res.ok || !json.deepLink) {
        throw new Error(json.error ?? "Failed to create TTL extension intent");
      }
      triggerTelegramHaptic("success");
      setTtlStatusMsg("Opening AstroWallet to sign Protocol 23 TTL extension...");
      openTelegramDeepLink(json.deepLink);
    } catch (err) {
      triggerTelegramHaptic("error");
      setError(err instanceof Error ? err.message : "TTL extension failed");
    } finally {
      setExtendingTtl(false);
    }
  };

  return (
    <div className="ad-stack-12">
      <section className="glass-card ad-stack-8">
        <TokenSearchInput
          query={searchQuery}
          onQueryChange={setSearchQuery}
          placeholder="Scan by name/ticker (ASTRO, USDC, STELA) or CODE:G... / C..."
          submitLabel="Scan"
          primaryActionLabel="Scan"
          secondaryActionLabel="Trade"
          onSelectToken={(item, action) => {
            setSelectedAsset(item.assetKey);
            setSearchQuery("");
            if (action === "secondary") {
              setActiveTab("trade");
            }
          }}
          onSubmitRaw={(raw, bestMatch) => {
            setSelectedAsset(bestMatch ? bestMatch.assetKey : raw);
            setSearchQuery("");
          }}
        />
      </section>

      <section className="glass-card ad-scanner-matrix">
        <div className="ad-row">
          <div>
            <div className="ad-text-sm ad-text-muted">SDEX Reboot + Soroban X-Ray</div>
            <h2 className="ad-heading-sm">
              {audit ? `${audit.code}${audit.name ? ` · ${audit.name}` : ""} (${audit.kind.toUpperCase()})` : selectedAsset}
            </h2>
          </div>
          {audit && (
            <span
              className={`glass-pill ${
                audit.verdict === "safe"
                  ? "glass-pill--safe"
                  : audit.verdict === "malicious"
                    ? "glass-pill--danger"
                    : "glass-pill--gold"
              }`}
            >
              Shield {audit.astroShieldScore}/100
            </span>
          )}
        </div>

        {audit && (
          <div className="ad-row ad-row-wrap">
            <div className="ad-flex-wrap">
              <button
                type="button"
                className="glass-pill ad-clickable"
                onClick={() => void handleCopy(audit.assetKey)}
              >
                {copiedId ? "Copied!" : `ID: ${shortId(audit.assetKey)}`}
              </button>
              <span className="glass-pill">Tier: {audit.trustTier}</span>
              <span className="glass-pill">Decimals: {audit.decimals}</span>
            </div>
            {audit.assetKey !== "XLM" && (
              <div className="ad-flex-6">
                <button
                  type="button"
                  className="ad-btn-secondary ad-btn-sm"
                  onClick={() => {
                    setSelectedAsset(audit.assetKey);
                    setActiveTab("trade");
                  }}
                >
                  Trade
                </button>
                <button
                  type="button"
                  className="glass-pill ad-clickable"
                  onClick={() => {
                    setSelectedAsset(audit.assetKey);
                    setActiveTab("book");
                  }}
                >
                  Book
                </button>
              </div>
            )}
          </div>
        )}

        {loading && <div className="ad-banner">Auditing Issuer Lock, SEP-42, and Soroban TTL...</div>}
        {error && <div className="ad-banner ad-banner--danger">{error}</div>}

        {audit && (
          <div className="ad-stack-8">
            {audit.basicSummary.map((item) => (
              <div key={item.label} className="ad-banner">
                <strong>{item.passed ? "PASS" : "WARN"} · {item.label}:</strong> {item.detail}
              </div>
            ))}

            {audit.findings.map((f) => (
              <div
                key={f.code}
                className={`ad-banner ${
                  f.severity === "malicious" ? "ad-banner--danger" : "ad-banner--warn"
                }`}
              >
                <strong>{f.title}:</strong> {f.description}
              </div>
            ))}

            {audit.classicAudit && (
              <div className="ad-banner tabular-nums">
                <strong>Classic Issuer Lock Matrix:</strong> Locked={String(audit.classicAudit.locked)} ·
                MasterWeight={audit.classicAudit.masterWeight} · SecondarySum={audit.classicAudit.combinedSecondaryWeight} ·
                LowThreshold={audit.classicAudit.lowThreshold} · Clawback={String(audit.classicAudit.flags.authClawbackEnabled)}
              </div>
            )}

            {audit.sorobanAudit?.ttlStatus && (
              <div className="ad-banner tabular-nums ad-stack-6">
                <div>
                  <strong>Protocol 23 TTL Status:</strong>{" "}
                  {audit.sorobanAudit.ttlStatus.approxDaysRemaining !== null
                    ? `~${audit.sorobanAudit.ttlStatus.approxDaysRemaining} days left (Ledger ${audit.sorobanAudit.ttlStatus.liveUntilLedgerSeq})`
                    : `Active on Ledger ${audit.sorobanAudit.ttlStatus.currentLedger || "live"}`}
                </div>
                {audit.contractId && (
                  <button
                    type="button"
                    className="ad-btn-secondary"
                    disabled={executionDisabled || extendingTtl}
                    onClick={() => void handleExtendTtl(audit.contractId!)}
                  >
                    {executionDisabled
                      ? "🔒 TTL Extension Paused (Visualizer Mode)"
                      : extendingTtl
                        ? "Building ExtendFootprintTtl..."
                        : "Extend Contract TTL via AstroWallet"}
                  </button>
                )}
              </div>
            )}
            {ttlStatusMsg && <div className="ad-banner">{ttlStatusMsg}</div>}
          </div>
        )}
      </section>

      <section className="glass-card ad-stack-8">
        <strong className="ad-text-base">Lazy Web Worker Raw XDR Inspector</strong>
        <textarea
          className="ad-input"
          rows={3}
          placeholder="Paste Base64 TransactionEnvelope XDR..."
          value={rawXdrInput}
          onChange={(e) => setRawXdrInput(e.target.value)}
        />
        <button
          type="button"
          className="ad-btn-secondary"
          onClick={() => void handleInspectRawXdr()}
        >
          Decode Raw XDR
        </button>
        {rawXdrJson && <pre className="ad-code-block">{rawXdrJson}</pre>}
      </section>
    </div>
  );
}
