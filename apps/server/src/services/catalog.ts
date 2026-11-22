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
      chainlinkPriceProxyContractId: baseConfig.mainnetChainlinkPriceProxyContractId,
      astroGateApiBaseUrl: undefined,
      astroGateLaunchpadContractId: undefined,
      friendbotUrl: undefined,
    };
  }
  return baseConfig;
}

export async function buildUnifiedCatalog(
  config: ServerConfig,
  repo: DexServerRepository,
  fetchFn: AdaptedFetch,
  options: { includeRepoTokens?: boolean } = {},
): Promise<UnifiedCatalogSnapshot> {
  const includeRepo = options.includeRepoTokens ?? true;
  const [tokens, pairs, sep42Assets, launchpadTokens] = await Promise.all([
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

  const lowerQ = cleanQuery.toLowerCase();
  const localMatches = snapshot.catalog
    .map((item) => ({ item, score: rankMatchScore(item, lowerQ) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  const shouldQueryExternal = localMatches.length < 4 && !isValidAssetKeyFormat(cleanQuery);
  const external = shouldQueryExternal
    ? await fetchExternalAssetCandidates(input.config, cleanQuery, input.fetchFn)
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
