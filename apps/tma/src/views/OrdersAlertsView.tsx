import type { OpenLimitOffer } from "@astrodex/domain";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink, triggerTelegramHaptic } from "../telegram/webapp.js";

interface PriceAlertItem {
  id: string;
  assetKey: string;
  condition: "above" | "below";
  threshold: number;
}

export function OrdersAlertsView() {
  const { config, sessionToken, activeAccount, catalog, selectedAsset } = useAppState();
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<PriceAlertItem[]>([]);
  const [offers, setOffers] = useState<OpenLimitOffer[]>([]);
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("above");
  const [alertThreshold, setAlertThreshold] = useState("0.20");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const base = config.apiBaseUrl.replace(/\/+$/, "");

  const loadData = useCallback(async () => {
    const tasks: Array<Promise<void>> = [];

    if (sessionToken) {
      tasks.push(
        fetch(`${base}/v1/watchlists`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        })
          .then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as { items?: string[] };
            if (json.items) setWatchlist(json.items);
          })
          .catch(() => {}),
      );
      tasks.push(
        fetch(`${base}/v1/alerts`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        })
          .then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as { alerts?: PriceAlertItem[] };
            if (json.alerts) setAlerts(json.alerts);
          })
          .catch(() => {}),
      );
    }

    if (activeAccount?.kind === "classic") {
      tasks.push(
        fetch(`${base}/v1/orders/${encodeURIComponent(activeAccount.address)}`)
          .then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as { offers?: OpenLimitOffer[] };
            if (json.offers) setOffers(json.offers);
          })
          .catch(() => {}),
      );
    } else {
      setOffers([]);
    }

    await Promise.all(tasks);
  }, [activeAccount, base, sessionToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeToken = catalog.find((t) => t.assetKey === selectedAsset);

  const handleToggleWatchlist = async () => {
    if (!sessionToken) return;
    const exists = watchlist.includes(selectedAsset);
    setBusyId("watchlist");
    setErrorMsg(null);
    try {
      const res = await fetch(
        exists
          ? `${base}/v1/watchlists/${encodeURIComponent(selectedAsset)}`
          : `${base}/v1/watchlists`,
        {
          method: exists ? "DELETE" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          ...(exists ? {} : { body: JSON.stringify({ assetKey: selectedAsset }) }),
        },
      );
      if (res.ok) {
        triggerTelegramHaptic("selection");
        await loadData();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAlert = async (e: FormEvent) => {
    e.preventDefault();
    const thresholdNum = Number(alertThreshold);
    if (!sessionToken || !Number.isFinite(thresholdNum) || thresholdNum <= 0) return;
    setBusyId("create-alert");
    setErrorMsg(null);
    try {
      const res = await fetch(`${base}/v1/alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          assetKey: selectedAsset,
          condition: alertCondition,
          threshold: thresholdNum,
        }),
      });
      if (!res.ok) throw new Error("Failed to create alert");
      triggerTelegramHaptic("success");
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save alert");
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteAlert = async (alertId: string) => {
    if (!sessionToken) return;
    setBusyId(alertId);
    try {
      await fetch(`${base}/v1/alerts/${encodeURIComponent(alertId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      triggerTelegramHaptic("selection");
      await loadData();
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelOffer = async (offer: OpenLimitOffer) => {
    if (!activeAccount || activeAccount.kind !== "classic" || !sessionToken) {
      setErrorMsg("Connect your Classic G... AstroWallet account inside Telegram to cancel offers.");
      return;
    }
    setBusyId(offer.offerId);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await fetch(`${base}/v1/intents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          subAction: "sdex_limit_order_cancel",
          sourceAddress: activeAccount.address,
          limitOrder: {
            side: "sell",
            baseAsset: offer.sellingAsset,
            quoteAsset: offer.buyingAsset,
            amount: "0",
            price: offer.price,
            offerId: offer.offerId,
          },
          humanSummary: `Cancel SDEX Offer #${offer.offerId} (${offer.sellingAsset} -> ${offer.buyingAsset})`,
          returnStartAppParam: "t-orders",
        }),
      });
      const json = (await res.json()) as { deepLink?: string; error?: string };
      if (!res.ok || !json.deepLink) {
        throw new Error(json.error ?? "Failed to create cancel intent");
      }
      triggerTelegramHaptic("success");
      setStatusMsg(`Opening AstroWallet to cancel offer #${offer.offerId}...`);
      openTelegramDeepLink(json.deepLink);
    } catch (err) {
      triggerTelegramHaptic("error");
      setErrorMsg(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 15 }}>Open Orders &amp; Alerts</strong>
          <span className="glass-pill">
            {activeAccount ? activeAccount.kind.toUpperCase() : "READ-ONLY"}
          </span>
        </div>

        <div className="ad-banner">
          {activeAccount
            ? `Monitoring ${activeAccount.kind === "classic" ? "Classic SDEX offers" : "Soroban account"} for ${activeAccount.address.slice(0, 6)}...${activeAccount.address.slice(-4)}.`
            : "Connect your AstroWallet (AstroID) inside Telegram to manage SDEX offers, watchlists, and alerts."}
        </div>

        {errorMsg && <div className="ad-banner ad-banner--danger">{errorMsg}</div>}
        {statusMsg && <div className="ad-banner">{statusMsg}</div>}

        <div className="ad-row">
          <strong style={{ fontSize: 13 }}>Classic SDEX Open Offers ({offers.length})</strong>
          {activeAccount && (
            <button
              type="button"
              className="glass-pill"
              style={{ cursor: "pointer" }}
              onClick={() => void loadData()}
            >
              Refresh
            </button>
          )}
        </div>

        {offers.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ad-ink-secondary)" }}>
            No open Classic SDEX offers found.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {offers.map((offer) => (
              <div
                key={offer.offerId}
                className="ad-row"
                style={{
                  padding: "8px 10px",
                  borderRadius: 12,
                  background: "rgba(11, 20, 51, 0.65)",
                  border: "1px solid rgba(165, 139, 224, 0.2)",
                }}
              >
                <div style={{ fontSize: 12 }} className="tabular-nums">
                  <strong>#{offer.offerId}</strong> · {offer.amount} {offer.sellingAsset.split(":")[0]} @{" "}
                  {offer.price} {offer.buyingAsset.split(":")[0]}
                </div>
                <button
                  type="button"
                  className="ad-btn-secondary"
                  disabled={busyId === offer.offerId}
                  onClick={() => void handleCancelOffer(offer)}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass-card" style={{ display: "grid", gap: 10 }}>
        <div className="ad-row">
          <strong style={{ fontSize: 14 }}>
            Watchlist ({watchlist.length}) &amp; Alerts ({alerts.length})
          </strong>
          {sessionToken && (
            <button
              type="button"
              className="ad-btn-secondary"
              disabled={busyId === "watchlist"}
              onClick={() => void handleToggleWatchlist()}
            >
              {watchlist.includes(selectedAsset)
                ? `Unwatch ${activeToken?.code ?? selectedAsset}`
                : `+ Watch ${activeToken?.code ?? selectedAsset}`}
            </button>
          )}
        </div>

        {sessionToken && (
          <form
            onSubmit={(e) => void handleCreateAlert(e)}
            style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: 6 }}
          >
            <select
              className="ad-input"
              value={alertCondition}
              onChange={(e) => setAlertCondition(e.target.value as "above" | "below")}
              aria-label="Alert Condition"
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
            <input
              type="text"
              className="ad-input tabular-nums"
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
              placeholder="Threshold in XLM"
              aria-label="Alert Threshold"
            />
            <button type="submit" className="ad-btn-primary" disabled={busyId === "create-alert"}>
              Set Alert
            </button>
          </form>
        )}

        {alerts.map((al) => (
          <div key={al.id} className="ad-row ad-banner tabular-nums">
            <span>
              {al.assetKey.split(":")[0]} {al.condition} {al.threshold} XLM
            </span>
            <button
              type="button"
              className="glass-pill"
              style={{ cursor: "pointer" }}
              disabled={busyId === al.id}
              onClick={() => void handleDeleteAlert(al.id)}
            >
              Remove
            </button>
          </div>
        ))}

        {watchlist.length > 0 && (
          <div className="ad-chip-row">
            {watchlist.map((item) => (
              <span key={item} className="glass-pill">
                ★ {item.split(":")[0]}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
