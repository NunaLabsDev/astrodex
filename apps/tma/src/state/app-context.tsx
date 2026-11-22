import {
  parseTmaConfig,
  type AstroIdProfile,
  type CatalogTokenItem,
  type ResolvedAccount,
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

export type AppMode = "basic" | "pro";
export type DockTab = "radar" | "trade" | "scanner" | "book" | "orders";

interface AppContextValue {
  config: TmaConfig;
  authStatus: TelegramAuthStatus;
  authError: string | null;
  sessionToken: string | null;
  astroId: AstroIdProfile;
  activeAccount: ResolvedAccount | null;
  setActiveAccountAddress: (addr: string) => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  activeTab: DockTab;
  setActiveTab: (tab: DockTab) => void;
  selectedAsset: string;
  setSelectedAsset: (assetId: string) => void;
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
  refreshCatalog: () => Promise<void>;
  retryAuth: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const config = useMemo(
    () => parseTmaConfig(import.meta.env as Record<string, unknown>),
    [],
  );

  const [authStatus, setAuthStatus] = useState<TelegramAuthStatus>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [astroId, setAstroId] = useState<AstroIdProfile>({
    found: false,
    source: "none",
    accounts: [],
  });
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [mode, setModeState] = useState<AppMode>("basic");
  const [activeTab, setActiveTabState] = useState<DockTab>("radar");
  const [selectedAsset, setSelectedAsset] = useState<string>("XLM");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [catalog, setCatalog] = useState<CatalogTokenItem[]>([]);
  const [xlmUsd, setXlmUsd] = useState<number | null>(null);
  const [launchpadTokens, setLaunchpadTokens] = useState<AppContextValue["launchpadTokens"]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const base = config.apiBaseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/v1/markets/overview`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        xlmUsd?: { priceUsd?: number } | null;
        launchpadTokens?: AppContextValue["launchpadTokens"];
        catalog?: CatalogTokenItem[];
      };
      setXlmUsd(json.xlmUsd?.priceUsd ?? null);
      setLaunchpadTokens(json.launchpadTokens ?? []);
      if (Array.isArray(json.catalog) && json.catalog.length > 0) {
        setCatalog(json.catalog);
      }
    } catch {
      // Keep graceful offline fallback
    } finally {
      setCatalogLoading(false);
    }
  }, [config.apiBaseUrl]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  const applyStartParam = useCallback((rawParam: string) => {
    const parsed = parseAstroDexStartAppParam(rawParam);
    if (!parsed) return;
    if (parsed.kind === "token") {
      setSelectedAsset(parsed.assetId);
      setActiveTabState("trade");
    } else if (parsed.kind === "scan") {
      setSelectedAsset(parsed.assetId);
      setActiveTabState("scanner");
    } else if (parsed.kind === "pair") {
      setSelectedAsset(parsed.pairId);
      setActiveTabState("trade");
    } else if (parsed.kind === "tab") {
      const tabSet = new Set<DockTab>(["radar", "trade", "scanner", "book", "orders"]);
      if (tabSet.has(parsed.tab as DockTab)) {
        setActiveTabState(parsed.tab as DockTab);
      }
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

  const setMode = useCallback((next: AppMode) => {
    triggerTelegramHaptic("selection");
    setModeState(next);
  }, []);

  const setActiveTab = useCallback((next: DockTab) => {
    triggerTelegramHaptic("selection");
    setActiveTabState(next);
  }, []);

  return (
    <AppContext.Provider
      value={{
        config,
        authStatus,
        authError,
        sessionToken,
        astroId,
        activeAccount,
        setActiveAccountAddress: setSelectedAddress,
        mode,
        setMode,
        activeTab,
        setActiveTab,
        selectedAsset,
        setSelectedAsset,
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
