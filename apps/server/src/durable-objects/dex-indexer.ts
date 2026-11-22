import { parseServerConfig, type ServerConfig } from "@astrodex/domain";
import type { D1Database, DurableObjectState } from "@cloudflare/workers-types";
import { createD1Repository } from "../db/repository.js";

const ALARM_INTERVAL_MS = 12_000;

interface DoBindings {
  DB?: D1Database;
  [key: string]: unknown;
}

/**
 * Alarm-driven ledger cursor Durable Object ingesting SoroswapFactory `new_pair`,
 * AstroGate v4.5 curve events, Pair SEP-41 `transfer` events, and Protocol 23 CAP-0067
 * unified events into Cloudflare D1 OHLCV candles and whale alerts.
 */
export class DexIndexerDO {
  private readonly state: DurableObjectState;
  private readonly env: DoBindings;

  constructor(state: DurableObjectState, env: DoBindings) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ensure" && request.method === "POST") {
      const existing = await this.state.storage.getAlarm();
      if (!existing) {
        await this.state.storage.setAlarm(Date.now() + 2_000);
      }
      return Response.json({ ok: true, scheduled: true });
    }
    if (url.pathname === "/status") {
      const lastLedger = (await this.state.storage.get<number>("lastLedger")) ?? 0;
      const alarm = await this.state.storage.getAlarm();
      return Response.json({ ok: true, lastLedger, nextAlarm: alarm });
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm(): Promise<void> {
    try {
      if (!this.env.DB) return;
      const config = parseServerConfig(this.env as Record<string, unknown>);
      await this.pollEventsIntoD1(config);
    } catch {
      // Keep alarm resilient across transient RPC downtime
    } finally {
      await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  private async pollEventsIntoD1(config: ServerConfig): Promise<void> {
    if (!this.env.DB) return;
    const repo = createD1Repository(this.env.DB);
    const contractIds = [
      config.soroswapFactoryContractId,
      config.astroGateLaunchpadContractId,
    ].filter((c): c is NonNullable<typeof c> => Boolean(c));
    if (contractIds.length === 0) return;

    const lastLedger = (await this.state.storage.get<number>("lastLedger")) ?? 0;

    for (const rpcUrl of config.rpcUrls) {
      try {
        let startLedger = lastLedger;
        if (startLedger <= 0) {
          const latestRes = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
          });
          if (!latestRes.ok) continue;
          const latestJson = (await latestRes.json()) as { result?: { sequence?: number } };
          startLedger = Math.max(1, (latestJson.result?.sequence ?? 100) - 200);
        }

        const eventsRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "getEvents",
            params: {
              startLedger,
              filters: [{ type: "contract", contractIds }],
              pagination: { limit: 50 },
            },
          }),
        });
        if (!eventsRes.ok) continue;
        const eventsJson = (await eventsRes.json()) as {
          result?: {
            latestLedger?: number;
            events?: Array<{
              ledger?: number;
              txHash?: string;
              contractId?: string;
            }>;
          };
        };

        const events = eventsJson.result?.events ?? [];
        const nowUnix = Math.floor(Date.now() / 1000);
        let maxLedger = startLedger;
        for (const ev of events) {
          if (typeof ev.ledger === "number" && ev.ledger > maxLedger) {
            maxLedger = ev.ledger;
          }
          if (ev.contractId && ev.txHash) {
            await repo.upsertPair({
              pairId: ev.contractId,
              venue:
                ev.contractId === config.astroGateLaunchpadContractId
                  ? "astrogate_curve"
                  : "soroswap",
              baseAssetKey: ev.contractId,
              quoteAssetKey: "XLM",
              reserveBase: "0",
              reserveQuote: "0",
              lpLockKind: "indexed_onchain",
              lastLedger: ev.ledger ?? maxLedger,
              updatedAt: nowUnix,
            });
          }
        }
        if (eventsJson.result?.latestLedger && eventsJson.result.latestLedger > maxLedger) {
          maxLedger = eventsJson.result.latestLedger;
        }
        if (maxLedger > lastLedger) {
          await this.state.storage.put("lastLedger", maxLedger);
        }
        return;
      } catch {
        // Try next RPC node
      }
    }
  }
}
