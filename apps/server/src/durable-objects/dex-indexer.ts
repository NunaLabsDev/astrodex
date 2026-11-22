import { formatStroops7, parseServerConfig, type ServerConfig } from "@astrodex/domain";
import type { D1Database, DurableObjectState } from "@cloudflare/workers-types";
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { createD1Repository } from "../db/repository.js";

const ALARM_INTERVAL_MS = 12_000;
const WHALE_THRESHOLD_STROOPS = 250n * 10_000_000n;

interface DoBindings {
  DB?: D1Database;
  [key: string]: unknown;
}

function decodeScValSafe(base64Xdr: string): unknown {
  try {
    return scValToNative(xdr.ScVal.fromXDR(base64Xdr, "base64"));
  } catch {
    return null;
  }
}

function extractTransferAmountStroops(val: unknown): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number" && Number.isFinite(val)) return BigInt(Math.trunc(val));
  if (typeof val === "string" && /^\d+$/.test(val)) return BigInt(val);
  if (val && typeof val === "object" && "amount" in val) {
    return extractTransferAmountStroops((val as { amount?: unknown }).amount);
  }
  return 0n;
}

/**
 * Alarm-driven ledger cursor Durable Object following Stellar RPC `getHealth().oldestLedger`
 * clamping and SEP-41 `transfer` + CAP-0067 event indexing for SoroswapFactory,
 * AstroGate v4.5 curves, and native XLM SAC pair swaps.
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
    const factoryIds = [
      config.soroswapFactoryContractId,
      config.astroGateLaunchpadContractId,
    ].filter((c): c is NonNullable<typeof c> => Boolean(c));

    const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
    const filters: Array<Record<string, unknown>> = [];
    if (factoryIds.length > 0) {
      filters.push({ type: "contract", contractIds: factoryIds });
    }
    if (config.xlmSacContractId) {
      filters.push({
        type: "contract",
        contractIds: [config.xlmSacContractId],
        topics: [[transferTopic, "*", "*", "**"]],
      });
    }
    if (filters.length === 0) return;

    const knownPairs = await repo.listPairs(100);
    const pairById = new Map(knownPairs.map((p) => [p.pairId.toUpperCase(), p]));
    const lastLedger = (await this.state.storage.get<number>("lastLedger")) ?? 0;

    for (const rpcUrl of config.rpcUrls) {
      try {
        const healthRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        });
        if (!healthRes.ok) continue;
        const healthJson = (await healthRes.json()) as {
          result?: { latestLedger?: number; oldestLedger?: number };
        };
        const latestLedger = healthJson.result?.latestLedger ?? 0;
        const oldestLedger = healthJson.result?.oldestLedger ?? 1;
        if (latestLedger <= 0) continue;

        const targetStart = lastLedger > 0 ? lastLedger + 1 : Math.max(1, latestLedger - 400);
        const startLedger = Math.max(targetStart, oldestLedger + 10);
        if (startLedger > latestLedger) return;

        const eventsRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "getEvents",
            params: {
              startLedger,
              filters,
              pagination: { limit: 80 },
            },
          }),
        });
        if (!eventsRes.ok) continue;
        const eventsJson = (await eventsRes.json()) as {
          result?: {
            latestLedger?: number;
            events?: Array<{
              ledger?: number;
              ledgerClosedAt?: string;
              txHash?: string;
              contractId?: string;
              topic?: string[];
              value?: string;
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
          if (!ev.contractId || !ev.txHash) continue;

          if (
            ev.contractId === config.soroswapFactoryContractId ||
            ev.contractId === config.astroGateLaunchpadContractId
          ) {
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
            continue;
          }

          if (ev.contractId === config.xlmSacContractId && Array.isArray(ev.topic) && ev.value) {
            const topics = ev.topic.map(decodeScValSafe);
            if (topics[0] !== "transfer") continue;
            const fromAddr = typeof topics[1] === "string" ? topics[1] : "";
            const toAddr = typeof topics[2] === "string" ? topics[2] : "";
            const xlmStroops = extractTransferAmountStroops(decodeScValSafe(ev.value));
            if (xlmStroops <= 0n) continue;

            const toPair = pairById.get(toAddr.toUpperCase());
            const fromPair = pairById.get(fromAddr.toUpperCase());
            const matchedPair = toPair ?? fromPair;
            if (!matchedPair) continue;

            const side = toPair ? "buy" : "sell";
            const traderAddress = toPair ? fromAddr : toAddr;
            const tsSec = ev.ledgerClosedAt
              ? Math.floor(Date.parse(ev.ledgerClosedAt) / 1000) || nowUnix
              : nowUnix;

            if (xlmStroops >= WHALE_THRESHOLD_STROOPS && traderAddress) {
              await repo.recordWhaleTrade({
                txHash: ev.txHash,
                pairId: matchedPair.pairId,
                baseSymbol: matchedPair.baseAssetKey,
                side,
                traderAddress,
                amountBase: "0",
                amountXlm: formatStroops7(xlmStroops, true),
                ledger: ev.ledger ?? maxLedger,
                timestampUnix: tsSec,
              });
            }
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
