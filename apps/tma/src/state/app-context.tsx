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

export type DockTab = "radar" | "trade" | "scanner" | "book" | "orders";
export type TradeScrollTarget = "swap" | "pools" | "safety" | "limit" | null;

const LOCAL_FAVORITES_KEY = "astrodex_local_watchlist_v1";

function readLocalFavorites(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(items: string[]): void {
  try {
    localStorage.setItem(LOCAL_FAVORITES_KEY, JSON.stringify(items));
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
  tradeScrollTarget: TradeScrollTarget;
  setTradeScrollTarget: (target: TradeScrollTarget) => void;
  tradePairOverride: { fromAsset: string; toAsset: string } | null;
  openTradePair: (fromAsset: string, toAsset: string) => void;
  selectedAsset: string;
  setSelectedAsset: (assetId: string) => void;
  defaultPairAsset: string;
  favorites: string[];
  toggleFavorite: (assetKey: string) => Promise<void>;
  catalog: CatalogTokenItem[];
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
  retryAuth: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const config = useMemo(
    () => parseTmaConfig(import.meta.env as Record<string, unknown>),
    [],
  );

  const [feedNetwork, setFeedNetworkState] = useState<StellarNetwork>("mainnet");
  const executionDisabled = !config.executionEnabled;

  const [authStatus, setAuthStatus] = useState<TelegramAuthStatus>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [astroId, setAstroId] = useState<AstroIdProfile>({
    found: false,
    source: "none",
    accounts: [],
  });
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [activeTab, setActiveTabState] = useState<DockTab>("radar");
  const [tradeScrollTarget, setTradeScrollTarget] = useState<TradeScrollTarget>(null);
  const [tradePairOverride, setTradePairOverride] = useState<{
    fromAsset: string;
    toAsset: string;
  } | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<string>("XLM");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [catalog, setCatalog] = useState<CatalogTokenItem[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() => readLocalFavorites());
  const [xlmUsd, setXlmUsd] = useState<number | null>(null);
  const [launchpadTokens, setLaunchpadTokens] = useState<AppContextValue["launchpadTokens"]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const refreshCatalog = useCallback(
    async (overrideNet?: StellarNetwork) => {
      const targetNet = overrideNet ?? feedNetwork;
      setCatalogLoading(true);
      try {
        const base = config.apiBaseUrl.replace(/\/+$/, "");
        const res = await fetch(
          `${base}/v1/markets/overview?net=${encodeURIComponent(targetNet)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          xlmUsd?: { priceUsd?: number } | null;
          launchpadTokens?: AppContextValue["launchpadTokens"];
          catalog?: CatalogTokenItem[];
        };
        setXlmUsd(json.xlmUsd?.priceUsd ?? null);
        setLaunchpadTokens(json.launchpadTokens ?? []);
        if (Array.isArray(json.catalog)) {
          setCatalog(json.catalog);
        }
      } catch {
        // Keep graceful offline fallback
      } finally {
        setCatalogLoading(false);
      }
    },
    [config.apiBaseUrl, feedNetwork],
  );

  useEffect(() => {
    void refreshCatalog(feedNetwork);
  }, [feedNetwork, refreshCatalog]);

  const setFeedNetwork = useCallback((net: StellarNetwork) => {
    triggerTelegramHaptic("selection");
    setSelectedAsset("XLM");
    setFeedNetworkState(net);
  }, []);

  const applyStartParam = useCallback((rawParam: string) => {
    const cleanNetPrefix = rawParam.startsWith("mainnet_")
      ? "mainnet"
      : rawParam.startsWith("testnet_")
        ? "testnet"
        : null;
    const strippedParam = cleanNetPrefix
      ? rawParam.slice(cleanNetPrefix.length + 1)
      : rawParam;
    if (cleanNetPrefix) {
      setFeedNetworkState(cleanNetPrefix);
    }
    const parsed = parseAstroDexStartAppParam(strippedParam);
    if (!parsed) return;
    if (parsed.kind === "token") {
      setSelectedAsset(parsed.assetId);
      setTradeScrollTarget("swap");
      setActiveTabState("trade");
    } else if (parsed.kind === "scan") {
      setSelectedAsset(parsed.assetId);
      setTradeScrollTarget("safety");
      setActiveTabState("trade");
    } else if (parsed.kind === "pair") {
      setSelectedAsset(parsed.pairId);
      setTradeScrollTarget("swap");
      setActiveTabState("trade");
    } else if (parsed.kind === "tab") {
      if (parsed.tab === "scanner") {
        setTradeScrollTarget("safety");
        setActiveTabState("trade");
      } else if (parsed.tab === "book") {
        setTradeScrollTarget("pools");
        setActiveTabState("trade");
      } else if (parsed.tab === "orders") {
        setActiveTabState("orders");
      } else {
        const tabSet = new Set<DockTab>(["radar", "trade", "scanner", "book", "orders"]);
        if (tabSet.has(parsed.tab as DockTab)) {
          setActiveTabState(parsed.tab as DockTab);
        }
      }
    } else if (strippedParam === "orders" || strippedParam === "alerts") {
      setActiveTabState("orders");
    }
  }, []);

  const authenticate = useCallback(async () => {
    initTelegramMiniApp();
    const wa = getTelegramWebApp();
    const startParam = wa?.initDataUnsafe?.start_param ?? "";
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
      if (json.astroId) {
        setAstroId(json.astroId);
        const explicitNetInParam =
          startParam.startsWith("mainnet_") ||
          startParam.startsWith("testnet_") ||
          Boolean(json.startParam?.startsWith("mainnet_") || json.startParam?.startsWith("testnet_"));
        if (
          !explicitNetInParam &&
          json.astroId.preferredNetwork === "mainnet"
        ) {
          setFeedNetworkState("mainnet");
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

  const setActiveTab = useCallback((next: DockTab) => {
    triggerTelegramHaptic("selection");
    if (next === "scanner") {
      setTradeScrollTarget("safety");
      setActiveTabState("trade");
      return;
    }
    if (next === "book") {
      setTradeScrollTarget("pools");
      setActiveTabState("trade");
      return;
    }
    if (next === "orders") {
      setActiveTabState("orders");
      return;
    }
    setActiveTabState(next);
  }, []);

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
          setFavorites((prev) => {
            const merged = Array.from(new Set([...json.items!, ...prev]));
            writeLocalFavorites(merged);
            return merged;
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, sessionToken]);

  const toggleFavorite = useCallback(
    async (assetKey: string) => {
      const cleanKey = assetKey.trim();
      if (!cleanKey) return;
      triggerTelegramHaptic("selection");
      const exists = favorites.includes(cleanKey);
      const next = exists
        ? favorites.filter((x) => x !== cleanKey)
        : [cleanKey, ...favorites];
      setFavorites(next);
      writeLocalFavorites(next);

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
    [config.apiBaseUrl, favorites, sessionToken],
  );

  const openTradePair = useCallback((fromAsset: string, toAsset: string) => {
    triggerTelegramHaptic("selection");
    setTradePairOverride({ fromAsset, toAsset });
    setSelectedAsset(toAsset === "XLM" ? fromAsset : toAsset);
    setTradeScrollTarget("swap");
    setActiveTabState("trade");
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
  }, []);

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
        tradeScrollTarget,
        setTradeScrollTarget,
        tradePairOverride,
        openTradePair,
        selectedAsset,
        setSelectedAsset,
        defaultPairAsset,
        favorites,
        toggleFavorite,
        catalog,
        xlmUsd,
        launchpadTokens,
        catalogLoading,
        refreshCatalog,
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
