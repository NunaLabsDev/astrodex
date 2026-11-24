import type { CatalogTokenItem, DepthPoint, OhlcvCandle, OhlcvTimeframe } from "@astrodex/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartCanvas } from "../components/ChartCanvas.js";
import { MicroPrice } from "../components/MicroPrice.js";
import { TokenAvatar } from "../components/TokenAvatar.js";
import { useAppState } from "../state/app-context.js";
import { triggerTelegramHaptic } from "../telegram/webapp.js";

const TIMEFRAMES: readonly OhlcvTimeframe[] = ["5m", "15m", "1h", "4h", "1d"];

type DetailTab = "overview" | "pools" | "holders" | "security";

interface TokenHubPayload {
  assetId: string;
  catalogItem?: {
    assetKey: string;
    code: string;
    name?: string;
    issuer?: string;
    logoUrl?: string;
    reviewStatus?: string;
    domain?: string;
  } | null;
  marketStats?: {
    code?: string;
    name?: string;
    issuer?: string | null;
    reviewStatus?: string;
    logoUrl?: string | null;
    priceUsd: number | null;
    change24hPct: number | null;
    change7dPct: number | null;
    volume7dUsd: number | null;
    marketCapUsd: number | null;
    circulatingSupply?: number | null;
    holdersCount: number | null;
    tradesCount: number | null;
    rating: number | null;
    domain: string | null;
  };
  topHolders?: Array<{
    address: string;
    balance: string;
    sharePct: number | null;
  }>;
  ammPools?: Array<{
    poolId: string;
    venue: string;
    feeBps: number;
    totalTrustlines: number;
    counterCode: string;
    tvlUsd?: number;
    volume24hUsd?: number;
    totalApyPct?: number;
    poolType?: string;
  }>;
  ammPairInfo?: {
    spotPriceQuotePerBase: number;
  } | null;
  orderbook?: {
    spreadPct: string | null;
    bids: Array<{ price: string; amount: string }>;
    asks: Array<{ price: string; amount: string }>;
  } | null;
  depth?: DepthPoint[];
  recentTrades?: Array<{
    id: string;
    timestamp: string;
    side: "buy" | "sell";
    baseAmount: string;
    baseCode: string;
    priceInCounter?: string;
    price?: string;
    counterCode: string;
  }>;
  audit?: {
    astroShieldScore: number;
    verdict: string;
    trustTier?: string;
    holdersCount?: number | string;
    circulatingSupply?: string;
    logoUrl?: string;
    name?: string;
    basicSummary?: Array<{ label: string; ok: boolean }>;
    classicAudit?: {
      authImmutable?: boolean;
      authClawbackEnabled?: boolean;
      authRevocable?: boolean;
    };
    sorobanAudit?: {
      ttlStatus?: string;
      ttlDaysRemaining?: number;
    };
    findings: Array<{ severity: string; title: string; description?: string }>;
  } | null;
}

function formatCompactUsd(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val) || val <= 0) return "—";
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function formatCompactCount(val: number | string | null | undefined): string {
  const num = typeof val === "string" ? Number(val) : val;
  if (num === null || num === undefined || !Number.isFinite(num) || num <= 0) return "—";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(Math.round(num));
}

function formatCompactOrderAmount(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

async function copyWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }
  if (typeof document !== "undefined") {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

export function TokenDetailView() {
  const {
    config,
    feedNetwork,
    selectedAsset,
    previousTab,
    goBackFromToken,
    tradeScrollTarget,
    setTradeScrollTarget,
    favorites,
    toggleFavorite,
    catalog,
    xlmUsd,
  } = useAppState();

  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [quoteUnit, setQuoteUnit] = useState<"usd" | "xlm">("usd");
  const [timeframe, setTimeframe] = useState<OhlcvTimeframe>("1h");
  const [hub, setHub] = useState<TokenHubPayload | null>(null);
  const [hubLoading, setHubLoading] = useState(true);
  const [hubError, setHubError] = useState<string | null>(null);
  const [candles, setCandles] = useState<OhlcvCandle[]>([]);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [candlesQuoteCurrency, setCandlesQuoteCurrency] = useState<"USD" | "USDC" | "XLM">("XLM");
  const [depth, setDepth] = useState<DepthPoint[]>([]);
  const [copiedKey, setCopiedKey] = useState(false);
  const [hubRetryNonce, setHubRetryNonce] = useState(0);

  const focusAsset = selectedAsset || "XLM";
  const isNativeXlm =
    focusAsset.toUpperCase() === "XLM" ||
    (Boolean(config.xlmSacContractId) &&
      focusAsset.toUpperCase() === config.xlmSacContractId?.toUpperCase());

  const catalogMatch = useMemo(
    () =>
      catalog.find(
        (c) =>
          c.assetKey.toUpperCase() === focusAsset.toUpperCase() ||
          c.sacId?.toUpperCase() === focusAsset.toUpperCase() ||
          (isNativeXlm && c.assetKey === "XLM"),
      ),
    [catalog, focusAsset, isNativeXlm],
  );

  const xlmCatalogItem = useMemo(() => catalog.find((c) => c.assetKey === "XLM"), [catalog]);
  const xlmChange24h = xlmCatalogItem?.change24hPct ?? 0;
  const xlmChange7d = xlmCatalogItem?.change7dPct ?? 0;

  useEffect(() => {
    window.scrollTo({ top: 0 });
    if (!tradeScrollTarget) {
      setDetailTab("overview");
    }
  }, [focusAsset, tradeScrollTarget]);

  useEffect(() => {
    if (!tradeScrollTarget) return;
    if (tradeScrollTarget === "safety") setDetailTab("security");
    else if (tradeScrollTarget === "pools") setDetailTab("pools");
    else setDetailTab("overview");
    setTradeScrollTarget(null);
  }, [tradeScrollTarget, setTradeScrollTarget]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setHubLoading(true);
    setHubError(null);
    setHub(null);
    setDepth([]);

    const base = config.apiBaseUrl.replace(/\/+$/, "");
    const netParam = encodeURIComponent(feedNetwork);
    const queryAsset = isNativeXlm ? "XLM" : focusAsset;

    void fetch(`${base}/v1/token-hub/${encodeURIComponent(queryAsset)}?net=${netParam}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return (await r.json()) as TokenHubPayload;
      })
      .then((hubRes) => {
        if (cancelled) return;
        setHub(hubRes);
        if (Array.isArray(hubRes.depth)) setDepth(hubRes.depth);
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setHubError("Unable to load token analytics. Tap Retry.");
      })
      .finally(() => {
        if (!cancelled) setHubLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [config.apiBaseUrl, feedNetwork, focusAsset, isNativeXlm, hubRetryNonce]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setCandlesLoading(true);
    const base = config.apiBaseUrl.replace(/\/+$/, "");
    const netParam = encodeURIComponent(feedNetwork);
    const pair = isNativeXlm ? "XLM-XLM" : `${encodeURIComponent(focusAsset)}-XLM`;

    void fetch(`${base}/v1/candles/${pair}?tf=${timeframe}&net=${netParam}`, {
      signal: controller.signal,
    })
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as {
              candles?: OhlcvCandle[];
              quoteCurrency?: "USD" | "USDC" | "XLM";
            })
          : null,
      )
      .then((json) => {
        if (cancelled) return;
        if (Array.isArray(json?.candles)) {
          setCandles(json.candles);
        } else {
          setCandles([]);
        }
        setCandlesQuoteCurrency(
          json?.quoteCurrency ?? (isNativeXlm ? "USDC" : "XLM"),
        );
      })
      .catch(() => {
        if (!cancelled) setCandles([]);
      })
      .finally(() => {
        if (!cancelled) setCandlesLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [config.apiBaseUrl, feedNetwork, focusAsset, isNativeXlm, timeframe]);

  const code =
    hub?.marketStats?.code ??
    hub?.catalogItem?.code ??
    catalogMatch?.code ??
    (isNativeXlm ? "XLM" : focusAsset.includes(":") ? focusAsset.split(":")[0]! : focusAsset.slice(0, 8));
  const name =
    hub?.marketStats?.name ??
    hub?.catalogItem?.name ??
    catalogMatch?.name ??
    code;
  const logoUrl =
    hub?.marketStats?.logoUrl ??
    hub?.catalogItem?.logoUrl ??
    catalogMatch?.logoUrl ??
    hub?.audit?.logoUrl ??
    undefined;
  const reviewStatus =
    hub?.marketStats?.reviewStatus ??
    hub?.catalogItem?.reviewStatus ??
    catalogMatch?.reviewStatus ??
    "unreviewed_warning";
  const isMalicious =
    reviewStatus === "spoof_blocked" || hub?.audit?.verdict === "malicious";
  const domain =
    hub?.marketStats?.domain ??
    hub?.catalogItem?.domain ??
    catalogMatch?.domain ??
    null;
  const issuer =
    hub?.marketStats?.issuer ??
    hub?.catalogItem?.issuer ??
    catalogMatch?.issuer ??
    (focusAsset.includes(":") ? focusAsset.split(":")[1] : null);

  const isStarred = favorites.includes(focusAsset);
  const spotXlm = hub?.ammPairInfo?.spotPriceQuotePerBase ?? null;
  const usdPrice = isNativeXlm
    ? (hub?.marketStats?.priceUsd ?? catalogMatch?.priceUsd ?? xlmUsd ?? spotXlm)
    : (hub?.marketStats?.priceUsd ??
        catalogMatch?.priceUsd ??
        (spotXlm && xlmUsd && xlmUsd > 0 ? spotXlm * xlmUsd : null));
  const xlmPrice = isNativeXlm
    ? 1
    : (spotXlm ?? (usdPrice && xlmUsd && xlmUsd > 0 ? usdPrice / xlmUsd : null));

  const rawPct24 = hub?.marketStats?.change24hPct ?? catalogMatch?.change24hPct ?? null;
  const rawPct7d = hub?.marketStats?.change7dPct ?? catalogMatch?.change7dPct ?? null;
  const pct24 =
    rawPct24 === null
      ? null
      : quoteUnit === "usd"
        ? rawPct24
        : isNativeXlm
          ? 0
          : Number(((((1 + rawPct24 / 100) / (1 + xlmChange24h / 100)) - 1) * 100).toFixed(2));
  const pct7d =
    rawPct7d === null
      ? null
      : quoteUnit === "usd"
        ? rawPct7d
        : isNativeXlm
          ? 0
          : Number(((((1 + rawPct7d / 100) / (1 + xlmChange7d / 100)) - 1) * 100).toFixed(2));

  const rangeStats = useMemo(() => {
    if (candles.length === 0) return null;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const c of candles) {
      if (c.low > 0 && c.low < low) low = c.low;
      if (c.high > high) high = c.high;
    }
    const latest = candles[candles.length - 1]!.close;
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
    const pct = Math.max(0, Math.min(100, ((latest - low) / (high - low)) * 100));
    return { low, high, latest, pct };
  }, [candles]);

  const handleCopyAssetId = useCallback(async () => {
    const ok = await copyWithFallback(focusAsset);
    if (ok) {
      setCopiedKey(true);
      triggerTelegramHaptic("selection");
      setTimeout(() => setCopiedKey(false), 1800);
    }
  }, [focusAsset]);

  const starMeta: CatalogTokenItem = useMemo(
    () => ({
      assetKey: focusAsset,
      kind: isNativeXlm ? "native" : focusAsset.startsWith("C") ? "soroban" : "classic",
      code,
      name,
      ...(issuer ? { issuer } : {}),
      decimals: 7,
      ...(logoUrl ? { logoUrl } : {}),
      ...(domain ? { domain } : {}),
      ...(usdPrice !== null ? { priceUsd: usdPrice } : {}),
      ...(rawPct24 !== null ? { change24hPct: rawPct24 } : {}),
      shieldScore: hub?.audit?.astroShieldScore ?? catalogMatch?.shieldScore ?? 55,
      reviewStatus: (reviewStatus === "official" || reviewStatus === "verified"
        ? reviewStatus
        : "unreviewed_warning") as CatalogTokenItem["reviewStatus"],
      ammVenue: focusAsset.startsWith("C") ? "soroswap" : "sdex_pool",
    }),
    [
      catalogMatch?.shieldScore,
      code,
      domain,
      focusAsset,
      hub?.audit?.astroShieldScore,
      isNativeXlm,
      issuer,
      logoUrl,
      name,
      rawPct24,
      reviewStatus,
      usdPrice,
    ],
  );

  const shieldScore = hub?.audit?.astroShieldScore ?? catalogMatch?.shieldScore ?? null;
  const explorerNet = feedNetwork === "mainnet" ? "public" : "testnet";
  const explorerUrl = isNativeXlm
    ? `https://stellar.expert/explorer/${explorerNet}/asset/XLM`
    : issuer
      ? `https://stellar.expert/explorer/${explorerNet}/asset/${encodeURIComponent(`${code}-${issuer}`)}`
      : /^C[A-Z2-7]{55}$/.test(focusAsset)
        ? `https://stellar.expert/explorer/${explorerNet}/contract/${focusAsset}`
        : `https://stellar.expert/explorer/${explorerNet}/asset/${encodeURIComponent(focusAsset)}`;

  const top10Concentration = useMemo(() => {
    if (!hub?.topHolders || hub.topHolders.length === 0) return null;
    const sum = hub.topHolders
      .slice(0, 10)
      .reduce((acc, h) => acc + (h.sharePct ?? 0), 0);
    return sum > 0 ? Math.min(100, Number(sum.toFixed(1))) : null;
  }, [hub?.topHolders]);

  return (
    <div className="ad-stack-12">
      {/* Sticky CoinGecko Top Strip */}
      <div className="ad-token-strip">
        <div className="ad-flex-8 ad-min-w-0">
          <button
            type="button"
            className="glass-pill ad-clickable"
            style={{ padding: "8px 12px", minHeight: 38 }}
            onClick={goBackFromToken}
          >
            ← {previousTab === "watchlist" ? "Watchlist" : "Markets"}
          </button>
          <TokenAvatar
            code={code}
            icon={logoUrl}
            isNative={isNativeXlm}
            size={28}
            verified={reviewStatus === "official" || reviewStatus === "verified"}
            scamRisk={isMalicious}
          />
          <span className="ad-font-extrabold ad-text-md ad-ellipsis">{code}</span>
        </div>

        <div className="ad-flex-6 ad-no-shrink">
          <button
            type="button"
            className={`glass-pill ad-clickable ${quoteUnit === "usd" ? "glass-pill--gold" : ""}`}
            style={{ minHeight: 38 }}
            onClick={() => setQuoteUnit((u) => (u === "usd" ? "xlm" : "usd"))}
          >
            {quoteUnit === "usd" ? "$ USD" : "✦ XLM"}
          </button>
          <button
            type="button"
            className={`ad-star-btn ${isStarred ? "ad-star-btn--active" : ""}`}
            aria-label={isStarred ? `Unstar ${code}` : `Star ${code}`}
            aria-pressed={isStarred}
            onClick={() => void toggleFavorite(focusAsset, starMeta)}
          >
            {isStarred ? "★" : "☆"}
          </button>
        </div>
      </div>

      {hubError && (
        <div className="ad-banner ad-banner--danger ad-row ad-row-wrap">
          <span>{hubError}</span>
          <button
            type="button"
            className="ad-btn-secondary ad-btn-sm"
            onClick={() => setHubRetryNonce((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {/* CoinGecko Hero Price & Range Card */}
      <section className="glass-card ad-stack-10">
        <div className="ad-row" style={{ alignItems: "flex-start" }}>
          <div className="ad-flex-8 ad-min-w-0">
            <TokenAvatar
              code={code}
              icon={logoUrl}
              isNative={isNativeXlm}
              size={44}
              verified={reviewStatus === "official" || reviewStatus === "verified"}
              scamRisk={isMalicious}
            />
            <div className="ad-min-w-0">
              <div className="ad-flex-6 ad-flex-wrap" style={{ alignItems: "center" }}>
                <strong className="ad-text-lg">{name}</strong>
                <span className="ad-text-xs ad-text-muted">{code}</span>
              </div>
              <div className="ad-flex-6 ad-flex-wrap" style={{ marginTop: 4 }}>
                <span
                  className={`glass-pill ${
                    isMalicious
                      ? "glass-pill--danger"
                      : reviewStatus === "official"
                        ? "glass-pill--safe"
                        : reviewStatus === "verified"
                          ? "glass-pill--gold"
                          : "glass-pill--warn"
                  }`}
                >
                  {isMalicious
                    ? "Spoof Risk"
                    : reviewStatus === "official"
                      ? "Official"
                      : reviewStatus === "verified"
                        ? "Verified"
                        : "Unlisted"}
                </span>
                {domain && <span className="glass-pill">{domain}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="ad-row ad-row-wrap" style={{ alignItems: "baseline" }}>
          <div style={{ fontSize: 26, fontWeight: 800 }} className="tabular-nums">
            {quoteUnit === "usd" ? (
              <MicroPrice value={usdPrice} fallback={hubLoading ? "Loading…" : "—"} />
            ) : xlmPrice !== null ? (
              <span>
                <MicroPrice value={xlmPrice} prefix="" /> XLM
              </span>
            ) : (
              <span>{hubLoading ? "Loading…" : "—"}</span>
            )}
          </div>

          <div className="ad-flex-6">
            {pct24 !== null && (
              <span className={`glass-pill tabular-nums ${pct24 >= 0 ? "glass-pill--safe" : "glass-pill--coral"}`}>
                24h {pct24 >= 0 ? "▲ " : "▼ "}
                {Math.abs(pct24).toFixed(2)}%
              </span>
            )}
            {pct7d !== null && (
              <span className={`glass-pill tabular-nums ${pct7d >= 0 ? "glass-pill--safe" : "glass-pill--coral"}`}>
                7d {pct7d >= 0 ? "▲ " : "▼ "}
                {Math.abs(pct7d).toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {rangeStats && (
          <div className="ad-stack-4">
            <div className="ad-row ad-text-xxs ad-text-muted tabular-nums">
              <span>
                Low:{" "}
                <MicroPrice
                  value={rangeStats.low}
                  prefix={candlesQuoteCurrency === "USD" || candlesQuoteCurrency === "USDC" ? "$" : ""}
                />
                {candlesQuoteCurrency === "XLM" ? " XLM" : ""}
              </span>
              <span>
                {timeframe.toUpperCase()} Range ({Math.round(rangeStats.pct)}%)
              </span>
              <span>
                High:{" "}
                <MicroPrice
                  value={rangeStats.high}
                  prefix={candlesQuoteCurrency === "USD" || candlesQuoteCurrency === "USDC" ? "$" : ""}
                />
                {candlesQuoteCurrency === "XLM" ? " XLM" : ""}
              </span>
            </div>
            <div className="ad-range-bar">
              <div className="ad-range-fill" style={{ width: "100%" }} />
              <div className="ad-range-dot" style={{ left: `${rangeStats.pct}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* Interactive Price Chart */}
      <section className="glass-card ad-stack-8">
        <div className="ad-row ad-row-wrap">
          <strong className="ad-text-sm">
            Price Chart ({code} / {candlesQuoteCurrency})
          </strong>
          <div className="ad-flex-6">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                className={`glass-pill ad-clickable ${timeframe === tf ? "glass-pill--gold" : ""}`}
                style={{ minHeight: 36, padding: "6px 10px" }}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <ChartCanvas
          candles={candles}
          depth={depth}
          quoteLabel={candlesQuoteCurrency}
          timeframe={timeframe}
          loading={candlesLoading}
        />
      </section>

      {/* 4-Tab CoinGecko Analytics Bar */}
      <div className="ad-seg-tabs-4" role="tablist" aria-label="Coin Analytics Sections">
        {(
          [
            ["overview", "Overview"],
            ["pools", "Pools"],
            ["holders", "Holders"],
            ["security", "Security"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={detailTab === id}
            className={`ad-seg-btn ${detailTab === id ? "ad-seg-btn--active" : ""}`}
            onClick={() => {
              triggerTelegramHaptic("selection");
              setDetailTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {detailTab === "overview" && (
        <section className="glass-card ad-stack-10">
          <strong className="ad-text-base">Market Statistics</strong>
          <div className="ad-stat-grid tabular-nums">
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Market Cap</div>
              <div className="ad-font-bold ad-text-md">
                {formatCompactUsd(hub?.marketStats?.marketCapUsd ?? catalogMatch?.marketCapUsd)}
              </div>
            </div>
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">7d Volume</div>
              <div className="ad-font-bold ad-text-md">
                {formatCompactUsd(hub?.marketStats?.volume7dUsd ?? catalogMatch?.volume7dUsd)}
              </div>
            </div>
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Circulating Supply</div>
              <div className="ad-font-bold ad-text-md">
                {formatCompactCount(hub?.marketStats?.circulatingSupply ?? hub?.audit?.circulatingSupply)}
              </div>
            </div>
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Holders</div>
              <div className="ad-font-bold ad-text-md">
                {formatCompactCount(
                  hub?.marketStats?.holdersCount ??
                    hub?.audit?.holdersCount ??
                    catalogMatch?.holdersCount,
                )}
              </div>
            </div>
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Astro Shield</div>
              <div className="ad-font-bold ad-text-md">
                {shieldScore !== null ? `${shieldScore}/100` : "—"}
              </div>
            </div>
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Rating</div>
              <div className="ad-font-bold ad-text-md">
                {hub?.marketStats?.rating ? `${hub.marketStats.rating.toFixed(1)} / 10` : "—"}
              </div>
            </div>
          </div>

          <div className="ad-divider" />
          <div className="ad-stack-6">
            <strong className="ad-text-sm">On-Chain Identity</strong>
            <div className="ad-text-xs ad-text-muted" style={{ wordBreak: "break-all" }}>
              Asset Key: <code className="tabular-nums">{focusAsset}</code>
            </div>
            <div className="ad-flex-wrap">
              <button
                type="button"
                className="ad-btn-secondary ad-btn-sm"
                onClick={() => void handleCopyAssetId()}
              >
                {copiedKey ? "✓ Copied ID" : "Copy Asset ID"}
              </button>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="ad-btn-secondary ad-btn-sm"
                style={{ textDecoration: "none" }}
              >
                StellarExpert ↗
              </a>
            </div>
          </div>
        </section>
      )}

      {detailTab === "pools" && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-base">AMM Liquidity Pools</strong>
            <span className="glass-pill">
              {hubLoading ? "Syncing..." : `${hub?.ammPools?.length ?? 0} pools`}
            </span>
          </div>
          {hub?.ammPools && hub.ammPools.length > 0 ? (
            <div className="ad-stack-6">
              {hub.ammPools.map((pool) => (
                <div key={pool.poolId} className="ad-item-card ad-stack-4">
                  <div className="ad-row">
                    <strong className="ad-text-sm">
                      {pool.venue.toUpperCase()} · {code}/{pool.counterCode}
                    </strong>
                    <span className="glass-pill tabular-nums">
                      Fee {(pool.feeBps / 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="ad-text-xs ad-text-muted tabular-nums">
                    {pool.tvlUsd && pool.tvlUsd > 0 ? `TVL ${formatCompactUsd(pool.tvlUsd)} · ` : ""}
                    {pool.volume24hUsd && pool.volume24hUsd > 0
                      ? `24h ${formatCompactUsd(pool.volume24hUsd)} · `
                      : ""}
                    {pool.totalApyPct && pool.totalApyPct > 0
                      ? `APY ${pool.totalApyPct.toFixed(1)}%`
                      : `${pool.totalTrustlines} LPs`}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-banner">
              {hubLoading
                ? "Loading live AMM pools..."
                : `No AMM pools indexed for ${code} on ${feedNetwork.toUpperCase()}.`}
            </div>
          )}

          <div className="ad-divider" />
          <div className="ad-row">
            <strong className="ad-text-sm">Orderbook Depth</strong>
            {hub?.orderbook?.spreadPct && (
              <span className="glass-pill tabular-nums">Spread {hub.orderbook.spreadPct}%</span>
            )}
          </div>
          {hub?.orderbook && (hub.orderbook.bids.length > 0 || hub.orderbook.asks.length > 0) ? (
            (() => {
              const bids = hub.orderbook.bids.slice(0, 5);
              const asks = hub.orderbook.asks.slice(0, 5);
              const maxDepth = Math.max(
                1,
                ...bids.map((b) => Number(b.amount) || 0),
                ...asks.map((a) => Number(a.amount) || 0),
              );
              return (
                <div className="ad-grid-2">
                  <div className="ad-stack-4">
                    <div className="ad-text-xs ad-text-muted">Bids</div>
                    {bids.map((b, i) => (
                      <div
                        key={i}
                        className="ad-depth-row ad-depth-row--bid ad-book-bid tabular-nums"
                        style={{
                          ["--depth-pct" as string]: `${Math.min(100, Math.round(((Number(b.amount) || 0) / maxDepth) * 100))}%`,
                        }}
                      >
                        <span>{Number(b.price).toFixed(4)}</span>
                        <span>{formatCompactOrderAmount(b.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="ad-stack-4">
                    <div className="ad-text-xs ad-text-muted">Asks</div>
                    {asks.map((a, i) => (
                      <div
                        key={i}
                        className="ad-depth-row ad-depth-row--ask ad-book-ask tabular-nums"
                        style={{
                          ["--depth-pct" as string]: `${Math.min(100, Math.round(((Number(a.amount) || 0) / maxDepth) * 100))}%`,
                        }}
                      >
                        <span>{Number(a.price).toFixed(4)}</span>
                        <span>{formatCompactOrderAmount(a.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="ad-banner">No resting SDEX orderbook depth indexed for this pair.</div>
          )}

          {hub?.recentTrades && hub.recentTrades.length > 0 && (
            <>
              <div className="ad-divider" />
              <strong className="ad-text-sm">Recent Ledger Trades</strong>
              <div className="ad-stack-4">
                {hub.recentTrades.slice(0, 6).map((t) => (
                  <div key={t.id} className="ad-row ad-text-xs tabular-nums">
                    <span className={t.side === "buy" ? "ad-text-emerald" : "ad-text-coral"}>
                      {t.side.toUpperCase()} {formatCompactOrderAmount(t.baseAmount)} {t.baseCode}
                    </span>
                    <span className="ad-text-muted">
                      @ {t.priceInCounter ?? t.price ?? "—"} {t.counterCode}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {detailTab === "holders" && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-base">
              {isNativeXlm ? "Recent Active Accounts" : "Top On-Chain Holders"}
            </strong>
            <span className="glass-pill tabular-nums">
              {hub?.marketStats?.holdersCount
                ? `${formatCompactCount(hub.marketStats.holdersCount)} total`
                : `${hub?.topHolders?.length ?? 0} shown`}
            </span>
          </div>

          {top10Concentration !== null && (
            <div className="ad-stack-4">
              <div className="ad-row ad-text-xs ad-text-muted tabular-nums">
                <span>Top 10 Concentration</span>
                <strong>{top10Concentration}%</strong>
              </div>
              <div className="ad-range-bar" style={{ overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${top10Concentration}%`,
                    background:
                      top10Concentration > 50
                        ? "#F15A24"
                        : top10Concentration > 30
                          ? "#F5C928"
                          : "#10B981",
                  }}
                />
              </div>
            </div>
          )}

          {hub?.topHolders && hub.topHolders.length > 0 ? (
            <div className="ad-stack-6">
              {hub.topHolders.slice(0, 10).map((h, idx) => (
                <div key={h.address} className="ad-row ad-item-card">
                  <div className="ad-font-bold ad-text-sm tabular-nums">
                    #{idx + 1} ·{" "}
                    <a
                      href={`https://stellar.expert/explorer/${explorerNet}/account/${h.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ad-link-inline"
                    >
                      {h.address.slice(0, 6)}…{h.address.slice(-4)}
                    </a>
                  </div>
                  <div className="ad-text-right ad-text-xs tabular-nums">
                    <strong>
                      {Number(h.balance).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </strong>
                    {h.sharePct !== null && (
                      <div className="ad-text-muted">{h.sharePct.toFixed(2)}%</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-banner">
              {hubLoading ? "Loading live holders from Horizon..." : "No public holder snapshot returned."}
            </div>
          )}
        </section>
      )}

      {detailTab === "security" && (
        <section className="glass-card ad-stack-10">
          <div className="ad-row">
            <strong className="ad-text-base">Astro Shield X-Ray</strong>
            <span
              className={`glass-pill ${
                isMalicious || (shieldScore !== null && shieldScore < 45)
                  ? "glass-pill--danger"
                  : (shieldScore ?? 0) >= 75
                    ? "glass-pill--safe"
                    : "glass-pill--warn"
              }`}
            >
              Score {shieldScore ?? "—"}/100
            </span>
          </div>

          {shieldScore !== null && (
            <div className="ad-range-bar" style={{ overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(4, Math.min(100, shieldScore))}%`,
                  background:
                    shieldScore >= 75 ? "#10B981" : shieldScore >= 45 ? "#F5C928" : "#EF4444",
                }}
              />
            </div>
          )}

          <div className="ad-grid-2">
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Verdict</div>
              <div className="ad-font-bold">
                {hubLoading ? "Scanning…" : (hub?.audit?.verdict ?? "Unavailable")}
              </div>
            </div>
            <div className="ad-subcard">
              <div className="ad-text-xs ad-text-muted">Circulating Supply</div>
              <div className="ad-font-bold tabular-nums">
                {formatCompactCount(hub?.marketStats?.circulatingSupply ?? hub?.audit?.circulatingSupply)}
              </div>
            </div>
          </div>

          {hub?.audit?.basicSummary && hub.audit.basicSummary.length > 0 && (
            <div className="ad-stack-4">
              {hub.audit.basicSummary.map((row, idx) => (
                <div key={idx} className="ad-row ad-text-xs">
                  <span>{row.label}</span>
                  <span className={row.ok ? "ad-text-emerald" : "ad-text-coral"}>
                    {row.ok ? "✓ Pass" : "✕ Flag"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {hubLoading ? (
            <div className="ad-shimmer" style={{ height: 56 }} />
          ) : !hub?.audit ? (
            <div className="ad-banner ad-banner--warn ad-row ad-row-wrap">
              <span>Security audit unavailable right now.</span>
              <button
                type="button"
                className="ad-btn-secondary ad-btn-sm"
                onClick={() => setHubRetryNonce((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          ) : hub.audit.findings.length > 0 ? (
            <div className="ad-stack-6">
              {hub.audit.findings.map((f, i) => (
                <div
                  key={i}
                  className={`ad-banner ad-text-xs ${
                    f.severity === "malicious" || f.severity === "high" || f.severity === "critical"
                      ? "ad-banner--danger"
                      : "ad-banner--warn"
                  }`}
                >
                  <div>
                    <strong>{f.severity.toUpperCase()}:</strong> {f.title}
                  </div>
                  {f.description && (
                    <div style={{ marginTop: 4, opacity: 0.9 }}>{f.description}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="ad-banner">
              No critical risk findings detected on {feedNetwork.toUpperCase()} for {code}.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
