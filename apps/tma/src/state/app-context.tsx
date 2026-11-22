import {
  defaultCapabilitiesForKind,
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
  resolvePublicIdentity: (query: string) => Promise<{ ok: boolean; message: string }>;
  disconnectPublicIdentity: () => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  activeTab: DockTab;
  setActiveTab: (tab: DockTab) => void;
  selectedAsset: string;
  setSelectedAsset: (assetId: string) => void;
  defaultPairAsset: string;
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
        setSelectedAddress(json.primaryAddress ?? json.accounts[0]?.address ?? null);
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
    const astro = catalog.find((t) => t.code.toUpperCase() === "ASTRO");
    if (astro) return astro.assetKey;
    const usdc = catalog.find((t) => t.code.toUpperCase() === "USDC");
    if (usdc) return usdc.assetKey;
    return catalog.find((t) => t.assetKey !== "XLM")?.assetKey ?? "XLM";
  }, [catalog]);

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
        resolvePublicIdentity,
        disconnectPublicIdentity,
        mode,
        setMode,
        activeTab,
        setActiveTab,
        selectedAsset,
        setSelectedAsset,
        defaultPairAsset,
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
