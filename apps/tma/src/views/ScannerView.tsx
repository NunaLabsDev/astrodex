import type { TokenForensicAudit } from "@astrodex/domain";
import { useEffect, useState } from "react";
import { useAppState } from "../state/app-context.js";

export function ScannerView() {
  const { config, mode, selectedAsset } = useAppState();
  const [audit, setAudit] = useState<TokenForensicAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawXdrInput, setRawXdrInput] = useState("");
  const [rawXdrJson, setRawXdrJson] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function runScan() {
      setLoading(true);
      setError(null);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/scanner/${encodeURIComponent(selectedAsset || "XLM")}`);
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
  }, [config.apiBaseUrl, selectedAsset]);

  const handleInspectRawXdr = async () => {
    if (!rawXdrInput.trim()) return;
    // Lazy load @astrodex/security-shield worker helper on demand only
    const { inspectRawXdrInWorker } = await import("@astrodex/security-shield");
    const pretty = await inspectRawXdrInWorker(rawXdrInput.trim(), config.networkPassphrase);
    setRawXdrJson(pretty);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="glass-card ad-scanner-matrix">
        <div className="ad-row">
          <div>
            <div style={{ fontSize: 12, color: "var(--ad-ink-secondary)" }}>
              SDEX Reboot + Soroban X-Ray
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: 18 }}>
              {audit ? `${audit.code} (${audit.kind.toUpperCase()})` : selectedAsset}
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

        {loading && <div className="ad-banner">Auditing Issuer Lock, SEP-42, and Soroban TTL...</div>}
        {error && <div className="ad-banner ad-banner--danger">{error}</div>}

        {audit && (
          <div style={{ display: "grid", gap: 8 }}>
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

            {mode === "pro" && audit.classicAudit && (
              <div className="ad-banner tabular-nums">
                <strong>Classic Issuer Lock Matrix:</strong> Locked={String(audit.classicAudit.locked)} ·
                MasterWeight={audit.classicAudit.masterWeight} · SecondarySum={audit.classicAudit.combinedSecondaryWeight} ·
                LowThreshold={audit.classicAudit.lowThreshold} · Clawback={String(audit.classicAudit.flags.authClawbackEnabled)}
              </div>
            )}

            {mode === "pro" && audit.sorobanAudit?.ttlStatus && (
              <div className="ad-banner tabular-nums">
                <strong>Protocol 23 TTL Status:</strong>{" "}
                {audit.sorobanAudit.ttlStatus.approxDaysRemaining !== null
                  ? `~${audit.sorobanAudit.ttlStatus.approxDaysRemaining} days left (Ledger ${audit.sorobanAudit.ttlStatus.liveUntilLedgerSeq})`
                  : "TTL unavailable"}
              </div>
            )}
          </div>
        )}
      </section>

      {mode === "pro" && (
        <section className="glass-card" style={{ display: "grid", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>Lazy Web Worker Raw XDR Inspector</strong>
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
          {rawXdrJson && (
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                overflowX: "auto",
                background: "rgba(11,20,51,0.8)",
                padding: 10,
                borderRadius: 12,
              }}
            >
              {rawXdrJson}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
