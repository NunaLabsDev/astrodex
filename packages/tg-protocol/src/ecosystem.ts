import {
  AstroIdProfileSchema,
  defaultCapabilitiesForKind,
  type AccountKind,
  type AstroIdProfile,
  type IdentityResolverPort,
  type ResolvedAccount,
} from "@astrodex/domain";

export interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  },
) => Promise<MinimalFetchResponse>;

export interface AstroIdResolverConfig {
  astroWalletApiBaseUrl?: string | undefined;
  astroGateApiBaseUrl?: string | undefined;
  fetchFn?: FetchLike | undefined;
}

function sanitizeSvgMarkup(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!/^<svg[\s>]/i.test(trimmed) || !/<\/svg>$/i.test(trimmed)) return undefined;
  if (/<script\b|<foreignObject\b|javascript:/i.test(trimmed)) return undefined;
  return trimmed.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function normalizeAccounts(
  rawAccounts: ReadonlyArray<{
    address?: string;
    kind?: string;
    label?: string;
    isDefault?: boolean;
  }>,
  fallbackPrimary?: string,
): ResolvedAccount[] {
  const out: ResolvedAccount[] = [];
  const seen = new Set<string>();

  for (const item of rawAccounts) {
    const addr = item.address?.trim();
    if (!addr || seen.has(addr)) continue;
    if (!/^[GC][A-Z2-7]{55}$/.test(addr)) continue;
    seen.add(addr);
    const kind: AccountKind =
      item.kind === "smart" || addr.startsWith("C") ? "smart" : "classic";
    out.push({
      address: addr,
      kind,
      label: item.label?.trim().slice(0, 32) || (kind === "smart" ? "Smart Account" : "Primary"),
      isDefault: Boolean(item.isDefault),
      capabilities: defaultCapabilitiesForKind(kind),
    });
  }

  if (out.length === 0 && fallbackPrimary && /^[GC][A-Z2-7]{55}$/.test(fallbackPrimary)) {
    const kind: AccountKind = fallbackPrimary.startsWith("C") ? "smart" : "classic";
    out.push({
      address: fallbackPrimary,
      kind,
      label: "Primary",
      isDefault: true,
      capabilities: defaultCapabilitiesForKind(kind),
    });
  }

  return out;
}

/**
 * Resolves public G.../C... identities from AstroWallet (primary AstroID SSO directory)
 * with transitional fallback to AstroGate's public wallet directory.
 * Never requests or propagates encryptedVaultBundle / AGVAULT secrets.
 */
export function createAstroIdResolver(config: AstroIdResolverConfig): IdentityResolverPort {
  const fetchFn =
    config.fetchFn ??
    ((globalThis as unknown as { fetch?: FetchLike }).fetch);

  return {
    async resolveIdentity(rawQuery: string): Promise<AstroIdProfile> {
      const query = rawQuery.trim().replace(/^@/, "");
      if (!query || typeof fetchFn !== "function") {
        return { found: false, source: "none", accounts: [] };
      }

      // 1. Primary: AstroWallet AstroID SSO Directory
      if (config.astroWalletApiBaseUrl) {
        const base = config.astroWalletApiBaseUrl.replace(/\/+$/, "");
        try {
          const res = await fetchFn(
            `${base}/v1/identity/resolve?q=${encodeURIComponent(query)}`,
            { headers: { Accept: "application/json" } },
          );
          if (res.ok) {
            const json = (await res.json()) as {
              ok?: boolean;
              found?: boolean;
              telegramUserId?: string;
              username?: string;
              primaryAddress?: string;
              accounts?: Array<{
                address?: string;
                kind?: string;
                label?: string;
                isDefault?: boolean;
              }>;
              sorobitTokenId?: string;
              sorobitSvg?: string;
            };
            if (json.ok && json.found) {
              const accounts = normalizeAccounts(json.accounts ?? [], json.primaryAddress);
              const primaryAddress =
                accounts.find((a) => a.isDefault)?.address ?? accounts[0]?.address;
              if (primaryAddress) {
                return AstroIdProfileSchema.parse({
                  found: true,
                  source: "astrowallet",
                  telegramUserId: json.telegramUserId,
                  usernameLower: json.username?.replace(/^@/, "").toLowerCase(),
                  primaryAddress,
                  accounts,
                  sorobitTokenId: json.sorobitTokenId,
                  sorobitSvg: sanitizeSvgMarkup(json.sorobitSvg),
                });
              }
            }
          }
        } catch {
          // Fall through cleanly to AstroGate transitional fallback
        }
      }

      // 2. Transitional Fallback: AstroGate Public Wallet Directory
      if (config.astroGateApiBaseUrl) {
        const base = config.astroGateApiBaseUrl.replace(/\/+$/, "");
        try {
          const res = await fetchFn(
            `${base}/api/v1/wallet/resolve?q=${encodeURIComponent(query)}`,
            { headers: { Accept: "application/json" } },
          );
          if (res.ok) {
            const json = (await res.json()) as {
              ok?: boolean;
              found?: boolean;
              tgUserId?: number;
              username?: string;
              primaryPublicKey?: string;
              wallets?: string[];
            };
            if (json.ok && json.found && json.primaryPublicKey) {
              const rawAccounts = (json.wallets ?? [json.primaryPublicKey]).map((addr, idx) => ({
                address: addr,
                kind: addr.startsWith("C") ? "smart" : "classic",
                label: idx === 0 ? "Primary" : `Account ${idx + 1}`,
                isDefault: addr === json.primaryPublicKey,
              }));
              const accounts = normalizeAccounts(rawAccounts, json.primaryPublicKey);
              const primaryAddress = accounts[0]?.address;
              if (primaryAddress) {
                return AstroIdProfileSchema.parse({
                  found: true,
                  source: "astrogate",
                  telegramUserId:
                    typeof json.tgUserId === "number" && json.tgUserId > 0
                      ? String(json.tgUserId)
                      : undefined,
                  usernameLower: json.username?.replace(/^@/, "").toLowerCase(),
                  primaryAddress,
                  accounts,
                });
              }
            }
          }
        } catch {
          // Ignore network errors cleanly
        }
      }

      return { found: false, source: "none", accounts: [] };
    },
  };
}
