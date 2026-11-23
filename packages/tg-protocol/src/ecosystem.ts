import { createAstroConnectClient } from "@astrowallet/connect";
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

      // 1. Primary: AstroWallet AstroID SSO Directory (via universal @astrowallet/connect)
      if (config.astroWalletApiBaseUrl) {
        try {
          const client = createAstroConnectClient({
            apiBaseUrl: config.astroWalletApiBaseUrl,
            app: { name: "AstroDex", botUsername: "AstroDexBot" },
            fetchFn: fetchFn as unknown as NonNullable<
              Parameters<typeof createAstroConnectClient>[0]["fetchFn"]
            >,
          });
          const resolved = await client.resolveIdentity(query);
          if (resolved.found) {
            const accounts = normalizeAccounts(resolved.accounts ?? [], resolved.primaryAddress);
            const primaryAddress =
              accounts.find((a) => a.isDefault)?.address ?? accounts[0]?.address;
            if (primaryAddress) {
              return AstroIdProfileSchema.parse({
                found: true,
                source: "astrowallet",
                telegramUserId: resolved.telegramUserId,
                usernameLower: resolved.username?.replace(/^@/, "").toLowerCase(),
                primaryAddress,
                accounts,
              });
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
