import {
  defaultCapabilitiesForKind,
  parseTmaConfig,
  type AstroIdProfile,
  type CatalogTokenItem,
  type ResolvedAccount,
  type StellarNetwork,
  type TmaConfig,
} from "@astrodex/domain";
import { parseAstroDexStartAppParam } from "@astrodex/tg-protocol";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getTelegramWebApp,
  initTelegramMiniApp,
  isInsideTelegramMiniApp,
  triggerTelegramHaptic,
  type TelegramAuthStatus,
} from "../telegram/webapp.js";

export type DockTab = "radar" | "watchlist" | "token" | "trade" | "scanner" | "book" | "orders";
export type TradeScrollTarget = "swap" | "pools" | "safety" | "limit" | null;

export interface AppOpenOfferItem {
  offerId: string;
  sellingAsset: string;
  buyingAsset: string;
  amount: string;
  price: string;
}

const LOCAL_FAVORITES_PREFIX = "astrodex_local_watchlist_v2_";
const LEGACY_FAVORITES_KEY = "astrodex_local_watchlist_v1";
const STARRED_META_KEY = "astrodex_starred_meta_v1";

function readLocalFavorites(net: StellarNetwork): string[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_FAVORITES_PREFIX}${net}`);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    }
    const legacy = localStorage.getItem(LEGACY_FAVORITES_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    }
    return [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(net: StellarNetwork, items: string[]): void {
  try {
    localStorage.setItem(`${LOCAL_FAVORITES_PREFIX}${net}`, JSON.stringify(items));
  } catch {
    // Ignore restricted storage environments
  }
}

function readStarredMeta(): Record<string, CatalogTokenItem> {
  try {
    const raw = localStorage.getItem(STARRED_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, CatalogTokenItem>) : {};
  } catch {
    return {};
  }
}

function writeStarredMeta(meta: Record<string, CatalogTokenItem>): void {
  try {
    localStorage.setItem(STARRED_META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore restricted storage environments
  }
}

interface AppContextValue {
  config: TmaConfig;
  feedNetwork: StellarNetwork;
  setFeedNetwork: (net: StellarNetwork) => void;
  executionDisabled: boolean;
  authStatus: TelegramAuthStatus;
  authError: string | null;
  sessionToken: string | null;
  astroId: AstroIdProfile;
  activeAccount: ResolvedAccount | null;
  setActiveAccountAddress: (addr: string) => void;
  resolvePublicIdentity: (query: string) => Promise<{ ok: boolean; message: string }>;
  disconnectPublicIdentity: () => void;
  activeTab: DockTab;
  setActiveTab: (tab: DockTab) => void;
  previousTab: "radar" | "watchlist";
  goBackFromToken: () => void;
  tradeScrollTarget: TradeScrollTarget;
  setTradeScrollTarget: (target: TradeScrollTarget) => void;
  tradePairOverride: { fromAsset: string; toAsset: string } | null;
  openTradePair: (fromAsset: string, toAsset: string) => void;
  selectedAsset: string;
  setSelectedAsset: (assetId: string) => void;
  defaultPairAsset: string;
  favorites: string[];
  starredMeta: Record<string, CatalogTokenItem>;
  toggleFavorite: (assetKey: string, meta?: CatalogTokenItem) => Promise<void>;
  catalog: CatalogTokenItem[];
  catalogError: string | null;
  xlmUsd: number | null;
  launchpadTokens: Array<{
    id?: string;
    symbol?: string;
    name?: string;
    graduationPercent?: number;
    graduated?: boolean;
    reserveXlm?: string;
  }>;
  catalogLoading: boolean;
  refreshCatalog: (overrideNet?: StellarNetwork) => Promise<void>;
  openOffers: AppOpenOfferItem[];
  openOffersCount: number;
  refreshOpenOffers: () => Promise<void>;
  syncWallet: () => Promise<{ ok: boolean; message: string }>;
  retryAuth: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const config = useMemo(
    () => parseTmaConfig(import.meta.env as Record<string, unknown>),
    [],
  );

  const [feedNetwork, setFeedNetworkState] = useState<StellarNetwork>(
    config.defaultFeedNetwork ?? config.network,
  );
  const executionDisabled = !config.executionEnabled || feedNetwork !== config.network;

  const [authStatus, setAuthStatus] = useState<TelegramAuthStatus>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [astroId, setAstroId] = useState<AstroIdProfile>({
    found: false,
    source: "none",
    accounts: [],
  });
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [activeTab, setActiveTabState] = useState<DockTab>("radar");
  const [previousTab, setPreviousTab] = useState<"radar" | "watchlist">("radar");
  const [tradeScrollTarget, setTradeScrollTarget] = useState<TradeScrollTarget>(null);
  const [tradePairOverride, setTradePairOverride] = useState<{
    fromAsset: string;
    toAsset: string;
  } | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<string>("XLM");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [openOffers, setOpenOffers] = useState<AppOpenOfferItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogTokenItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() =>
    readLocalFavorites(config.defaultFeedNetwork ?? config.network),
  );
  const [starredMeta, setStarredMeta] = useState<Record<string, CatalogTokenItem>>(() =>
    readStarredMeta(),
  );
  const [xlmUsd, setXlmUsd] = useState<number | null>(null);
  const [launchpadTokens, setLaunchpadTokens] = useState<AppContextValue["launchpadTokens"]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const catalogSeqRef = useRef(0);
  const catalogAbortRef = useRef<AbortController | null>(null);

  const refreshCatalog = useCallback(
    async (overrideNet?: StellarNetwork) => {
      const targetNet = overrideNet ?? feedNetwork;
      const seq = ++catalogSeqRef.current;
      catalogAbortRef.current?.abort();
      const controller = new AbortController();
      catalogAbortRef.current = controller;
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(
          `${base}/v1/markets/overview?net=${encodeURIComponent(targetNet)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          if (seq === catalogSeqRef.current) {
            setCatalogError(`Markets temporarily unavailable (HTTP ${res.status})`);
          }
          return;
        }
        const json = (await res.json()) as {
          xlmUsd?: { priceUsd?: number } | null;
          launchpadTokens?: AppContextValue["launchpadTokens"];
          catalog?: CatalogTokenItem[];
        };
        if (seq !== catalogSeqRef.current) return;
        setXlmUsd(json.xlmUsd?.priceUsd ?? null);
        setLaunchpadTokens(json.launchpadTokens ?? []);
        if (Array.isArray(json.catalog)) {
          setCatalog(json.catalog);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (seq === catalogSeqRef.current) {
          setCatalogError("Unable to reach AstroDex markets. Check connection and retry.");
        }
      } finally {
        if (seq === catalogSeqRef.current) {
          setCatalogLoading(false);
        }
      }
    },
    [config.apiBaseUrl, feedNetwork],
  );

  useEffect(() => {
    setCatalog([]);
    setXlmUsd(null);
    setFavorites(readLocalFavorites(feedNetwork));
    void refreshCatalog(feedNetwork);
  }, [feedNetwork, refreshCatalog]);

  const setFeedNetwork = useCallback((net: StellarNetwork) => {
    triggerTelegramHaptic("selection");
    setSelectedAsset("XLM");
    setFeedNetworkState(net);
  }, []);

  const applyStartParam = useCallback((rawParam: string) => {
    const cleanNetPrefix =
      rawParam.startsWith("mainnet_") || rawParam.startsWith("m_t_") || rawParam.startsWith("m_s_")
        ? "mainnet"
        : rawParam.startsWith("testnet_") || rawParam.startsWith("t_t_") || rawParam.startsWith("t_s_")
          ? "testnet"
          : null;
    const strippedParam = rawParam.startsWith("mainnet_")
      ? rawParam.slice("mainnet_".length)
      : rawParam.startsWith("testnet_")
        ? rawParam.slice("testnet_".length)
        : rawParam;
    if (cleanNetPrefix) {
      setFeedNetworkState(cleanNetPrefix);
    }
    const parsed = parseAstroDexStartAppParam(strippedParam);
    if (!parsed) return;
    if (parsed.kind === "token") {
      setSelectedAsset(parsed.assetId);
      setTradeScrollTarget("swap");
      setActiveTabState("token");
    } else if (parsed.kind === "scan") {
      setSelectedAsset(parsed.assetId);
      setTradeScrollTarget("safety");
      setActiveTabState("token");
    } else if (parsed.kind === "pair") {
      setSelectedAsset(parsed.pairId);
      setTradeScrollTarget("swap");
      setActiveTabState("token");
    } else if (parsed.kind === "tab") {
      if (parsed.tab === "scanner") {
        setTradeScrollTarget("safety");
        setActiveTabState("token");
      } else if (parsed.tab === "book") {
        setTradeScrollTarget("pools");
        setActiveTabState("token");
      } else if (parsed.tab === "orders" || parsed.tab === "watchlist" || parsed.tab === "alerts") {
        setActiveTabState("watchlist");
      } else if (parsed.tab === "trade") {
        setTradeScrollTarget("swap");
        setActiveTabState("token");
      } else {
        const tabSet = new Set<DockTab>(["radar", "watchlist", "token"]);
        if (tabSet.has(parsed.tab as DockTab)) {
          setActiveTabState(parsed.tab as DockTab);
        }
      }
    } else if (strippedParam === "orders" || strippedParam === "alerts" || strippedParam === "watchlist") {
      setActiveTabState("watchlist");
    }
  }, []);

  const authenticate = useCallback(async () => {
    initTelegramMiniApp();
    const wa = getTelegramWebApp();
    const urlStartParam =
      typeof window !== "undefined"
        ? (new URLSearchParams(window.location.search).get("startapp") ?? "")
        : "";
    const startParam = (wa?.initDataUnsafe?.start_param ?? urlStartParam).trim();
    if (startParam) {
      applyStartParam(startParam);
    }

    const inTg = isInsideTelegramMiniApp();
    if (!inTg) {
      setAuthStatus(config.allowDevOutsideTelegram ? "verified" : "outside");
      return;
    }

    setAuthStatus("checking");
    setAuthError(null);
    try {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/v1/tg/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: wa!.initData }),
      });
      const json = (await res.json()) as {
        sessionToken?: string;
        expiresAt?: number;
        startParam?: string;
        astroId?: AstroIdProfile;
        error?: string;
      };
      if (!res.ok || !json.sessionToken) {
        throw new Error(json.error ?? `Auth failed (${res.status})`);
      }
      if (json.startParam) {
        applyStartParam(json.startParam);
      }
      setSessionToken(json.sessionToken);
      setSessionExpiresAt(typeof json.expiresAt === "number" ? json.expiresAt : null);
      if (json.astroId) {
        setAstroId(json.astroId);
        const explicitNetInParam =
          startParam.startsWith("mainnet_") ||
          startParam.startsWith("testnet_") ||
          Boolean(json.startParam?.startsWith("mainnet_") || json.startParam?.startsWith("testnet_"));
        if (
          !explicitNetInParam &&
          (json.astroId.preferredNetwork === "mainnet" ||
            json.astroId.preferredNetwork === "testnet")
        ) {
          setFeedNetworkState(json.astroId.preferredNetwork);
        }
        if (json.astroId.activeAddress) {
          setSelectedAddress(json.astroId.activeAddress);
        }
      }
      setAuthStatus("verified");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Telegram verification failed");
      setAuthStatus("error");
    }
  }, [applyStartParam, config.allowDevOutsideTelegram, config.apiBaseUrl]);

  useEffect(() => {
    void authenticate();
  }, [authenticate, authAttempt]);

  const activeAccount = useMemo(() => {
    if (astroId.accounts.length === 0) return null;
    if (selectedAddress) {
      const found = astroId.accounts.find((a) => a.address === selectedAddress);
      if (found) return found;
    }
    return (
      astroId.accounts.find((a) => a.kind === "classic" && a.isDefault) ??
      astroId.accounts.find((a) => a.kind === "classic") ??
      astroId.accounts[0] ??
      null
    );
  }, [astroId.accounts, selectedAddress]);

  useEffect(() => {
    if (!sessionToken || !sessionExpiresAt) return undefined;
    const nowSec = Math.floor(Date.now() / 1000);
    const delayMs = Math.max(15_000, (sessionExpiresAt - nowSec - 120) * 1000);
    const timer = window.setTimeout(async () => {
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/tg/refresh`, {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { sessionToken?: string; expiresAt?: number };
        if (json.sessionToken) {
          setSessionToken(json.sessionToken);
          setSessionExpiresAt(typeof json.expiresAt === "number" ? json.expiresAt : null);
        }
      } catch {
        // Ignore transient refresh failure
      }
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [config.apiBaseUrl, sessionToken, sessionExpiresAt]);

  const setActiveTab = useCallback(
    (next: DockTab) => {
      triggerTelegramHaptic("selection");
      if (next === "radar" || next === "watchlist") {
        setPreviousTab(next);
        setActiveTabState(next);
        return;
      }
      if (activeTab === "radar" || activeTab === "watchlist") {
        setPreviousTab(activeTab);
      }
      if (next === "trade") {
        setTradeScrollTarget("swap");
        setActiveTabState("token");
        return;
      }
      if (next === "scanner") {
        setTradeScrollTarget("safety");
        setActiveTabState("token");
        return;
      }
      if (next === "book") {
        setTradeScrollTarget("pools");
        setActiveTabState("token");
        return;
      }
      if (next === "orders") {
        setPreviousTab("watchlist");
        setActiveTabState("watchlist");
        return;
      }
      setActiveTabState(next);
    },
    [activeTab],
  );

  const goBackFromToken = useCallback(() => {
    triggerTelegramHaptic("selection");
    setActiveTabState(previousTab);
  }, [previousTab]);

  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    const base = config.apiBaseUrl.replace(/\/+$/, "");
    void fetch(`${base}/v1/watchlists`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { items?: string[] };
        if (!cancelled && Array.isArray(json.items)) {
          setFavorites(json.items);
          writeLocalFavorites(feedNetwork, json.items);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, feedNetwork, sessionToken]);

  const toggleFavorite = useCallback(
    async (assetKey: string, meta?: CatalogTokenItem) => {
      const cleanKey = assetKey.trim();
      if (!cleanKey) return;
      triggerTelegramHaptic("selection");
      const exists = favorites.includes(cleanKey);
      const next = exists
        ? favorites.filter((x) => x !== cleanKey)
        : [cleanKey, ...favorites];
      setFavorites(next);
      writeLocalFavorites(feedNetwork, next);

      if (!exists) {
        const resolvedMeta =
          meta ??
          catalog.find((c) => c.assetKey.toUpperCase() === cleanKey.toUpperCase());
        if (resolvedMeta) {
          setStarredMeta((prev) => {
            const updated = { ...prev, [cleanKey]: resolvedMeta };
            writeStarredMeta(updated);
            return updated;
          });
        }
      }

      if (!sessionToken) return;
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      try {
        await fetch(
          exists
            ? `${base}/v1/watchlists/${encodeURIComponent(cleanKey)}`
            : `${base}/v1/watchlists`,
          {
            method: exists ? "DELETE" : "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            ...(exists ? {} : { body: JSON.stringify({ assetKey: cleanKey }) }),
          },
        );
      } catch {
        // Keep optimistic local favorite cleanly
      }
    },
    [catalog, config.apiBaseUrl, favorites, feedNetwork, sessionToken],
  );

  const openTradePair = useCallback((fromAsset: string, toAsset: string) => {
    triggerTelegramHaptic("selection");
    setTradePairOverride({ fromAsset, toAsset });
    setSelectedAsset(toAsset === "XLM" ? fromAsset : toAsset);
    setTradeScrollTarget("swap");
    setActiveTabState("token");
  }, []);

  const resolvePublicIdentity = useCallback(
    async (rawQuery: string): Promise<{ ok: boolean; message: string }> => {
      const q = rawQuery.trim();
      if (!q) {
        return { ok: false, message: "Enter an @AstroID username, Telegram ID, or public G.../C... address." };
      }
      if (/^S[A-Z2-7]{55}$/.test(q.toUpperCase())) {
        return {
          ok: false,
          message: "Never enter a private S... secret seed here. AstroDex is 100% non-custodial; only public G.../C... addresses or @AstroID are allowed.",
        };
      }
      const upper = q.toUpperCase();
      if (/^[GC][A-Z2-7]{55}$/.test(upper)) {
        const kind = upper.startsWith("C") ? "smart" : "classic";
        setAstroId({
          found: true,
          source: "astrowallet",
          primaryAddress: upper,
          accounts: [
            {
              address: upper,
              kind,
              label: kind === "smart" ? "Smart Account" : "Classic Account",
              isDefault: true,
              capabilities: defaultCapabilitiesForKind(kind),
            },
          ],
        });
        setSelectedAddress(upper);
        triggerTelegramHaptic("success");
        return { ok: true, message: `Loaded public ${kind === "smart" ? "C..." : "G..."} address.` };
      }

      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(`${base}/v1/wallet/resolve?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as AstroIdProfile & { ok?: boolean; error?: string };
        if (!res.ok || !json.found || !Array.isArray(json.accounts) || json.accounts.length === 0) {
          return {
            ok: false,
            message: json.error ?? `No AstroID found for "${q}". Open AstroWallet to create or link your AstroID.`,
          };
        }
        setAstroId(json);
        if (json.preferredNetwork === "mainnet" || json.preferredNetwork === "testnet") {
          setFeedNetworkState(json.preferredNetwork);
        }
        setSelectedAddress(
          json.activeAddress ?? json.primaryAddress ?? json.accounts[0]?.address ?? null,
        );
        triggerTelegramHaptic("success");
        return { ok: true, message: `Connected AstroID (@${json.usernameLower ?? q}).` };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : "Failed to resolve AstroID.",
        };
      }
    },
    [config.apiBaseUrl],
  );

  const disconnectPublicIdentity = useCallback(() => {
    setAstroId({ found: false, source: "none", accounts: [] });
    setSelectedAddress(null);
    setOpenOffers([]);
  }, []);

  const refreshOpenOffers = useCallback(async () => {
    if (!activeAccount || activeAccount.kind !== "classic") {
      setOpenOffers([]);
      return;
    }
    try {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(
        `${base}/v1/orders/${encodeURIComponent(activeAccount.address)}?net=${encodeURIComponent(feedNetwork)}`,
      );
      if (!res.ok) {
        setOpenOffers([]);
        return;
      }
      const json = (await res.json()) as { offers?: AppOpenOfferItem[] };
      setOpenOffers(Array.isArray(json.offers) ? json.offers : []);
    } catch {
      setOpenOffers([]);
    }
  }, [activeAccount, config.apiBaseUrl, feedNetwork]);

  useEffect(() => {
    void refreshOpenOffers();
  }, [refreshOpenOffers]);

  const syncWallet = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const q = astroId.telegramUserId ?? astroId.usernameLower ?? activeAccount?.address;
    if (q) {
      return resolvePublicIdentity(q);
    }
    setAuthAttempt((n) => n + 1);
    return { ok: true, message: "Re-syncing Telegram session with AstroWallet..." };
  }, [astroId.telegramUserId, astroId.usernameLower, activeAccount?.address, resolvePublicIdentity]);

  const defaultPairAsset = useMemo(() => {
    const usdc = catalog.find((t) => t.code.toUpperCase() === "USDC");
    if (usdc) return usdc.assetKey;
    const astro = catalog.find((t) => t.code.toUpperCase() === "ASTRO");
    if (astro) return astro.assetKey;
    return catalog.find((t) => t.assetKey !== "XLM")?.assetKey ?? "XLM";
  }, [catalog]);

  return (
    <AppContext.Provider
      value={{
        config,
        feedNetwork,
        setFeedNetwork,
        executionDisabled,
        authStatus,
        authError,
        sessionToken,
        astroId,
        activeAccount,
        setActiveAccountAddress: setSelectedAddress,
        resolvePublicIdentity,
        disconnectPublicIdentity,
        activeTab,
        setActiveTab,
        previousTab,
        goBackFromToken,
        tradeScrollTarget,
        setTradeScrollTarget,
        tradePairOverride,
        openTradePair,
        selectedAsset,
        setSelectedAsset,
        defaultPairAsset,
        favorites,
        starredMeta,
        toggleFavorite,
        catalog,
        catalogError,
        xlmUsd,
        launchpadTokens,
        catalogLoading,
        refreshCatalog,
        openOffers,
        openOffersCount: openOffers.length,
        refreshOpenOffers,
        syncWallet,
        retryAuth: () => setAuthAttempt((n) => n + 1),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used inside AppProvider");
  return ctx;
}
