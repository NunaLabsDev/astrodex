import type { OpenLimitOffer } from "@astrodex/domain";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { TokenSearchInput } from "../components/TokenSearchInput.js";
import { useAppState } from "../state/app-context.js";
import { openTelegramDeepLink, triggerTelegramHaptic } from "../telegram/webapp.js";

interface PriceAlertItem {
  id: string;
  assetKey: string;
  condition: "above" | "below";
  threshold: number;
}

const LOCAL_WATCHLIST_KEY = "astrodex_local_watchlist_v1";
const LOCAL_ALERTS_KEY = "astrodex_local_alerts_v1";

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore restricted storage environments
  }
}

export function OrdersAlertsView() {
  const {
    config,
    feedNetwork,
    executionDisabled,
    sessionToken,
    activeAccount,
    catalog,
    selectedAsset,
    setSelectedAsset,
    setActiveTab,
    setMode,
  } = useAppState();
  const [watchlist, setWatchlist] = useState<string[]>(() =>
    readLocalJson<string[]>(LOCAL_WATCHLIST_KEY, []),
  );
  const [alerts, setAlerts] = useState<PriceAlertItem[]>(() =>
    readLocalJson<PriceAlertItem[]>(LOCAL_ALERTS_KEY, []),
  );
  const [offers, setOffers] = useState<OpenLimitOffer[]>([]);
  const [accountFunded, setAccountFunded] = useState<boolean>(true);
  const [alertQuery, setAlertQuery] = useState("");
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
        fetch(
          `${base}/v1/orders/${encodeURIComponent(activeAccount.address)}?net=${encodeURIComponent(feedNetwork)}`,
        )
          .then(async (r) => {
            if (!r.ok) return;
            const json = (await r.json()) as { offers?: OpenLimitOffer[]; accountFunded?: boolean };
            if (json.offers) setOffers(json.offers);
            if (typeof json.accountFunded === "boolean") setAccountFunded(json.accountFunded);
          })
          .catch(() => {}),
      );
    } else {
      setOffers([]);
      setAccountFunded(true);
    }

    await Promise.all(tasks);
  }, [activeAccount, base, feedNetwork, sessionToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeToken = catalog.find((t) => t.assetKey === selectedAsset);

  const handleToggleWatchlist = async () => {
    const exists = watchlist.includes(selectedAsset);
    if (!sessionToken) {
      const next = exists
        ? watchlist.filter((x) => x !== selectedAsset)
        : [selectedAsset, ...watchlist];
      setWatchlist(next);
      writeLocalJson(LOCAL_WATCHLIST_KEY, next);
      triggerTelegramHaptic("selection");
      return;
    }
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
    if (!Number.isFinite(thresholdNum) || thresholdNum <= 0) {
      setErrorMsg("Enter a valid positive XLM price threshold.");
      return;
    }
    if (!sessionToken) {
      const localItem: PriceAlertItem = {
        id: `local_${Date.now()}`,
        assetKey: selectedAsset,
        condition: alertCondition,
        threshold: thresholdNum,
      };
      const next = [localItem, ...alerts];
      setAlerts(next);
      writeLocalJson(LOCAL_ALERTS_KEY, next);
      setStatusMsg(`Saved local price alert for ${activeToken?.code ?? selectedAsset}.`);
      triggerTelegramHaptic("success");
      return;
    }
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
    if (!sessionToken) {
      const next = alerts.filter((a) => a.id !== alertId);
      setAlerts(next);
      writeLocalJson(LOCAL_ALERTS_KEY, next);
      triggerTelegramHaptic("selection");
      return;
    }
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
    <div className="ad-stack-12">
      <section className="glass-card ad-stack-10">
        <div className="ad-row">
          <strong className="ad-text-lg">Open Orders &amp; Alerts</strong>
          <span className="glass-pill">
            {activeAccount ? activeAccount.kind.toUpperCase() : "READ-ONLY"}
          </span>
        </div>

        <div className="ad-banner">
          {activeAccount
            ? `Monitoring ${activeAccount.kind === "classic" ? "Classic SDEX offers" : "Soroban account"} for ${activeAccount.address.slice(0, 6)}...${activeAccount.address.slice(-4)}.`
            : "Tap 'Connect AstroID / Address' above to load live Classic G... SDEX offers, or manage local Watchlists & Alerts below."}
        </div>

        {errorMsg && <div className="ad-banner ad-banner--danger">{errorMsg}</div>}
        {statusMsg && <div className="ad-banner">{statusMsg}</div>}

        <div className="ad-row">
          <strong className="ad-text-md">Classic SDEX Open Offers ({offers.length})</strong>
          <div className="ad-flex-6">
            {activeAccount && (
              <button
                type="button"
                className="glass-pill ad-clickable"
                onClick={() => void loadData()}
              >
                Refresh
              </button>
            )}
            <button
              type="button"
              className="ad-btn-secondary ad-btn-sm"
              onClick={() => {
                setMode("pro");
                setActiveTab("trade");
              }}
            >
              + Limit Order
            </button>
          </div>
        </div>

        {offers.length === 0 ? (
          <div className="ad-text-sm ad-text-muted">
            {activeAccount
              ? activeAccount.kind === "classic"
                ? accountFunded === false
                  ? `This G... account is not yet activated on Stellar ${feedNetwork === "mainnet" ? "Mainnet" : "Testnet"} (requires 1 XLM base reserve).`
                  : "No open Classic SDEX offers found on this G... account."
                : "Smart Accounts (C...) trade via Soroban AMMs; switch to a Classic G... account to place SDEX limit orders."
              : "Connect or preview a Classic G... address above to inspect live resting SDEX offers."}
          </div>
        ) : (
          <div className="ad-stack-6">
            {offers.map((offer) => (
              <div key={offer.offerId} className="ad-row ad-item-card">
                <div className="ad-text-sm tabular-nums">
                  <strong>#{offer.offerId}</strong> · {offer.amount} {offer.sellingAsset.split(":")[0]} @{" "}
                  {offer.price} {offer.buyingAsset.split(":")[0]}
                </div>
                <button
                  type="button"
                  className="ad-btn-secondary ad-btn-sm"
                  disabled={executionDisabled || busyId === offer.offerId}
                  onClick={() => void handleCancelOffer(offer)}
                >
                  {executionDisabled ? "Read-Only" : "Cancel"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="glass-card ad-stack-10">
        <div className="ad-row">
          <strong className="ad-text-base">
            Watchlist ({watchlist.length}) &amp; Alerts ({alerts.length})
          </strong>
          <button
            type="button"
            className="ad-btn-secondary ad-btn-sm"
            disabled={busyId === "watchlist"}
            onClick={() => void handleToggleWatchlist()}
          >
            {watchlist.includes(selectedAsset)
              ? `Unwatch ${activeToken?.code ?? selectedAsset}`
              : `+ Watch ${activeToken?.code ?? selectedAsset}`}
          </button>
        </div>

        <TokenSearchInput
          query={alertQuery}
          onQueryChange={setAlertQuery}
          placeholder="Select token for Watchlist / Alert (ASTRO, USDC, XLM)..."
          primaryActionLabel="Pick"
          onSelectToken={(item) => {
            setSelectedAsset(item.assetKey);
            setAlertQuery("");
          }}
        />

        <form onSubmit={(e) => void handleCreateAlert(e)} className="ad-grid-alert">
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

        {alerts.map((al) => {
          const tok = catalog.find((c) => c.assetKey === al.assetKey);
          return (
            <div key={al.id} className="ad-row ad-banner tabular-nums">
              <span>
                {tok?.code ?? al.assetKey.split(":")[0]} {al.condition} {al.threshold} XLM
              </span>
              <button
                type="button"
                className="glass-pill ad-clickable"
                disabled={busyId === al.id}
                onClick={() => void handleDeleteAlert(al.id)}
              >
                Remove
              </button>
            </div>
          );
        })}

        {watchlist.length > 0 && (
          <div className="ad-chip-row">
            {watchlist.map((item) => {
              const tok = catalog.find((c) => c.assetKey === item);
              return (
                <button
                  key={item}
                  type="button"
                  className="glass-pill ad-clickable"
                  onClick={() => {
                    setSelectedAsset(item);
                    setActiveTab("trade");
                  }}
                >
                  ★ {tok?.code ?? item.split(":")[0]}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
