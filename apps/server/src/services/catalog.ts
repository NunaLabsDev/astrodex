import {
  computeSoroswapAmountOut,
  curveFeeBpsForOrder,
  deriveContractIdForAsset,
  fetchSoroswapDirectPairReserves,
  localCurveQuoteBuy,
  localCurveQuoteSell,
} from "@astrodex/dex-aggregator";
import {
  formatStroops7,
  normalizeAssetIdentifier,
  type CatalogTokenItem,
  type OrderbookLevel,
  type OrderbookSnapshot,
  type ServerConfig,
  type TokenReviewStatus,
} from "@astrodex/domain";
import { fetchSep42VerifiedAssets, type Sep42VerifiedAsset } from "@astrodex/stellar-scanner";
import type { DexPairRecord, DexServerRepository, DexTokenRecord } from "../db/repository.js";
import type { adaptFetch } from "../stellar-verifier.js";

type AdaptedFetch = ReturnType<typeof adaptFetch>;

export interface LaunchpadTokenSummary {
  id?: string | undefined;
  symbol?: string | undefined;
  name?: string | undefined;
  logoUrl?: string | undefined;
  graduated?: boolean | undefined;
  graduationPercent?: number | undefined;
  curveXlmNetStroops?: string | undefined;
  reserveXlmStroops?: string | undefined;
  reserveXlm?: string | undefined;
  pairId?: string | null | undefined;
}

export interface UnifiedCatalogSnapshot {
  tokens: readonly DexTokenRecord[];
  pairs: readonly DexPairRecord[];
  sep42Assets: readonly Sep42VerifiedAsset[];
  launchpadTokens: readonly LaunchpadTokenSummary[];
  catalog: readonly CatalogTokenItem[];
}

export interface ResolvedAssetTarget {
  input: string;
  resolvedKey: string;
  classicAsset?: string | undefined;
  sorobanContractId?: string | undefined;
  pairId?: string | undefined;
  catalogItem?: CatalogTokenItem | undefined;
}

function isValidAssetKeyFormat(raw: string): boolean {
  try {
    normalizeAssetIdentifier(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a read-only feed ServerConfig targeting Mainnet or Testnet when requested via `?net=mainnet`.
 * Never alters signing/intent validation network rules.
 */
export function resolveReadFeedConfig(
  baseConfig: ServerConfig,
  requestedNet?: string | null,
): ServerConfig {
  const cleanNet = (requestedNet ?? "").trim().toLowerCase();
  if (
    cleanNet === "mainnet" &&
    baseConfig.network !== "mainnet" &&
    baseConfig.mainnetNetworkPassphrase &&
    baseConfig.mainnetHorizonUrls.length > 0 &&
    baseConfig.mainnetRpcUrls.length > 0
  ) {
    return {
      ...baseConfig,
      network: "mainnet",
      networkPassphrase: baseConfig.mainnetNetworkPassphrase,
      rpcUrls: baseConfig.mainnetRpcUrls,
      horizonUrls: baseConfig.mainnetHorizonUrls,
      sep42AssetListUrls:
        baseConfig.mainnetSep42AssetListUrls.length > 0
          ? baseConfig.mainnetSep42AssetListUrls
          : baseConfig.sep42AssetListUrls,
      soroswapFactoryContractId: baseConfig.mainnetSoroswapFactoryContractId,
      soroswapRouterContractId: baseConfig.mainnetSoroswapRouterContractId,
      xlmSacContractId: baseConfig.mainnetXlmSacContractId,
      reflectorDexOracleContractId: baseConfig.mainnetReflectorDexOracleContractId,
      redstoneSep40OracleContractId: baseConfig.mainnetRedstoneSep40OracleContractId,
      chainlinkPriceProxyContractId: baseConfig.mainnetChainlinkPriceProxyContractId,
      astroGateApiBaseUrl: undefined,
      astroGateLaunchpadContractId: undefined,
      friendbotUrl: undefined,
    };
  }
  return baseConfig;
}

export interface StellarExpertMarketMetric {
  code: string;
  issuer?: string;
  contract?: string;
  priceUsd?: number;
  change24hPct?: number;
  change7dPct?: number;
  volume7dUsd?: number;
  marketCapUsd?: number;
  holdersCount?: number;
  tradesCount?: number;
  rating?: number;
  domain?: string;
  logoUrl?: string;
  sparkline7d?: number[];
}

const CURATED_MAINNET_COMMUNITY_ASSETS: ReadonlyArray<{
  code: string;
  issuer: string;
  name: string;
  domain: string;
  sacId?: string;
  ammVenue: string;
  category: "ethena_yield" | "omnichain_stable" | "defi" | "community_hub";
  reviewStatus?: TokenReviewStatus;
  shieldScore?: number;
}> = [
  {
    code: "USDE",
    issuer: "GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47",
    name: "Ethena USDe",
    domain: "ethena.fi",
    sacId: "CCNOV6XVI2O5BSTA3232GIRUQULDEBV7IWGKM6QKI6II5OIIQTU24JJN",
    ammVenue: "soroswap",
    category: "ethena_yield",
    reviewStatus: "official",
    shieldScore: 98,
  },
  {
    code: "SUSDE",
    issuer: "GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47",
    name: "Ethena Staked USDe",
    domain: "ethena.fi",
    sacId: "CACSKWC753QVGC4J6YPDBIR2BEHFVWIAE7CBSS3HOVYMN623OAIQYE2M",
    ammVenue: "soroswap",
    category: "ethena_yield",
    reviewStatus: "official",
    shieldScore: 98,
  },
  {
    code: "USDT0",
    issuer: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    name: "Tether USDT0 (LayerZero OFT)",
    domain: "usdt0.to",
    sacId: "CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF",
    ammVenue: "soroswap",
    category: "omnichain_stable",
    reviewStatus: "official",
    shieldScore: 98,
  },
  {
    code: "xLMNR",
    issuer: "GDKA6WVMFSA73BMEVKPO6WXSSWP4MPRBDJVSXLLSEVIEVH226L5RJ7NL",
    name: "Lumenaire",
    domain: "thelumenaire.com",
    sacId: "CCEIVLOFQHALNB2ZVQJW55OYKEL7GG52JIGLUGHLRTEAFMISNSMOM5XW",
    ammVenue: "soroswap",
    category: "community_hub",
  },
  {
    code: "LIBRE",
    issuer: "GAYCCWKECNGDRHYU3UTREBD2XLC3CUQN6FV22TKM4WCQER3IWR7TF5CY",
    name: "LIBRE",
    domain: "librequidity.org",
    sacId: "CBEM2CAIYLM3HBOPU5HLQL7V5BUAKM3N77DYQKX4FNHTQLQUUD2ZFBOX",
    ammVenue: "soroswap",
    category: "community_hub",
  },
  {
    code: "SVR",
    issuer: "GAGORNGHVJP5X2QO2NNIIDXKLNHVWJWXC5S73EZNCHOALGFTB2V25YGF",
    name: "SVRToken",
    domain: "svrtoken.com",
    ammVenue: "sdex_pool",
    category: "community_hub",
  },
  {
    code: "ACT",
    issuer: "GAHHULDPDVGB5WS5PH7BCGLJ7ZHECDBIIMKB62UPVDUOCHNFL7HX3FS7",
    name: "Authentic Payment",
    domain: "authentic-payment.com",
    sacId: "CAU7TR4L52CSCYOLOPXPJJ7T6EMEXTEE4XKRH2ASY23EFYEMU5WUFYP2",
    ammVenue: "sdex_pool",
    category: "community_hub",
  },
  {
    code: "SSLX",
    issuer: "GBHFGY3ZNEJWLNO4LBUKLYOCEK4V7ENEBJGPRHHX7JU47GWHBREH37UR",
    name: "Sl8",
    domain: "sslx.sl8.online",
    sacId: "CBHBD77PWZ3AXPQVYVDBHDKEMVNOR26UZUZHWCB6QC7J5SETQPRUQAS4",
    ammVenue: "soroswap",
    category: "community_hub",
  },
  {
    code: "XTAR",
    issuer: "GAORYJ3KBDGIM7FFSKVUJHJ5NEFWIRDIAGGBJBJS7TY6ECZS53257IG4",
    name: "Dogstar",
    domain: "dogstarcoin.com",
    sacId: "CDCKFBZYF2AQCSM3JOF2ZM27O3Y6AJAI4OTCQKAFNZ3FHBYUTFOKICIY",
    ammVenue: "sdex_pool",
    category: "community_hub",
  },
  {
    code: "MIXT",
    issuer: "GAW3RURUECGLNMBVWJZTNPL3I27EWQ47Y4XGV3N4A3DQS5F742CAKXGZ",
    name: "MIXT",
    domain: "mixt.ing",
    ammVenue: "sdex_pool",
    category: "community_hub",
  },
  {
    code: "BLND",
    issuer: "GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY",
    name: "Blend",
    domain: "blend.capital",
    sacId: "CD25MNVTZDL4Y3XBCPCJXGXATV5WUHHOWMYFF4YBEGU5FCPGMYTVG5JY",
    ammVenue: "soroswap",
    category: "defi",
  },
  {
    code: "PHO",
    issuer: "GAX5TXB5RYJNLBUR477PEXM4X75APK2PGMTN6KEFQSESGWFXEAKFSXJO",
    name: "Phoenix",
    domain: "app.phoenix-hub.io",
    sacId: "CBZ7M5B3Y4WWBZ5XK5UZCAFOEZ23KSSZXYECYX3IXM6E2JOLQC52DK32",
    ammVenue: "phoenix",
    category: "defi",
  },
  {
    code: "SCOP",
    issuer: "GC6OYQJIZF3HFXCYPFCBXYXNGIBQ4TNSFUBUXQJOZWIP6F3YZK4QH3VQ",
    name: "Scopuly",
    domain: "scopuly.com",
    sacId: "CCJVS6IVXAAXWCMFVK6QLWHZHR4RTVRSEZRQ53GOAEDN3VY2BLPVY72J",
    ammVenue: "sdex_pool",
    category: "defi",
  },
  {
    code: "SHX",
    issuer: "GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH",
    name: "Stronghold",
    domain: "stronghold.co",
    sacId: "CCKCKCPHYVXQD4NECBFJTFSCU2AMSJGCNG4O6K4JVRE2BLPR7WNDBQIQ",
    ammVenue: "sdex_pool",
    category: "defi",
  },
  {
    code: "LMT",
    issuer: "GBCDFFU2MBT25YX2TBFS4V2XHIJVTGHGK3H6KGA2NIK7X5NK3UFRC6BQ",
    name: "Liquid Monetary",
    domain: "liquidmonetary.xmint.io",
    ammVenue: "sdex_pool",
    category: "community_hub",
  },
];

interface StellarExpertAssetRecord {
  asset?: string;
  price?: number;
  code?: string;
  contract?: string;
  supply?: string;
  trades?: number;
  price7d?: Array<[number, number]>;
  volume7d?: number;
  trustlines?: { total?: number; funded?: number };
  rating?: { average?: number };
  domain?: string;
  tomlInfo?: { issuer?: string; image?: string };
}

function parseStellarExpertMetric(rec: StellarExpertAssetRecord): {
  keys: string[];
  metric: StellarExpertMarketMetric;
} | null {
  const code = rec.code?.trim();
  if (!code) return null;
  const parts = rec.asset?.split("-") ?? [];
  const issuer =
    rec.tomlInfo?.issuer ??
    (parts[1] && /^G[A-Z2-7]{55}$/.test(parts[1]) ? parts[1] : undefined);
  const contract = rec.contract && /^C[A-Z2-7]{55}$/.test(rec.contract) ? rec.contract : undefined;
  const priceUsd = typeof rec.price === "number" && Number.isFinite(rec.price) && rec.price > 0
    ? rec.price
    : undefined;

  const sparkline = (rec.price7d ?? [])
    .map((pt) => Number(pt[1]))
    .filter((n) => Number.isFinite(n) && n > 0);

  let change24hPct: number | undefined;
  let change7dPct: number | undefined;
  if (sparkline.length >= 2) {
    const first = sparkline[0]!;
    const prevDay = sparkline[sparkline.length - 2]!;
    const latest = priceUsd ?? sparkline[sparkline.length - 1]!;
    if (first > 0) change7dPct = Number((((latest - first) / first) * 100).toFixed(2));
    if (prevDay > 0) change24hPct = Number((((latest - prevDay) / prevDay) * 100).toFixed(2));
  }

  const volume7dUsd =
    typeof rec.volume7d === "number" && Number.isFinite(rec.volume7d) && priceUsd
      ? Number(((rec.volume7d / 1e7) * priceUsd).toFixed(2))
      : undefined;
  const supplyNum = rec.supply ? Number(rec.supply) / 1e7 : 0;
  const marketCapUsd =
    supplyNum > 0 && priceUsd ? Number((supplyNum * priceUsd).toFixed(2)) : undefined;

  const metric: StellarExpertMarketMetric = {
    code,
    ...(issuer ? { issuer } : {}),
    ...(contract ? { contract } : {}),
    ...(priceUsd !== undefined ? { priceUsd } : {}),
    ...(change24hPct !== undefined ? { change24hPct } : {}),
    ...(change7dPct !== undefined ? { change7dPct } : {}),
    ...(volume7dUsd !== undefined ? { volume7dUsd } : {}),
    ...(marketCapUsd !== undefined ? { marketCapUsd } : {}),
    ...(rec.trustlines?.funded !== undefined
      ? { holdersCount: rec.trustlines.funded }
      : rec.trustlines?.total !== undefined
        ? { holdersCount: rec.trustlines.total }
        : {}),
    ...(typeof rec.trades === "number" ? { tradesCount: rec.trades } : {}),
    ...(typeof rec.rating?.average === "number" ? { rating: rec.rating.average } : {}),
    ...(rec.domain ? { domain: rec.domain } : {}),
    ...(rec.tomlInfo?.image ? { logoUrl: rec.tomlInfo.image } : {}),
    ...(sparkline.length >= 2 ? { sparkline7d: sparkline } : {}),
  };

  const keys: string[] = [];
  if (code.toUpperCase() === "XLM" && !issuer) keys.push("XLM");
  if (issuer) keys.push(`${code}:${issuer}`.toUpperCase());
  if (contract) keys.push(contract.toUpperCase());
  keys.push(`CODE:${code.toUpperCase()}`);
  return { keys, metric };
}

export async function fetchStellarExpertMarketMap(
  config: ServerConfig,
  fetchFn: AdaptedFetch,
): Promise<Map<string, StellarExpertMarketMetric>> {
  const map = new Map<string, StellarExpertMarketMetric>();
  if (config.network !== "mainnet" || !config.stellarExpertApiBase) return map;

  const seBase = config.stellarExpertApiBase.replace(/\/+$/, "");
  try {
    const res = await fetchFn(
      `${seBase}/explorer/public/asset?sort=rating&order=desc&limit=80`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        _embedded?: { records?: StellarExpertAssetRecord[] };
      };
      for (const rec of json._embedded?.records ?? []) {
        const parsed = parseStellarExpertMetric(rec);
        if (!parsed) continue;
        for (const k of parsed.keys) {
          if (!map.has(k)) map.set(k, parsed.metric);
        }
      }
    }
  } catch {
    // Non-fatal fallback
  }

  // Ensure curated community assets not in top-80 rating also get live metrics
  const missing = CURATED_MAINNET_COMMUNITY_ASSETS.filter(
    (c) => !map.has(`${c.code}:${c.issuer}`.toUpperCase()),
  );
  await Promise.all(
    missing.slice(0, 12).map(async (c) => {
      try {
        const r = await fetchFn(
          `${seBase}/explorer/public/asset?search=${encodeURIComponent(c.code)}&sort=rating&order=desc&limit=3`,
          { headers: { Accept: "application/json" } },
        );
        if (!r.ok) return;
        const j = (await r.json()) as { _embedded?: { records?: StellarExpertAssetRecord[] } };
        const match = (j._embedded?.records ?? []).find((rec) =>
          rec.asset?.toUpperCase().includes(c.issuer.toUpperCase()),
        );
        if (!match) return;
        const parsed = parseStellarExpertMetric(match);
        if (!parsed) return;
        for (const k of parsed.keys) {
          if (!map.has(k)) map.set(k, parsed.metric);
        }
      } catch {
        // ignore individual search errors
      }
    }),
  );

  return map;
}

export async function fetchSingleTokenStellarExpertMetric(
  config: ServerConfig,
  code: string,
  issuer: string | undefined,
  fetchFn: AdaptedFetch,
): Promise<StellarExpertMarketMetric | null> {
  if (config.network !== "mainnet" || !config.stellarExpertApiBase) return null;
  const seBase = config.stellarExpertApiBase.replace(/\/+$/, "");
  try {
    const r = await fetchFn(
      `${seBase}/explorer/public/asset?search=${encodeURIComponent(code)}&sort=rating&order=desc&limit=5`,
      { headers: { Accept: "application/json" } },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { _embedded?: { records?: StellarExpertAssetRecord[] } };
    const records = j._embedded?.records ?? [];
    const match = issuer
      ? records.find((rec) => rec.asset?.toUpperCase().includes(issuer.toUpperCase()))
      : records.find((rec) => rec.code?.toUpperCase() === code.toUpperCase());
    if (!match) return null;
    return parseStellarExpertMetric(match)?.metric ?? null;
  } catch {
    return null;
  }
}

export async function buildUnifiedCatalog(
  config: ServerConfig,
  repo: DexServerRepository,
  fetchFn: AdaptedFetch,
  options: { includeRepoTokens?: boolean } = {},
): Promise<UnifiedCatalogSnapshot> {
  const includeRepo = options.includeRepoTokens ?? true;
  const [tokens, pairs, sep42Assets, launchpadTokens, marketMap] = await Promise.all([
    includeRepo ? repo.listTokens(100) : Promise.resolve([]),
    includeRepo ? repo.listPairs(60) : Promise.resolve([]),
    fetchSep42VerifiedAssets(config.sep42AssetListUrls, fetchFn).catch(() => []),
    (async (): Promise<LaunchpadTokenSummary[]> => {
      if (!config.astroGateApiBaseUrl) return [];
      const base = config.astroGateApiBaseUrl.replace(/\/+$/, "");
      const res = await fetchFn(`${base}/api/v1/tokens`, {
        headers: { Accept: "application/json" },
      }).catch(() => null);
      if (!res?.ok) return [];
      const json = (await res.json().catch(() => null)) as { tokens?: unknown[] } | null;
      return Array.isArray(json?.tokens) ? (json.tokens as LaunchpadTokenSummary[]) : [];
    })(),
    fetchStellarExpertMarketMap(config, fetchFn),
  ]);

  const catalogMap = new Map<string, CatalogTokenItem>();
  catalogMap.set("XLM", {
    assetKey: "XLM",
    kind: "native",
    code: "XLM",
    name: "Stellar Lumens",
    sacId: config.xlmSacContractId,
    decimals: 7,
    shieldScore: 100,
    reviewStatus: "official",
    ammVenue: "sdex_pool",
  });

  for (const item of sep42Assets) {
    const assetKey = item.contract
      ? item.contract.toUpperCase()
      : item.issuer
        ? `${item.code}:${item.issuer.toUpperCase()}`
        : "";
    if (!assetKey || assetKey === "XLM" || catalogMap.has(assetKey)) continue;
    catalogMap.set(assetKey, {
      assetKey,
      kind: item.contract ? "soroban" : "classic",
      code: item.code,
      name: item.name,
      issuer: item.issuer,
      sacId: item.contract,
      decimals: 7,
      logoUrl: item.icon,
      shieldScore: 95,
      reviewStatus: "official",
      ammVenue: item.contract ? "soroswap" : "sdex_pool",
    });
  }

  for (const item of launchpadTokens) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) continue;
    const assetKey = item.id.trim().toUpperCase();
    if (catalogMap.has(assetKey)) continue;
    catalogMap.set(assetKey, {
      assetKey,
      kind: "soroban",
      code: typeof item.symbol === "string" && item.symbol ? item.symbol : "TOKEN",
      name: typeof item.name === "string" ? item.name : undefined,
      sacId: assetKey,
      decimals: 7,
      logoUrl: typeof item.logoUrl === "string" ? item.logoUrl : undefined,
      shieldScore: 85,
      reviewStatus: "verified",
      ammVenue: item.graduated ? "soroswap" : "astrogate_curve",
      pairId: typeof item.pairId === "string" ? item.pairId : undefined,
    });
  }

  for (const t of tokens) {
    const existing = catalogMap.get(t.assetKey);
    const reviewStatus: TokenReviewStatus =
      existing?.reviewStatus === "official"
        ? "official"
        : (t.reviewStatus ?? (t.shieldScore >= 75 ? "verified" : "unreviewed_warning"));
    catalogMap.set(t.assetKey, {
      assetKey: t.assetKey,
      kind: t.kind,
      code: t.code,
      name: t.name ?? existing?.name,
      issuer: t.issuer ?? existing?.issuer,
      sacId: t.sacId ?? existing?.sacId,
      decimals: t.decimals,
      logoUrl: t.logoUrl ?? existing?.logoUrl,
      shieldScore: existing ? Math.max(existing.shieldScore, t.shieldScore) : t.shieldScore,
      reviewStatus,
      reviewNote: t.reviewNote ?? existing?.reviewNote,
      ammVenue: t.ammVenue ?? existing?.ammVenue,
      pairId: t.pairId ?? existing?.pairId,
      communityUrl: t.communityUrl ?? existing?.communityUrl,
    });
  }

  if (config.network === "mainnet") {
    for (const c of CURATED_MAINNET_COMMUNITY_ASSETS) {
      const assetKey = `${c.code}:${c.issuer}`;
      const existingByKey = catalogMap.get(assetKey);
      const existingBySac = c.sacId ? catalogMap.get(c.sacId) : undefined;
      const existing = existingByKey ?? existingBySac;
      if (!existing) {
        catalogMap.set(assetKey, {
          assetKey,
          kind: "classic",
          code: c.code,
          name: c.name,
          issuer: c.issuer,
          sacId: c.sacId,
          decimals: 7,
          shieldScore: c.shieldScore ?? 90,
          reviewStatus: c.reviewStatus ?? "verified",
          category: c.category,
          ammVenue: c.ammVenue,
          domain: c.domain,
        });
      } else if (!existing.category) {
        catalogMap.set(existing.assetKey, {
          ...existing,
          category: c.category,
          ...(c.reviewStatus ? { reviewStatus: c.reviewStatus } : {}),
        });
      }
    }
  }

  for (const [key, item] of catalogMap.entries()) {
    const metric =
      marketMap.get(key.toUpperCase()) ??
      (item.sacId ? marketMap.get(item.sacId.toUpperCase()) : undefined) ??
      (item.issuer ? marketMap.get(`${item.code}:${item.issuer}`.toUpperCase()) : undefined) ??
      (item.reviewStatus === "official" || item.code === "XLM"
        ? marketMap.get(`CODE:${item.code.toUpperCase()}`)
        : undefined);
    if (!metric) continue;
    catalogMap.set(key, {
      ...item,
      logoUrl: item.logoUrl ?? metric.logoUrl,
      domain: item.domain ?? metric.domain,
      priceUsd: metric.priceUsd,
      change24hPct: metric.change24hPct,
      change7dPct: metric.change7dPct,
      volume7dUsd: metric.volume7dUsd,
      marketCapUsd: metric.marketCapUsd,
      holdersCount: metric.holdersCount,
      tradesCount: metric.tradesCount,
      rating: metric.rating,
      sparkline7d: metric.sparkline7d,
    });
  }

  return {
    tokens,
    pairs,
    sep42Assets,
    launchpadTokens,
    catalog: Array.from(catalogMap.values()),
  };
}

function rankMatchScore(item: CatalogTokenItem, lowerQuery: string): number {
  const code = item.code.toLowerCase();
  const name = (item.name ?? "").toLowerCase();
  const key = item.assetKey.toLowerCase();
  const sac = (item.sacId ?? "").toLowerCase();
  const issuer = (item.issuer ?? "").toLowerCase();

  let score = 0;
  if (key === lowerQuery || sac === lowerQuery) score += 1000;
  else if (code === lowerQuery) score += 800;
  else if (name === lowerQuery) score += 700;
  else if (code.startsWith(lowerQuery)) score += 500;
  else if (name.startsWith(lowerQuery)) score += 400;
  else if (code.includes(lowerQuery) || name.includes(lowerQuery) || key.includes(lowerQuery) || issuer.includes(lowerQuery)) {
    score += 200;
  } else {
    return 0;
  }

  if (item.reviewStatus === "official") score += 60;
  else if (item.reviewStatus === "verified") score += 40;
  else score += 10;

  return score;
}

async function fetchExternalAssetCandidates(
  config: ServerConfig,
  rawQuery: string,
  fetchFn: AdaptedFetch,
): Promise<CatalogTokenItem[]> {
  const q = rawQuery.trim();
  if (q.length < 2 || isValidAssetKeyFormat(q)) {
    return [];
  }

  const netSlug = config.network === "mainnet" ? "public" : "testnet";
  const upperCode = q.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const tasks: Array<Promise<CatalogTokenItem[]>> = [];

  if (config.stellarExpertApiBase) {
    const base = config.stellarExpertApiBase.replace(/\/+$/, "");
    tasks.push(
      fetchFn(`${base}/explorer/${netSlug}/asset?search=${encodeURIComponent(q)}&limit=8`, {
        headers: { Accept: "application/json" },
      })
        .then(async (res) => {
          if (!res.ok) return [];
          const json = (await res.json()) as {
            _embedded?: {
              records?: Array<{
                asset?: string;
                code?: string;
                contract?: string;
                domain?: string;
                supply?: string;
                trustlines?: { funded?: number };
              }>;
            };
          };
          const out: CatalogTokenItem[] = [];
          for (const rec of json._embedded?.records ?? []) {
            const parts = (rec.asset ?? "").split("-");
            const code = (rec.code ?? parts[0] ?? "").trim();
            const issuer = parts[1] && /^G[A-Z2-7]{55}$/.test(parts[1]) ? parts[1] : undefined;
            const contract =
              rec.contract && /^C[A-Z2-7]{55}$/.test(rec.contract) ? rec.contract : undefined;
            if (!code) continue;
            const assetKey = contract ?? (issuer ? `${code}:${issuer}` : "");
            if (!assetKey) continue;
            out.push({
              assetKey,
              kind: contract ? "soroban" : "classic",
              code,
              name: rec.domain ? `${code} (${rec.domain})` : code,
              issuer,
              sacId: contract,
              decimals: 7,
              shieldScore: 60,
              reviewStatus: "unreviewed_warning",
              reviewNote: "Indexed from StellarExpert directory — inspect before trading.",
              ammVenue: contract ? "soroswap" : "sdex_pool",
            });
          }
          return out;
        })
        .catch(() => []),
    );
  }

  if (upperCode.length >= 1 && upperCode.length <= 12 && config.horizonUrls[0]) {
    const horizonBase = config.horizonUrls[0].replace(/\/+$/, "");
    tasks.push(
      fetchFn(`${horizonBase}/assets?asset_code=${encodeURIComponent(upperCode)}&limit=5`, {
        headers: { Accept: "application/json" },
      })
        .then(async (res) => {
          if (!res.ok) return [];
          const json = (await res.json()) as {
            _embedded?: {
              records?: Array<{
                asset_code?: string;
                asset_issuer?: string;
              }>;
            };
          };
          const out: CatalogTokenItem[] = [];
          for (const rec of json._embedded?.records ?? []) {
            if (!rec.asset_code || !rec.asset_issuer) continue;
            const assetKey = `${rec.asset_code}:${rec.asset_issuer.toUpperCase()}`;
            out.push({
              assetKey,
              kind: "classic",
              code: rec.asset_code,
              name: `${rec.asset_code} Classic Asset`,
              issuer: rec.asset_issuer.toUpperCase(),
              decimals: 7,
              shieldScore: 55,
              reviewStatus: "unreviewed_warning",
              reviewNote: "Found on Horizon ledger — run Astro Shield scan before trading.",
              ammVenue: "sdex_pool",
            });
          }
          return out;
        })
        .catch(() => []),
    );
  }

  const settled = await Promise.all(tasks);
  return settled.flat();
}

export async function searchCatalogAndNetworkAssets(input: {
  config: ServerConfig;
  repo: DexServerRepository;
  fetchFn: AdaptedFetch;
  query: string;
  limit?: number;
  snapshot?: UnifiedCatalogSnapshot;
  includeRepoTokens?: boolean;
}): Promise<{ snapshot: UnifiedCatalogSnapshot; results: CatalogTokenItem[] }> {
  const snapshot =
    input.snapshot ??
    (await buildUnifiedCatalog(input.config, input.repo, input.fetchFn, {
      includeRepoTokens: input.includeRepoTokens ?? true,
    }));
  const cleanQuery = input.query.trim();
  const limit = input.limit ?? 15;

  if (!cleanQuery) {
    return {
      snapshot,
      results: snapshot.catalog.slice(0, limit),
    };
  }

  // Support pair syntax like "AQUA/XLM" or "AQUA-USDC" by resolving the primary base term
  const pairSplit = cleanQuery.includes("/")
    ? cleanQuery.split("/")[0]?.trim() || cleanQuery
    : cleanQuery.includes("-") && !cleanQuery.startsWith("C") && !cleanQuery.startsWith("G")
      ? cleanQuery.split("-")[0]?.trim() || cleanQuery
      : cleanQuery;
  const lowerQ = pairSplit.toLowerCase();
  const localMatches = snapshot.catalog
    .map((item) => ({ item, score: rankMatchScore(item, lowerQ) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  const shouldQueryExternal = localMatches.length < 4 && !isValidAssetKeyFormat(pairSplit);
  const external = shouldQueryExternal
    ? await fetchExternalAssetCandidates(input.config, pairSplit, input.fetchFn)
    : [];

  const seen = new Set<string>(localMatches.map((m) => m.assetKey.toUpperCase()));
  const merged = [...localMatches];
  for (const ext of external) {
    const keyUpper = ext.assetKey.toUpperCase();
    if (seen.has(keyUpper)) continue;
    seen.add(keyUpper);
    merged.push(ext);
  }

  return {
    snapshot,
    results: merged.slice(0, limit),
  };
}

export async function resolveAssetTarget(input: {
  config: ServerConfig;
  repo: DexServerRepository;
  fetchFn: AdaptedFetch;
  rawAsset: string;
  snapshot?: UnifiedCatalogSnapshot;
  includeRepoTokens?: boolean;
}): Promise<{ snapshot: UnifiedCatalogSnapshot; target: ResolvedAssetTarget }> {
  const snapshot =
    input.snapshot ??
    (await buildUnifiedCatalog(input.config, input.repo, input.fetchFn, {
      includeRepoTokens: input.includeRepoTokens ?? true,
    }));
  const trimmed = input.rawAsset.trim();

  if (!trimmed) {
    return {
      snapshot,
      target: { input: input.rawAsset, resolvedKey: "XLM", sorobanContractId: input.config.xlmSacContractId },
    };
  }

  const findInCatalog = (keyOrTicker: string): CatalogTokenItem | undefined => {
    const lower = keyOrTicker.toLowerCase();
    return (
      snapshot.catalog.find(
        (c) =>
          c.assetKey.toLowerCase() === lower ||
          (c.sacId && c.sacId.toLowerCase() === lower) ||
          (c.issuer && `${c.code}:${c.issuer}`.toLowerCase() === lower),
      ) ??
      snapshot.catalog.find((c) => c.code.toLowerCase() === lower) ??
      snapshot.catalog.find((c) => (c.name ?? "").toLowerCase() === lower)
    );
  };

  let matched = findInCatalog(trimmed);
  let resolvedKey = trimmed;

  if (isValidAssetKeyFormat(trimmed)) {
    const norm = normalizeAssetIdentifier(trimmed);
    resolvedKey = norm.canonicalKey;
    matched = findInCatalog(norm.canonicalKey) ?? matched;
  } else if (matched) {
    resolvedKey = matched.assetKey;
  } else {
    const search = await searchCatalogAndNetworkAssets({
      config: input.config,
      repo: input.repo,
      fetchFn: input.fetchFn,
      query: trimmed,
      limit: 5,
      snapshot,
    });
    const first = search.results[0];
    if (first) {
      matched = first;
      resolvedKey = first.assetKey;
    }
  }

  let classicAsset: string | undefined;
  let sorobanContractId: string | undefined;

  if (matched) {
    if (matched.kind === "native") {
      classicAsset = "XLM";
      sorobanContractId = matched.sacId ?? input.config.xlmSacContractId;
    } else if (matched.issuer) {
      classicAsset = `${matched.code}:${matched.issuer.toUpperCase()}`;
    }
    if (matched.sacId && /^C[A-Z2-7]{55}$/.test(matched.sacId)) {
      sorobanContractId = matched.sacId;
    } else if (matched.kind === "soroban" && /^C[A-Z2-7]{55}$/.test(matched.assetKey)) {
      sorobanContractId = matched.assetKey;
    }
  }

  if (!sorobanContractId && isValidAssetKeyFormat(resolvedKey)) {
    try {
      sorobanContractId = deriveContractIdForAsset(
        resolvedKey,
        input.config.networkPassphrase,
        input.config.xlmSacContractId,
      );
    } catch {
      // Ignore
    }
  }

  if (!classicAsset && isValidAssetKeyFormat(resolvedKey)) {
    const norm = normalizeAssetIdentifier(resolvedKey);
    if (norm.kind === "native" || norm.kind === "classic") {
      classicAsset = norm.canonicalKey;
    }
  }

  const pairId =
    matched?.pairId ??
    snapshot.pairs.find(
      (p) =>
        p.baseAssetKey.toUpperCase() === resolvedKey.toUpperCase() ||
        (sorobanContractId && p.baseAssetKey.toUpperCase() === sorobanContractId.toUpperCase()),
    )?.pairId;

  return {
    snapshot,
    target: {
      input: input.rawAsset,
      resolvedKey,
      classicAsset,
      sorobanContractId,
      pairId,
      catalogItem: matched,
    },
  };
}

export function createConfiguredCurveStateLoader(
  config: ServerConfig,
  fetchFn: AdaptedFetch,
) {
  return async (tokenContractId: string) => {
    if (!config.astroGateApiBaseUrl) return null;
    const base = config.astroGateApiBaseUrl.replace(/\/+$/, "");
    try {
      const res = await fetchFn(
        `${base}/api/v1/tokens/${encodeURIComponent(tokenContractId)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        curve?: {
          graduated?: boolean;
          curveClosed?: boolean;
          curveXlmNetStroops?: string;
          tokensSoldBase?: string;
        } | null;
      };
      if (!json.curve) return null;
      return {
        graduated: Boolean(json.curve.graduated),
        curveClosed: Boolean(json.curve.curveClosed),
        curveXlmNet: BigInt(json.curve.curveXlmNetStroops ?? "0"),
        tokensSold: BigInt(json.curve.tokensSoldBase ?? "0"),
      };
    } catch {
      return null;
    }
  };
}

export function createConfiguredPairReservesLoader(
  config: ServerConfig,
  snapshot: UnifiedCatalogSnapshot,
  fetchFn: AdaptedFetch,
) {
  return async (fromAsset: string, toAsset: string) => {
    try {
      const findContract = (raw: string): string => {
        const lower = raw.toLowerCase();
        const match = snapshot.catalog.find(
          (c) =>
            c.assetKey.toLowerCase() === lower ||
            (c.sacId && c.sacId.toLowerCase() === lower) ||
            (c.issuer && `${c.code}:${c.issuer}`.toLowerCase() === lower),
        );
        if (match?.sacId && /^C[A-Z2-7]{55}$/.test(match.sacId)) {
          return match.sacId;
        }
        if (match?.kind === "soroban" && /^C[A-Z2-7]{55}$/.test(match.assetKey)) {
          return match.assetKey;
        }
        return deriveContractIdForAsset(
          raw,
          config.networkPassphrase,
          config.xlmSacContractId,
        );
      };

      const tokenInContractId = findContract(fromAsset);
      const tokenOutContractId = findContract(toAsset);
      if (tokenInContractId === tokenOutContractId) return null;

      const xlmSac = config.xlmSacContractId?.toUpperCase();
      const nonXlmContract =
        tokenInContractId.toUpperCase() === xlmSac ? tokenOutContractId : tokenInContractId;

      const knownPairId =
        snapshot.catalog.find(
          (c) =>
            (c.assetKey.toUpperCase() === nonXlmContract.toUpperCase() ||
              c.sacId?.toUpperCase() === nonXlmContract.toUpperCase()) &&
            c.ammVenue !== "astrogate_curve",
        )?.pairId ??
        snapshot.pairs.find(
          (p) =>
            p.venue === "soroswap" &&
            (p.baseAssetKey.toUpperCase() === nonXlmContract.toUpperCase() ||
              p.quoteAssetKey.toUpperCase() === nonXlmContract.toUpperCase()),
        )?.pairId;

      return await fetchSoroswapDirectPairReserves({
        rpcUrls: config.rpcUrls,
        factoryContractId: config.soroswapFactoryContractId,
        pairContractId: knownPairId,
        tokenInContractId,
        tokenOutContractId,
        networkPassphrase: config.networkPassphrase,
        fetchFn,
      });
    } catch {
      return null;
    }
  };
}

export async function loadLiveAmmOrderbookAndSpot(input: {
  config: ServerConfig;
  snapshot: UnifiedCatalogSnapshot;
  baseTarget: ResolvedAssetTarget;
  quoteTarget: ResolvedAssetTarget;
  fetchFn: AdaptedFetch;
}): Promise<{
  ammPairInfo: {
    venue: "soroswap" | "astrogate_curve";
    pairId?: string | undefined;
    reserveBaseStroops: string;
    reserveQuoteStroops: string;
    reserveBase: string;
    reserveQuote: string;
    spotPriceQuotePerBase: number;
  } | null;
  syntheticSnapshot: OrderbookSnapshot | null;
}> {
  const baseContract = input.baseTarget.sorobanContractId;
  const quoteContract = input.quoteTarget.sorobanContractId;
  if (!baseContract || !quoteContract || baseContract === quoteContract) {
    return { ammPairInfo: null, syntheticSnapshot: null };
  }

  // 1. Check Soroswap Direct Pair reserves
  const reservesLoader = createConfiguredPairReservesLoader(
    input.config,
    input.snapshot,
    input.fetchFn,
  );
  const soroswapReserves = await reservesLoader(baseContract, quoteContract);
  if (soroswapReserves && soroswapReserves.reserveIn > 0n && soroswapReserves.reserveOut > 0n) {
    const reserveBaseNum = Number(soroswapReserves.reserveIn) / 1e7;
    const reserveQuoteNum = Number(soroswapReserves.reserveOut) / 1e7;
    const midPrice = reserveQuoteNum / reserveBaseNum;
    const stepBps = [50n, 150n, 300n, 600n, 1200n]; // 0.5%, 1.5%, 3%, 6%, 12% of pool reserve

    const bids: OrderbookLevel[] = [];
    const asks: OrderbookLevel[] = [];
    for (const bps of stepBps) {
      const stepBase = (soroswapReserves.reserveIn * bps) / 10_000n;
      if (stepBase < 10_000n || stepBase >= soroswapReserves.reserveIn / 2n) continue;
      const quoteReceived = computeSoroswapAmountOut(
        stepBase,
        soroswapReserves.reserveIn,
        soroswapReserves.reserveOut,
      );
      if (quoteReceived > 0n) {
        const execPrice = Number(quoteReceived) / Number(stepBase);
        bids.push({
          price: execPrice.toFixed(7),
          amount: formatStroops7(stepBase, true),
          totalQuote: formatStroops7(quoteReceived, true),
          venue: "amm_synthetic",
        });
      }

      const approxQuoteIn = (soroswapReserves.reserveOut * bps) / 10_000n;
      if (approxQuoteIn >= 10_000n && approxQuoteIn < soroswapReserves.reserveOut / 2n) {
        const baseOut = computeSoroswapAmountOut(
          approxQuoteIn,
          soroswapReserves.reserveOut,
          soroswapReserves.reserveIn,
        );
        if (baseOut > 0n) {
          const askPrice = Number(approxQuoteIn) / Number(baseOut);
          asks.push({
            price: askPrice.toFixed(7),
            amount: formatStroops7(baseOut, true),
            totalQuote: formatStroops7(approxQuoteIn, true),
            venue: "amm_synthetic",
          });
        }
      }
    }

    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const spreadPct =
      bestBid && bestAsk && Number(bestAsk) > 0
        ? (((Number(bestAsk) - Number(bestBid)) / Number(bestAsk)) * 100).toFixed(2)
        : null;

    return {
      ammPairInfo: {
        venue: "soroswap",
        pairId: soroswapReserves.pairId,
        reserveBaseStroops: soroswapReserves.reserveIn.toString(),
        reserveQuoteStroops: soroswapReserves.reserveOut.toString(),
        reserveBase: formatStroops7(soroswapReserves.reserveIn, true),
        reserveQuote: formatStroops7(soroswapReserves.reserveOut, true),
        spotPriceQuotePerBase: midPrice,
      },
      syntheticSnapshot: {
        baseAsset: input.baseTarget.resolvedKey,
        quoteAsset: input.quoteTarget.resolvedKey,
        bids,
        asks,
        bestBid,
        bestAsk,
        spreadPct,
        timestampUnix: Math.floor(Date.now() / 1000),
      },
    };
  }

  // 2. Check AstroGate Bonding Curve when paired with XLM
  if (input.quoteTarget.resolvedKey === "XLM") {
    const curveLoader = createConfiguredCurveStateLoader(input.config, input.fetchFn);
    const curve = await curveLoader(baseContract);
    if (curve && !curve.graduated && !curve.curveClosed) {
      const buySample = localCurveQuoteBuy(curve.curveXlmNet, curve.tokensSold, 10n * 10_000_000n);
      const sellSample = buySample
        ? localCurveQuoteSell(curve.curveXlmNet, curve.tokensSold, buySample.tokens_out)
        : null;
      void curveFeeBpsForOrder;
      const askPrice = buySample ? Number(10n * 10_000_000n) / Number(buySample.tokens_out) : 0;
      const bidPrice =
        sellSample && buySample ? Number(sellSample.net_xlm_out) / Number(buySample.tokens_out) : 0;
      const spot = askPrice > 0 && bidPrice > 0 ? (askPrice + bidPrice) / 2 : askPrice || bidPrice;

      const bids: OrderbookLevel[] =
        bidPrice > 0 && buySample && sellSample
          ? [
              {
                price: bidPrice.toFixed(7),
                amount: formatStroops7(buySample.tokens_out, true),
                totalQuote: formatStroops7(sellSample.net_xlm_out, true),
                venue: "amm_synthetic",
              },
            ]
          : [];
      const asks: OrderbookLevel[] =
        askPrice > 0 && buySample
          ? [
              {
                price: askPrice.toFixed(7),
                amount: formatStroops7(buySample.tokens_out, true),
                totalQuote: "10",
                venue: "amm_synthetic",
              },
            ]
          : [];

      if (spot > 0) {
        return {
          ammPairInfo: {
            venue: "astrogate_curve",
            reserveBaseStroops: curve.tokensSold.toString(),
            reserveQuoteStroops: curve.curveXlmNet.toString(),
            reserveBase: formatStroops7(curve.tokensSold, true),
            reserveQuote: formatStroops7(curve.curveXlmNet, true),
            spotPriceQuotePerBase: spot,
          },
          syntheticSnapshot: {
            baseAsset: input.baseTarget.resolvedKey,
            quoteAsset: input.quoteTarget.resolvedKey,
            bids,
            asks,
            bestBid: bids[0]?.price ?? null,
            bestAsk: asks[0]?.price ?? null,
            spreadPct:
              bidPrice > 0 && askPrice > bidPrice
                ? (((askPrice - bidPrice) / askPrice) * 100).toFixed(2)
                : null,
            timestampUnix: Math.floor(Date.now() / 1000),
          },
        };
      }
    }
  }

  return { ammPairInfo: null, syntheticSnapshot: null };
}

export interface TokenAmmPoolSummary {
  poolId: string;
  venue: "sdex_pool" | "soroswap" | "astrogate_curve" | "aquarius";
  feeBps: number;
  totalShares: string;
  totalTrustlines: number;
  reserves: Array<{
    assetKey: string;
    code: string;
    issuer?: string;
    amount: string;
  }>;
  counterAssetKey: string;
  counterCode: string;
  spotPriceInCounter: number | null;
  tvlUsd?: number | undefined;
  volume24hUsd?: number | undefined;
  totalApyPct?: number | undefined;
  rewardsApyPct?: number | undefined;
  poolType?: string | undefined;
}

export interface AquariusPoolSummary {
  poolId: string;
  poolType: string;
  feePct: number;
  tokenA: { assetKey: string; code: string; contractId?: string; reserve: string };
  tokenB: { assetKey: string; code: string; contractId?: string; reserve: string };
  tvlUsd: number;
  volume24hUsd: number;
  feeApyPct: number;
  rewardsApyPct: number;
  totalApyPct: number;
}

function parseAquariusTokenStr(raw: string): { assetKey: string; code: string } {
  if (!raw || raw === "native") return { assetKey: "XLM", code: "XLM" };
  const [code] = raw.split(":");
  return { assetKey: raw, code: code || raw };
}

export async function fetchAquariusTopPools(input: {
  config: ServerConfig;
  fetchFn: AdaptedFetch;
  sort?: "volume" | "liquidity" | "apy";
  limit?: number;
  query?: string;
}): Promise<AquariusPoolSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const sortMode = input.sort ?? "volume";
  const q = input.query?.trim().toLowerCase() ?? "";

  if (input.config.network === "mainnet" && input.config.aquariusAmmApiBase) {
    const aquaBase = input.config.aquariusAmmApiBase.replace(/\/+$/, "");
    const sortParam =
      sortMode === "liquidity" ? "-liquidity" : sortMode === "apy" ? "-total_apy" : "-volume";
    try {
      const res = await input.fetchFn(
        `${aquaBase}/pools/?page=1&size=${Math.max(limit, q ? 60 : limit)}&sort=${sortParam}`,
        { headers: { Accept: "application/json" } },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          items?: Array<{
            address?: string;
            pool_type?: string;
            fee?: string;
            tokens_str?: string[];
            tokens_addresses?: string[];
            reserves?: string[];
            liquidity_usd?: string;
            volume_usd?: string;
            apy?: string;
            rewards_apy?: string;
            incentive_apy?: string;
            total_apy?: string;
          }>;
        };
        const out: AquariusPoolSummary[] = [];
        for (const p of json.items ?? []) {
          if (!p.address || !p.tokens_str || p.tokens_str.length < 2) continue;
          const a = parseAquariusTokenStr(p.tokens_str[0]!);
          const b = parseAquariusTokenStr(p.tokens_str[1]!);
          const pool: AquariusPoolSummary = {
            poolId: p.address,
            poolType: p.pool_type ?? "constant_product",
            feePct: Number(p.fee ?? 0) * 100,
            tokenA: {
              ...a,
              ...(p.tokens_addresses?.[0] ? { contractId: p.tokens_addresses[0] } : {}),
              reserve: ((Number(p.reserves?.[0] ?? 0)) / 1e7).toFixed(2),
            },
            tokenB: {
              ...b,
              ...(p.tokens_addresses?.[1] ? { contractId: p.tokens_addresses[1] } : {}),
              reserve: ((Number(p.reserves?.[1] ?? 0)) / 1e7).toFixed(2),
            },
            tvlUsd: Number(p.liquidity_usd ?? 0) / 1e7,
            volume24hUsd: Number(p.volume_usd ?? 0) / 1e7,
            feeApyPct: Number(p.apy ?? 0) * 100,
            rewardsApyPct: (Number(p.rewards_apy ?? 0) + Number(p.incentive_apy ?? 0)) * 100,
            totalApyPct: Number(p.total_apy ?? 0) * 100,
          };
          if (
            q &&
            !pool.tokenA.code.toLowerCase().includes(q) &&
            !pool.tokenB.code.toLowerCase().includes(q) &&
            !pool.poolId.toLowerCase().includes(q)
          ) {
            continue;
          }
          out.push(pool);
          if (out.length >= limit) break;
        }
        return out;
      }
    } catch {
      // Fall back to Horizon liquidity pools below
    }
  }

  const horizonBase = input.config.horizonUrls[0]?.replace(/\/+$/, "");
  if (!horizonBase) return [];
  try {
    const res = await input.fetchFn(`${horizonBase}/liquidity_pools?limit=${limit}&order=desc`);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      _embedded?: {
        records?: Array<{
          id: string;
          fee_bp?: number;
          type?: string;
          reserves?: Array<{ asset: string; amount: string }>;
        }>;
      };
    };
    const out: AquariusPoolSummary[] = [];
    for (const rec of json._embedded?.records ?? []) {
      const r0 = rec.reserves?.[0];
      const r1 = rec.reserves?.[1];
      if (!r0 || !r1) continue;
      const a = parseHorizonReserveAsset(r0.asset);
      const b = parseHorizonReserveAsset(r1.asset);
      if (
        q &&
        !a.code.toLowerCase().includes(q) &&
        !b.code.toLowerCase().includes(q) &&
        !rec.id.toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push({
        poolId: rec.id,
        poolType: rec.type ?? "constant_product",
        feePct: (rec.fee_bp ?? 30) / 100,
        tokenA: { assetKey: a.assetKey, code: a.code, reserve: Number(r0.amount).toFixed(2) },
        tokenB: { assetKey: b.assetKey, code: b.code, reserve: Number(r1.amount).toFixed(2) },
        tvlUsd: 0,
        volume24hUsd: 0,
        feeApyPct: 0,
        rewardsApyPct: 0,
        totalApyPct: 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export interface TokenRecentTradeSummary {
  id: string;
  timestamp: string;
  side: "buy" | "sell";
  baseCode: string;
  counterCode: string;
  baseAmount: string;
  counterAmount: string;
  price: string;
}

function parseHorizonReserveAsset(raw: string): { assetKey: string; code: string; issuer?: string } {
  if (raw === "native") return { assetKey: "XLM", code: "XLM" };
  const [code, issuer] = raw.split(":");
  if (code && issuer) {
    return { assetKey: `${code}:${issuer}`, code, issuer };
  }
  return { assetKey: raw, code: raw };
}

export async function fetchTokenAmmPools(input: {
  config: ServerConfig;
  target: ResolvedAssetTarget;
  snapshot: UnifiedCatalogSnapshot;
  fetchFn: AdaptedFetch;
  limit?: number;
}): Promise<TokenAmmPoolSummary[]> {
  const pools: TokenAmmPoolSummary[] = [];
  const limit = input.limit ?? 20;
  const horizonBase = input.config.horizonUrls[0]?.replace(/\/+$/, "");

  const reserveQuery =
    input.target.resolvedKey === "XLM"
      ? "native"
      : input.target.classicAsset
        ? input.target.classicAsset
        : null;

  if (horizonBase && reserveQuery) {
    try {
      const res = await input.fetchFn(
        `${horizonBase}/liquidity_pools?reserves=${encodeURIComponent(reserveQuery)}&limit=${limit}`,
      );
      if (res.ok) {
        const payload = (await res.json()) as {
          _embedded?: {
            records?: Array<{
              id: string;
              fee_bp?: number;
              total_shares?: string;
              total_trustlines?: number;
              reserves?: Array<{ asset: string; amount: string }>;
            }>;
          };
        };
        for (const rec of payload._embedded?.records ?? []) {
          const parsedReserves = (rec.reserves ?? []).map((r) => ({
            ...parseHorizonReserveAsset(r.asset),
            amount: r.amount,
          }));
          const selfRes = parsedReserves.find(
            (r) =>
              r.assetKey.toUpperCase() === input.target.resolvedKey.toUpperCase() ||
              (input.target.classicAsset &&
                r.assetKey.toUpperCase() === input.target.classicAsset.toUpperCase()),
          );
          const counterRes = parsedReserves.find((r) => r !== selfRes) ?? parsedReserves[0];
          const selfAmt = Number(selfRes?.amount ?? 0);
          const counterAmt = Number(counterRes?.amount ?? 0);
          const spot = selfAmt > 0 && counterAmt > 0 ? counterAmt / selfAmt : null;

          pools.push({
            poolId: rec.id,
            venue: "sdex_pool",
            feeBps: rec.fee_bp ?? 30,
            totalShares: rec.total_shares ?? "0",
            totalTrustlines: rec.total_trustlines ?? 0,
            reserves: parsedReserves,
            counterAssetKey: counterRes?.assetKey ?? "XLM",
            counterCode: counterRes?.code ?? "XLM",
            spotPriceInCounter: spot,
          });
        }
      }
    } catch {
      // ignore Horizon pool fetch errors
    }
  }

  // Sort SDEX pools by trustlines + self reserve descending so active pools appear first
  pools.sort((a, b) => b.totalTrustlines - a.totalTrustlines);

  // Also include Soroswap direct XLM / USDC pair if discoverable
  const xlmSac = input.config.xlmSacContractId;
  const selfNorm = normalizeAssetIdentifier(input.target.resolvedKey);
  const selfContract =
    input.target.sorobanContractId ??
    (input.target.resolvedKey === "XLM" ? xlmSac : undefined);
  if (selfContract && input.target.resolvedKey !== "XLM" && xlmSac) {
    try {
      const reserves = await fetchSoroswapDirectPairReserves({
        rpcUrls: input.config.rpcUrls,
        factoryContractId: input.config.soroswapFactoryContractId,
        tokenInContractId: selfContract,
        tokenOutContractId: xlmSac,
        networkPassphrase: input.config.networkPassphrase,
        fetchFn: input.fetchFn,
      });
      if (reserves && reserves.reserveIn > 0n && reserves.reserveOut > 0n) {
        const selfAmt = Number(reserves.reserveIn) / 1e7;
        const xlmAmt = Number(reserves.reserveOut) / 1e7;
        pools.unshift({
          poolId: reserves.pairId,
          venue: "soroswap",
          feeBps: 30,
          totalShares: "0",
          totalTrustlines: 0,
          reserves: [
            {
              assetKey: input.target.resolvedKey,
              code: selfNorm.code,
              ...(selfNorm.issuer ? { issuer: selfNorm.issuer } : {}),
              amount: selfAmt.toFixed(4),
            },
            {
              assetKey: "XLM",
              code: "XLM",
              amount: xlmAmt.toFixed(4),
            },
          ],
          counterAssetKey: "XLM",
          counterCode: "XLM",
          spotPriceInCounter: selfAmt > 0 ? xlmAmt / selfAmt : null,
        });
      }
    } catch {
      // ignore Soroswap lookup errors
    }
  }

  // Check AstroGate bonding curve if token is in launchpad
  const launchpadMatch = input.snapshot.launchpadTokens.find(
    (t) =>
      t.id?.toUpperCase() === input.target.resolvedKey.toUpperCase() ||
      t.id?.toUpperCase() === selfContract?.toUpperCase(),
  );
  if (launchpadMatch && !launchpadMatch.graduated) {
    pools.unshift({
      poolId: launchpadMatch.id ?? input.target.resolvedKey,
      venue: "astrogate_curve",
      feeBps: 100,
      totalShares: "0",
      totalTrustlines: 0,
      reserves: [
        {
          assetKey: "XLM",
          code: "XLM",
          amount: launchpadMatch.reserveXlm ?? "0",
        },
      ],
      counterAssetKey: "XLM",
      counterCode: "XLM",
      spotPriceInCounter: null,
    });
  }

  // Merge matching Aquarius AMM pools (with TVL, 24h Vol & Total APY) on Mainnet
  if (input.config.network === "mainnet" && input.config.aquariusAmmApiBase) {
    const aquaPools = await fetchAquariusTopPools({
      config: input.config,
      fetchFn: input.fetchFn,
      sort: "volume",
      limit: 12,
      query: selfNorm.code,
    }).catch(() => []);
    for (const ap of aquaPools) {
      if (pools.some((p) => p.poolId === ap.poolId)) continue;
      const isA = ap.tokenA.code.toUpperCase() === selfNorm.code.toUpperCase();
      const counter = isA ? ap.tokenB : ap.tokenA;
      pools.unshift({
        poolId: ap.poolId,
        venue: "aquarius",
        feeBps: Math.round(ap.feePct * 100),
        totalShares: "0",
        totalTrustlines: 0,
        reserves: [
          { assetKey: ap.tokenA.assetKey, code: ap.tokenA.code, amount: ap.tokenA.reserve },
          { assetKey: ap.tokenB.assetKey, code: ap.tokenB.code, amount: ap.tokenB.reserve },
        ],
        counterAssetKey: counter.assetKey,
        counterCode: counter.code,
        spotPriceInCounter: null,
        tvlUsd: ap.tvlUsd,
        volume24hUsd: ap.volume24hUsd,
        totalApyPct: ap.totalApyPct,
        rewardsApyPct: ap.rewardsApyPct,
        poolType: ap.poolType,
      });
    }
  }

  return pools.slice(0, limit);
}

export async function fetchTokenRecentTrades(input: {
  config: ServerConfig;
  baseTarget: ResolvedAssetTarget;
  quoteTarget: ResolvedAssetTarget;
  fetchFn: AdaptedFetch;
  limit?: number;
}): Promise<TokenRecentTradeSummary[]> {
  const horizonBase = input.config.horizonUrls[0]?.replace(/\/+$/, "");
  if (!horizonBase) return [];

  const params = new URLSearchParams({
    limit: String(input.limit ?? 15),
    order: "desc",
  });

  const baseNorm = normalizeAssetIdentifier(
    input.baseTarget.classicAsset ?? input.baseTarget.resolvedKey,
  );
  const quoteNorm = normalizeAssetIdentifier(
    input.quoteTarget.classicAsset ?? input.quoteTarget.resolvedKey,
  );

  if (input.baseTarget.resolvedKey === "XLM") {
    params.set("base_asset_type", "native");
  } else if (baseNorm.issuer) {
    params.set("base_asset_type", baseNorm.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12");
    params.set("base_asset_code", baseNorm.code);
    params.set("base_asset_issuer", baseNorm.issuer);
  } else {
    return [];
  }

  if (input.quoteTarget.resolvedKey === "XLM") {
    params.set("counter_asset_type", "native");
  } else if (quoteNorm.issuer) {
    params.set(
      "counter_asset_type",
      quoteNorm.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
    );
    params.set("counter_asset_code", quoteNorm.code);
    params.set("counter_asset_issuer", quoteNorm.issuer);
  } else {
    return [];
  }

  try {
    const res = await input.fetchFn(`${horizonBase}/trades?${params.toString()}`);
    if (!res.ok) return [];
    const payload = (await res.json()) as {
      _embedded?: {
        records?: Array<{
          id: string;
          ledger_close_time: string;
          base_amount: string;
          counter_amount: string;
          base_is_seller?: boolean;
          price?: { n: number; d: number };
        }>;
      };
    };
    return (payload._embedded?.records ?? []).map((t) => {
      const priceNum = t.price && t.price.d > 0 ? t.price.n / t.price.d : 0;
      return {
        id: t.id,
        timestamp: t.ledger_close_time,
        side: t.base_is_seller ? "sell" : "buy",
        baseCode: baseNorm.code,
        counterCode: quoteNorm.code,
        baseAmount: Number(t.base_amount).toFixed(4),
        counterAmount: Number(t.counter_amount).toFixed(4),
        price: priceNum > 0 ? priceNum.toFixed(6) : "0",
      };
    });
  } catch {
    return [];
  }
}

export interface WalletPortfolioSnapshot {
  address: string;
  network: "mainnet" | "testnet";
  balances: Array<{
    assetKey: string;
    code: string;
    issuer?: string;
    balance: string;
  }>;
  lpPositions: Array<{
    poolId: string;
    shares: string;
    reserves: Array<{ assetKey: string; code: string; amount: string }>;
  }>;
}

export async function fetchWalletPortfolio(input: {
  config: ServerConfig;
  address: string;
  fetchFn: AdaptedFetch;
}): Promise<WalletPortfolioSnapshot> {
  const horizonBase = input.config.horizonUrls[0]?.replace(/\/+$/, "");
  const balances: WalletPortfolioSnapshot["balances"] = [];
  const lpPositions: WalletPortfolioSnapshot["lpPositions"] = [];
  if (!horizonBase) {
    return { address: input.address, network: input.config.network, balances, lpPositions };
  }

  try {
    const res = await input.fetchFn(`${horizonBase}/accounts/${encodeURIComponent(input.address)}`);
    if (!res.ok) {
      return { address: input.address, network: input.config.network, balances, lpPositions };
    }
    const account = (await res.json()) as {
      balances?: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        balance: string;
        liquidity_pool_id?: string;
      }>;
    };

    const rawLps: Array<{ poolId: string; shares: string }> = [];
    for (const b of account.balances ?? []) {
      if (b.asset_type === "native") {
        balances.push({ assetKey: "XLM", code: "XLM", balance: b.balance });
      } else if (b.asset_type === "liquidity_pool_shares" && b.liquidity_pool_id) {
        rawLps.push({ poolId: b.liquidity_pool_id, shares: b.balance });
      } else if (b.asset_code && b.asset_issuer) {
        balances.push({
          assetKey: `${b.asset_code}:${b.asset_issuer}`,
          code: b.asset_code,
          issuer: b.asset_issuer,
          balance: b.balance,
        });
      }
    }

    await Promise.all(
      rawLps.slice(0, 12).map(async (lp) => {
        try {
          const lpRes = await input.fetchFn(`${horizonBase}/liquidity_pools/${encodeURIComponent(lp.poolId)}`);
          if (!lpRes.ok) {
            lpPositions.push({ poolId: lp.poolId, shares: lp.shares, reserves: [] });
            return;
          }
          const lpJson = (await lpRes.json()) as {
            reserves?: Array<{ asset: string; amount: string }>;
          };
          lpPositions.push({
            poolId: lp.poolId,
            shares: lp.shares,
            reserves: (lpJson.reserves ?? []).map((r) => ({
              ...parseHorizonReserveAsset(r.asset),
              amount: r.amount,
            })),
          });
        } catch {
          lpPositions.push({ poolId: lp.poolId, shares: lp.shares, reserves: [] });
        }
      }),
    );
  } catch {
    // ignore account lookup errors
  }

  return {
    address: input.address,
    network: input.config.network,
    balances,
    lpPositions,
  };
}

export interface TokenTopHolderSummary {
  address: string;
  balance: string;
  sharePct: number | null;
}

export async function fetchTokenTopHolders(input: {
  config: ServerConfig;
  target: ResolvedAssetTarget;
  supplyAmount?: string | number | undefined;
  fetchFn: AdaptedFetch;
  limit?: number;
}): Promise<TokenTopHolderSummary[]> {
  const horizonBase = input.config.horizonUrls[0]?.replace(/\/+$/, "");
  if (!horizonBase) return [];

  const limit = Math.min(Math.max(input.limit ?? 15, 1), 30);
  const supplyNum =
    typeof input.supplyAmount === "number"
      ? input.supplyAmount
      : input.supplyAmount
        ? Number(input.supplyAmount)
        : 0;

  if (input.target.resolvedKey === "XLM") {
    try {
      const txRes = await input.fetchFn(`${horizonBase}/transactions?limit=25&order=desc`);
      if (!txRes.ok) return [];
      const txJson = (await txRes.json()) as {
        _embedded?: { records?: Array<{ source_account?: string }> };
      };
      const uniq = new Set<string>();
      for (const rec of txJson._embedded?.records ?? []) {
        if (rec.source_account && /^G[A-Z2-7]{55}$/.test(rec.source_account)) {
          uniq.add(rec.source_account);
        }
        if (uniq.size >= 12) break;
      }
      const list: TokenTopHolderSummary[] = [];
      await Promise.all(
        Array.from(uniq).map(async (addr) => {
          try {
            const accRes = await input.fetchFn(`${horizonBase}/accounts/${encodeURIComponent(addr)}`);
            if (!accRes.ok) return;
            const acc = (await accRes.json()) as {
              balances?: Array<{ asset_type?: string; balance?: string }>;
            };
            const xlm = acc.balances?.find((b) => b.asset_type === "native");
            const val = Number(xlm?.balance ?? 0);
            if (!xlm?.balance || !Number.isFinite(val) || val <= 0) return;
            list.push({
              address: addr,
              balance: xlm.balance,
              sharePct: supplyNum > 0 ? Math.min(100, (val / supplyNum) * 100) : null,
            });
          } catch {
            // ignore account lookup failure
          }
        }),
      );
      list.sort((a, b) => Number(b.balance) - Number(a.balance));
      return list.slice(0, limit);
    } catch {
      return [];
    }
  }

  const norm = normalizeAssetIdentifier(input.target.classicAsset ?? input.target.resolvedKey);
  if (!norm.issuer) return [];
  const assetParam = `${norm.code}:${norm.issuer}`;
  try {
    const res = await input.fetchFn(
      `${horizonBase}/accounts?asset=${encodeURIComponent(assetParam)}&limit=50&order=desc`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      _embedded?: {
        records?: Array<{
          id?: string;
          balances?: Array<{
            asset_code?: string;
            asset_issuer?: string;
            balance?: string;
          }>;
        }>;
      };
    };
    const list: TokenTopHolderSummary[] = [];
    for (const rec of json._embedded?.records ?? []) {
      if (!rec.id) continue;
      const bal = rec.balances?.find(
        (b) => b.asset_code?.toUpperCase() === norm.code.toUpperCase() && b.asset_issuer === norm.issuer,
      );
      const val = Number(bal?.balance ?? 0);
      if (!bal?.balance || !Number.isFinite(val) || val <= 0) continue;
      list.push({
        address: rec.id,
        balance: bal.balance,
        sharePct: supplyNum > 0 ? Math.min(100, (val / supplyNum) * 100) : null,
      });
    }
    list.sort((a, b) => Number(b.balance) - Number(a.balance));
    return list.slice(0, limit);
  } catch {
    return [];
  }
}
