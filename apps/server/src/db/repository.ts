import type {
  IntentStatus,
  OhlcvCandle,
  OhlcvTimeframe,
  SignedIntent,
  TokenReviewStatus,
  WhaleTrade,
} from "@astrodex/domain";
import type { D1Database } from "@cloudflare/workers-types";

export interface DexTokenRecord {
  assetKey: string;
  kind: "native" | "classic" | "soroban";
  sacId?: string | undefined;
  code: string;
  name?: string | undefined;
  issuer?: string | undefined;
  decimals: number;
  logoUrl?: string | undefined;
  shieldScore: number;
  verifiedLaunchpad: boolean;
  reviewStatus?: TokenReviewStatus | undefined;
  reviewNote?: string | undefined;
  ammVenue?: string | undefined;
  pairId?: string | undefined;
  communityUrl?: string | undefined;
  updatedAt: number;
}

export interface DexPairRecord {
  pairId: string;
  venue: string;
  baseAssetKey: string;
  quoteAssetKey: string;
  reserveBase: string;
  reserveQuote: string;
  lpLockKind: string;
  lastLedger: number;
  updatedAt: number;
}

export interface PriceAlertRecord {
  id: string;
  telegramUserId: string;
  assetKey: string;
  condition: "above" | "below";
  threshold: number;
  active: boolean;
  createdAt: number;
}

export interface DexMetricsSnapshot {
  totalPairs: number;
  totalTokens: number;
  confirmedIntents: number;
  verifiedTxCount: number;
  dau: number;
  wau: number;
  mau: number;
  dailySeries: Array<{ day: string; dau: number; events: number }>;
  platforms: Record<string, number>;
  eventBreakdown: Record<string, number>;
  recentVerifiedTxs: Array<{
    txHash: string;
    actionType: string;
    assetCode?: string | undefined;
    amountEst?: string | undefined;
    createdAt: number;
  }>;
}

export interface DexServerRepository {
  upsertToken(token: DexTokenRecord): Promise<DexTokenRecord>;
  listTokens(limit?: number): Promise<readonly DexTokenRecord[]>;
  upsertPair(pair: DexPairRecord): Promise<void>;
  listPairs(limit?: number): Promise<readonly DexPairRecord[]>;

  upsertCandle(
    pairId: string,
    timeframe: OhlcvTimeframe,
    candle: OhlcvCandle,
  ): Promise<void>;
  listCandles(
    pairId: string,
    timeframe: OhlcvTimeframe,
    limit?: number,
  ): Promise<readonly OhlcvCandle[]>;

  recordWhaleTrade(trade: WhaleTrade): Promise<void>;
  listWhaleTrades(limit?: number): Promise<readonly WhaleTrade[]>;

  addWatchlist(telegramUserId: string, assetKey: string): Promise<void>;
  removeWatchlist(telegramUserId: string, assetKey: string): Promise<boolean>;
  listWatchlist(telegramUserId: string): Promise<readonly string[]>;

  createPriceAlert(alert: PriceAlertRecord): Promise<PriceAlertRecord>;
  listPriceAlerts(telegramUserId: string): Promise<readonly PriceAlertRecord[]>;
  deactivatePriceAlert(telegramUserId: string, alertId: string): Promise<boolean>;

  createSignedIntent(intent: SignedIntent): Promise<SignedIntent>;
  getSignedIntent(intentId: string): Promise<SignedIntent | null>;
  markIntentConfirmed(intentId: string, txHash: string): Promise<SignedIntent | null>;
  markIntentStatus(intentId: string, status: IntentStatus): Promise<SignedIntent | null>;
  isTxHashUsed(txHash: string): Promise<boolean>;

  claimTelegramUpdateId(updateId: number, nowSec?: number): Promise<boolean>;
  incrementRateLimit(input: {
    key: string;
    windowSec: number;
    limit: number;
    nowSec?: number | undefined;
  }): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }>;
  purgeExpiredRecords(nowSec: number): Promise<void>;

  recordDailyUserActivity(input: {
    dayUtc: string;
    userHash: string;
    network: "testnet" | "mainnet";
    platform?: string | undefined;
    lang?: string | undefined;
    nowSec?: number | undefined;
  }): Promise<void>;
  incrementProductEvent(input: {
    dayUtc: string;
    network: "testnet" | "mainnet";
    eventType: string;
    delta?: number | undefined;
    nowSec?: number | undefined;
  }): Promise<void>;
  recordVerifiedTx(input: {
    txHash: string;
    network: "testnet" | "mainnet";
    actionType: string;
    assetCode?: string | undefined;
    amountEst?: string | undefined;
    nowSec?: number | undefined;
  }): Promise<void>;
  getPublicMetricsSnapshot(
    network: "testnet" | "mainnet",
    nowSec?: number,
  ): Promise<DexMetricsSnapshot>;
}

export function createD1Repository(db: D1Database): DexServerRepository {
  return {
    async upsertToken(token) {
      const reviewStatus = token.reviewStatus ?? "verified";
      try {
        await db
          .prepare(
            `INSERT INTO dex_tokens (asset_key, kind, sac_id, code, name, issuer, decimals, logo_url, shield_score, verified_launchpad, review_status, review_note, amm_venue, pair_id, community_url, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(asset_key) DO UPDATE SET
               sac_id = COALESCE(excluded.sac_id, dex_tokens.sac_id),
               name = COALESCE(excluded.name, dex_tokens.name),
               logo_url = COALESCE(excluded.logo_url, dex_tokens.logo_url),
               shield_score = excluded.shield_score,
               verified_launchpad = MAX(dex_tokens.verified_launchpad, excluded.verified_launchpad),
               review_status = CASE WHEN dex_tokens.review_status = 'official' THEN 'official' ELSE excluded.review_status END,
               review_note = COALESCE(excluded.review_note, dex_tokens.review_note),
               amm_venue = COALESCE(dex_tokens.amm_venue, excluded.amm_venue),
               pair_id = COALESCE(dex_tokens.pair_id, excluded.pair_id),
               community_url = COALESCE(dex_tokens.community_url, excluded.community_url),
               updated_at = excluded.updated_at`,
          )
          .bind(
            token.assetKey,
            token.kind,
            token.sacId ?? null,
            token.code,
            token.name ?? null,
            token.issuer ?? null,
            token.decimals,
            token.logoUrl ?? null,
            token.shieldScore,
            token.verifiedLaunchpad ? 1 : 0,
            reviewStatus,
            token.reviewNote ?? null,
            token.ammVenue ?? null,
            token.pairId ?? null,
            token.communityUrl ?? null,
            token.updatedAt,
          )
          .run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!/column|no such/i.test(msg)) throw err;
        // Fallback when running against D1 before 0002_community_listings.sql is applied
        await db
          .prepare(
            `INSERT INTO dex_tokens (asset_key, kind, sac_id, code, issuer, decimals, logo_url, shield_score, verified_launchpad, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(asset_key) DO UPDATE SET
               sac_id = COALESCE(excluded.sac_id, dex_tokens.sac_id),
               logo_url = COALESCE(excluded.logo_url, dex_tokens.logo_url),
               shield_score = excluded.shield_score,
               verified_launchpad = MAX(dex_tokens.verified_launchpad, excluded.verified_launchpad),
               updated_at = excluded.updated_at`,
          )
          .bind(
            token.assetKey,
            token.kind,
            token.sacId ?? null,
            token.code,
            token.issuer ?? null,
            token.decimals,
            token.logoUrl ?? null,
            token.shieldScore,
            token.verifiedLaunchpad ? 1 : 0,
            token.updatedAt,
          )
          .run();
      }
      const row = await db
        .prepare("SELECT * FROM dex_tokens WHERE asset_key = ?1")
        .bind(token.assetKey)
        .first<Record<string, unknown>>();
      if (!row) return token;
      return {
        assetKey: String(row.asset_key),
        kind: row.kind as DexTokenRecord["kind"],
        sacId: typeof row.sac_id === "string" ? row.sac_id : undefined,
        code: String(row.code),
        name: typeof row.name === "string" ? row.name : undefined,
        issuer: typeof row.issuer === "string" ? row.issuer : undefined,
        decimals: Number(row.decimals ?? 7),
        logoUrl: typeof row.logo_url === "string" ? row.logo_url : undefined,
        shieldScore: Number(row.shield_score ?? 50),
        verifiedLaunchpad: Number(row.verified_launchpad ?? 0) === 1,
        reviewStatus:
          row.review_status === "official" ||
          row.review_status === "verified" ||
          row.review_status === "unreviewed_warning"
            ? row.review_status
            : undefined,
        reviewNote: typeof row.review_note === "string" ? row.review_note : undefined,
        ammVenue: typeof row.amm_venue === "string" ? row.amm_venue : undefined,
        pairId: typeof row.pair_id === "string" ? row.pair_id : undefined,
        communityUrl: typeof row.community_url === "string" ? row.community_url : undefined,
        updatedAt: Number(row.updated_at ?? 0),
      };
    },

    async listTokens(limit = 50) {
      const res = await db
        .prepare("SELECT * FROM dex_tokens ORDER BY updated_at DESC LIMIT ?1")
        .bind(limit)
        .all<Record<string, unknown>>();
      return (res.results ?? []).map((r) => ({
        assetKey: String(r.asset_key),
        kind: r.kind as DexTokenRecord["kind"],
        sacId: typeof r.sac_id === "string" ? r.sac_id : undefined,
        code: String(r.code),
        name: typeof r.name === "string" ? r.name : undefined,
        issuer: typeof r.issuer === "string" ? r.issuer : undefined,
        decimals: Number(r.decimals ?? 7),
        logoUrl: typeof r.logo_url === "string" ? r.logo_url : undefined,
        shieldScore: Number(r.shield_score ?? 50),
        verifiedLaunchpad: Number(r.verified_launchpad ?? 0) === 1,
        reviewStatus:
          r.review_status === "official" ||
          r.review_status === "verified" ||
          r.review_status === "unreviewed_warning"
            ? r.review_status
            : undefined,
        reviewNote: typeof r.review_note === "string" ? r.review_note : undefined,
        ammVenue: typeof r.amm_venue === "string" ? r.amm_venue : undefined,
        pairId: typeof r.pair_id === "string" ? r.pair_id : undefined,
        communityUrl: typeof r.community_url === "string" ? r.community_url : undefined,
        updatedAt: Number(r.updated_at ?? 0),
      }));
    },

    async upsertPair(pair) {
      await db
        .prepare(
          `INSERT INTO dex_pairs (pair_id, venue, base_asset_key, quote_asset_key, reserve_base, reserve_quote, lp_lock_kind, last_ledger, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(pair_id) DO UPDATE SET
             reserve_base = excluded.reserve_base,
             reserve_quote = excluded.reserve_quote,
             lp_lock_kind = excluded.lp_lock_kind,
             last_ledger = excluded.last_ledger,
             updated_at = excluded.updated_at`,
        )
        .bind(
          pair.pairId,
          pair.venue,
          pair.baseAssetKey,
          pair.quoteAssetKey,
          pair.reserveBase,
          pair.reserveQuote,
          pair.lpLockKind,
          pair.lastLedger,
          pair.updatedAt,
        )
        .run();
    },

    async listPairs(limit = 50) {
      const res = await db
        .prepare("SELECT * FROM dex_pairs ORDER BY updated_at DESC LIMIT ?1")
        .bind(limit)
        .all<Record<string, unknown>>();
      return (res.results ?? []).map((r) => ({
        pairId: String(r.pair_id),
        venue: String(r.venue),
        baseAssetKey: String(r.base_asset_key),
        quoteAssetKey: String(r.quote_asset_key),
        reserveBase: String(r.reserve_base),
        reserveQuote: String(r.reserve_quote),
        lpLockKind: String(r.lp_lock_kind),
        lastLedger: Number(r.last_ledger ?? 0),
        updatedAt: Number(r.updated_at ?? 0),
      }));
    },

    async upsertCandle(pairId, timeframe, candle) {
      await db
        .prepare(
          `INSERT INTO ohlcv_candles (pair_id, timeframe, bucket_ts, open, high, low, close, volume_base, tx_count)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
           ON CONFLICT(pair_id, timeframe, bucket_ts) DO UPDATE SET
             high = MAX(ohlcv_candles.high, excluded.high),
             low = MIN(ohlcv_candles.low, excluded.low),
             close = excluded.close,
             volume_base = ohlcv_candles.volume_base + excluded.volume_base,
             tx_count = ohlcv_candles.tx_count + 1`,
        )
        .bind(
          pairId,
          timeframe,
          candle.time,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
        )
        .run();
    },

    async listCandles(pairId, timeframe, limit = 120) {
      const res = await db
        .prepare(
          "SELECT bucket_ts, open, high, low, close, volume_base FROM ohlcv_candles WHERE pair_id = ?1 AND timeframe = ?2 ORDER BY bucket_ts DESC LIMIT ?3",
        )
        .bind(pairId, timeframe, limit)
        .all<Record<string, unknown>>();
      return (res.results ?? [])
        .map((r) => ({
          time: Number(r.bucket_ts),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: Number(r.volume_base ?? 0),
        }))
        .reverse();
    },

    async recordWhaleTrade(trade) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO whale_trades (tx_hash, pair_id, base_symbol, side, trader_addr, amount_base, amount_xlm, ledger, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(
          trade.txHash.toLowerCase(),
          trade.pairId,
          trade.baseSymbol,
          trade.side,
          trade.traderAddress,
          trade.amountBase,
          trade.amountXlm,
          trade.ledger,
          trade.timestampUnix,
        )
        .run();
    },

    async listWhaleTrades(limit = 30) {
      const res = await db
        .prepare("SELECT * FROM whale_trades ORDER BY created_at DESC LIMIT ?1")
        .bind(limit)
        .all<Record<string, unknown>>();
      return (res.results ?? []).map((r) => ({
        txHash: String(r.tx_hash),
        pairId: String(r.pair_id),
        baseSymbol: String(r.base_symbol),
        side: r.side as "buy" | "sell",
        traderAddress: String(r.trader_addr),
        amountBase: String(r.amount_base),
        amountXlm: String(r.amount_xlm),
        ledger: Number(r.ledger ?? 0),
        timestampUnix: Number(r.created_at ?? 0),
      }));
    },

    async addWatchlist(telegramUserId, assetKey) {
      await db
        .prepare(
          "INSERT OR IGNORE INTO user_watchlists (telegram_user_id, asset_key, created_at) VALUES (?1, ?2, ?3)",
        )
        .bind(telegramUserId, assetKey, Math.floor(Date.now() / 1000))
        .run();
    },

    async removeWatchlist(telegramUserId, assetKey) {
      const res = await db
        .prepare("DELETE FROM user_watchlists WHERE telegram_user_id = ?1 AND asset_key = ?2")
        .bind(telegramUserId, assetKey)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async listWatchlist(telegramUserId) {
      const res = await db
        .prepare(
          "SELECT asset_key FROM user_watchlists WHERE telegram_user_id = ?1 ORDER BY created_at DESC",
        )
        .bind(telegramUserId)
        .all<{ asset_key: string }>();
      return (res.results ?? []).map((r) => r.asset_key);
    },

    async createPriceAlert(alert) {
      await db
        .prepare(
          "INSERT INTO price_alerts (id, telegram_user_id, asset_key, condition, threshold, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(
          alert.id,
          alert.telegramUserId,
          alert.assetKey,
          alert.condition,
          alert.threshold,
          alert.active ? 1 : 0,
          alert.createdAt,
        )
        .run();
      return alert;
    },

    async listPriceAlerts(telegramUserId) {
      const res = await db
        .prepare(
          "SELECT * FROM price_alerts WHERE telegram_user_id = ?1 AND active = 1 ORDER BY created_at DESC",
        )
        .bind(telegramUserId)
        .all<Record<string, unknown>>();
      return (res.results ?? []).map((r) => ({
        id: String(r.id),
        telegramUserId: String(r.telegram_user_id),
        assetKey: String(r.asset_key),
        condition: r.condition as "above" | "below",
        threshold: Number(r.threshold),
        active: Number(r.active) === 1,
        createdAt: Number(r.created_at),
      }));
    },

    async deactivatePriceAlert(telegramUserId, alertId) {
      const res = await db
        .prepare(
          "UPDATE price_alerts SET active = 0 WHERE telegram_user_id = ?1 AND id = ?2",
        )
        .bind(telegramUserId, alertId)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async createSignedIntent(intent) {
      await db
        .prepare(
          `INSERT INTO signed_intents (intent_id, telegram_user_id, network, action_type, sub_action, source_address, payload_json, xdr_sha256, hmac_sig, status, chat_id, message_id, inline_message_id, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
        )
        .bind(
          intent.intentId,
          intent.creatorTelegramUserId,
          intent.network,
          intent.actionType,
          intent.subAction,
          intent.sourceAddress,
          intent.payloadJson,
          intent.xdrSha256,
          intent.hmacSig,
          intent.status,
          intent.chatId ?? null,
          intent.messageId ?? null,
          intent.inlineMessageId ?? null,
          intent.expiresAt,
          intent.createdAt,
        )
        .run();
      return intent;
    },

    async getSignedIntent(intentId) {
      const r = await db
        .prepare("SELECT * FROM signed_intents WHERE intent_id = ?1")
        .bind(intentId)
        .first<Record<string, unknown>>();
      if (!r) return null;
      return {
        intentId: String(r.intent_id),
        network: r.network as SignedIntent["network"],
        creatorTelegramUserId: String(r.telegram_user_id),
        actionType: r.action_type as SignedIntent["actionType"],
        subAction: r.sub_action as SignedIntent["subAction"],
        sourceAddress: String(r.source_address),
        payloadJson: String(r.payload_json),
        xdrSha256: String(r.xdr_sha256),
        hmacSig: String(r.hmac_sig),
        status: r.status as IntentStatus,
        chatId: typeof r.chat_id === "string" ? r.chat_id : undefined,
        messageId: typeof r.message_id === "string" ? r.message_id : undefined,
        inlineMessageId: typeof r.inline_message_id === "string" ? r.inline_message_id : undefined,
        txHash: typeof r.tx_hash === "string" ? r.tx_hash : undefined,
        expiresAt: Number(r.expires_at),
        createdAt: Number(r.created_at),
      };
    },

    async markIntentConfirmed(intentId, txHash) {
      await db
        .prepare("UPDATE signed_intents SET status = 'confirmed', tx_hash = ?2 WHERE intent_id = ?1")
        .bind(intentId, txHash.toLowerCase())
        .run();
      return this.getSignedIntent(intentId);
    },

    async markIntentStatus(intentId, status) {
      await db
        .prepare("UPDATE signed_intents SET status = ?2 WHERE intent_id = ?1")
        .bind(intentId, status)
        .run();
      return this.getSignedIntent(intentId);
    },

    async isTxHashUsed(txHash) {
      const row = await db
        .prepare("SELECT intent_id FROM signed_intents WHERE LOWER(tx_hash) = LOWER(?1) LIMIT 1")
        .bind(txHash)
        .first();
      return row !== null;
    },

    async claimTelegramUpdateId(updateId, nowSec = Math.floor(Date.now() / 1000)) {
      const res = await db
        .prepare(
          "INSERT OR IGNORE INTO processed_tg_updates (update_id, processed_at) VALUES (?1, ?2)",
        )
        .bind(updateId, nowSec)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    async incrementRateLimit(input) {
      const now = input.nowSec ?? Math.floor(Date.now() / 1000);
      const windowStart = Math.floor(now / input.windowSec) * input.windowSec;
      const retryAfterSeconds = Math.max(1, windowStart + input.windowSec - now);
      const row = await db
        .prepare(
          `INSERT INTO rate_limits (key, window_start, count)
           VALUES (?1, ?2, 1)
           ON CONFLICT(key) DO UPDATE SET
             count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
             window_start = excluded.window_start
           RETURNING count`,
        )
        .bind(input.key, windowStart)
        .first<{ count: number }>();
      const count = Number(row?.count ?? 1);
      return {
        allowed: count <= input.limit,
        count,
        retryAfterSeconds,
      };
    },

    async purgeExpiredRecords(nowSec) {
      await db.batch([
        db.prepare("DELETE FROM signed_intents WHERE status = 'pending' AND expires_at < ?1").bind(nowSec),
        db.prepare("DELETE FROM processed_tg_updates WHERE processed_at < ?1").bind(nowSec - 86_400),
        db.prepare("DELETE FROM rate_limits WHERE window_start < ?1").bind(nowSec - 3_600),
      ]);
    },

    async recordDailyUserActivity(input) {
      const now = input.nowSec ?? Math.floor(Date.now() / 1000);
      const platform = (input.platform ?? "unknown").slice(0, 32) || "unknown";
      const lang = (input.lang ?? "en").slice(0, 16) || "en";
      try {
        await db
          .prepare(
            `INSERT INTO daily_user_activity (day_utc, user_hash, network, platform, lang, first_seen_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(day_utc, user_hash, network) DO UPDATE SET
               platform = CASE WHEN excluded.platform != 'unknown' THEN excluded.platform ELSE daily_user_activity.platform END,
               lang = excluded.lang,
               last_seen_at = excluded.last_seen_at`,
          )
          .bind(input.dayUtc, input.userHash, input.network, platform, lang, now, now)
          .run();
      } catch {
        // Ignore gracefully before migration 0003
      }
    },

    async incrementProductEvent(input) {
      const now = input.nowSec ?? Math.floor(Date.now() / 1000);
      const delta = Math.max(1, Math.floor(input.delta ?? 1));
      try {
        await db
          .prepare(
            `INSERT INTO product_events_daily (day_utc, network, event_type, count, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(day_utc, network, event_type) DO UPDATE SET
               count = product_events_daily.count + excluded.count,
               updated_at = excluded.updated_at`,
          )
          .bind(input.dayUtc, input.network, input.eventType, delta, now)
          .run();
      } catch {
        // Ignore gracefully before migration 0003
      }
    },

    async recordVerifiedTx(input) {
      const now = input.nowSec ?? Math.floor(Date.now() / 1000);
      try {
        await db
          .prepare(
            `INSERT OR IGNORE INTO verified_tx_log (tx_hash, network, action_type, asset_code, amount_est, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
          .bind(
            input.txHash.toLowerCase(),
            input.network,
            input.actionType,
            input.assetCode ?? null,
            input.amountEst ?? null,
            now,
          )
          .run();
      } catch {
        // Ignore gracefully before migration 0003
      }
    },

    async getPublicMetricsSnapshot(network, nowSec) {
      const nowMs = (nowSec ?? Math.floor(Date.now() / 1000)) * 1000;
      const dayUtc = new Date(nowMs).toISOString().slice(0, 10);
      const day7Utc = new Date(nowMs - 6 * 86_400_000).toISOString().slice(0, 10);
      const day30Utc = new Date(nowMs - 29 * 86_400_000).toISOString().slice(0, 10);

      const safeFirst = async <T>(sql: string, ...binds: unknown[]): Promise<T | null> => {
        try {
          return await db.prepare(sql).bind(...binds).first<T>();
        } catch {
          return null;
        }
      };
      const safeAll = async <T>(sql: string, ...binds: unknown[]): Promise<T[]> => {
        try {
          const res = await db.prepare(sql).bind(...binds).all<T>();
          return res.results ?? [];
        } catch {
          return [];
        }
      };

      const [
        pairsRow,
        tokensRow,
        intentsRow,
        dauRow,
        wauRow,
        mauRow,
        dauSeriesRows,
        eventSeriesRows,
        platformRows,
        eventBreakdownRows,
        verifiedCountRow,
        verifiedTxRows,
      ] = await Promise.all([
        safeFirst<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM dex_pairs"),
        safeFirst<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM dex_tokens"),
        safeFirst<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM signed_intents WHERE network = ?1 AND status = 'confirmed'",
          network,
        ),
        safeFirst<{ cnt: number }>(
          "SELECT COUNT(DISTINCT user_hash) AS cnt FROM daily_user_activity WHERE network = ?1 AND day_utc = ?2",
          network,
          dayUtc,
        ),
        safeFirst<{ cnt: number }>(
          "SELECT COUNT(DISTINCT user_hash) AS cnt FROM daily_user_activity WHERE network = ?1 AND day_utc >= ?2",
          network,
          day7Utc,
        ),
        safeFirst<{ cnt: number }>(
          "SELECT COUNT(DISTINCT user_hash) AS cnt FROM daily_user_activity WHERE network = ?1 AND day_utc >= ?2",
          network,
          day30Utc,
        ),
        safeAll<{ day: string; dau: number }>(
          "SELECT day_utc AS day, COUNT(DISTINCT user_hash) AS dau FROM daily_user_activity WHERE network = ?1 AND day_utc >= ?2 GROUP BY day_utc ORDER BY day_utc ASC",
          network,
          day30Utc,
        ),
        safeAll<{ day: string; events: number }>(
          "SELECT day_utc AS day, SUM(count) AS events FROM product_events_daily WHERE network = ?1 AND day_utc >= ?2 GROUP BY day_utc ORDER BY day_utc ASC",
          network,
          day30Utc,
        ),
        safeAll<{ platform: string; cnt: number }>(
          "SELECT platform, COUNT(DISTINCT user_hash) AS cnt FROM daily_user_activity WHERE network = ?1 AND day_utc >= ?2 GROUP BY platform",
          network,
          day30Utc,
        ),
        safeAll<{ event_type: string; cnt: number }>(
          "SELECT event_type, SUM(count) AS cnt FROM product_events_daily WHERE network = ?1 AND day_utc >= ?2 GROUP BY event_type ORDER BY cnt DESC",
          network,
          day30Utc,
        ),
        safeFirst<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM verified_tx_log WHERE network = ?1",
          network,
        ),
        safeAll<{
          tx_hash: string;
          action_type: string;
          asset_code: string | null;
          amount_est: string | null;
          created_at: number;
        }>(
          "SELECT tx_hash, action_type, asset_code, amount_est, created_at FROM verified_tx_log WHERE network = ?1 ORDER BY created_at DESC LIMIT 15",
          network,
        ),
      ]);

      const seriesMap = new Map<string, { day: string; dau: number; events: number }>();
      for (const r of dauSeriesRows) {
        seriesMap.set(r.day, { day: r.day, dau: Number(r.dau) || 0, events: 0 });
      }
      for (const r of eventSeriesRows) {
        const prev = seriesMap.get(r.day) ?? { day: r.day, dau: 0, events: 0 };
        prev.events = Number(r.events) || 0;
        seriesMap.set(r.day, prev);
      }

      const platforms: Record<string, number> = {};
      for (const r of platformRows) {
        platforms[r.platform || "unknown"] = Number(r.cnt) || 0;
      }
      const eventBreakdown: Record<string, number> = {};
      for (const r of eventBreakdownRows) {
        eventBreakdown[r.event_type] = Number(r.cnt) || 0;
      }

      const recentVerifiedTxs = verifiedTxRows.map((r) => ({
        txHash: r.tx_hash,
        actionType: r.action_type,
        ...(r.asset_code ? { assetCode: r.asset_code } : {}),
        ...(r.amount_est ? { amountEst: r.amount_est } : {}),
        createdAt: Number(r.created_at) || 0,
      }));
      const confirmedIntents = Number(intentsRow?.cnt ?? 0);

      return {
        totalPairs: Number(pairsRow?.cnt ?? 0),
        totalTokens: Number(tokensRow?.cnt ?? 0),
        confirmedIntents,
        verifiedTxCount: Math.max(Number(verifiedCountRow?.cnt ?? 0), confirmedIntents),
        dau: Number(dauRow?.cnt ?? 0),
        wau: Number(wauRow?.cnt ?? 0),
        mau: Number(mauRow?.cnt ?? 0),
        dailySeries: Array.from(seriesMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
        platforms,
        eventBreakdown,
        recentVerifiedTxs,
      };
    },
  };
}

export function createInMemoryRepository(): DexServerRepository {
  const tokens = new Map<string, DexTokenRecord>();
  const pairs = new Map<string, DexPairRecord>();
  const candles = new Map<string, OhlcvCandle>();
  const whales = new Map<string, WhaleTrade>();
  const watchlists = new Map<string, Set<string>>();
  const alerts = new Map<string, PriceAlertRecord>();
  const intents = new Map<string, SignedIntent>();
  const tgUpdates = new Set<number>();
  const rateLimits = new Map<string, { windowStart: number; count: number }>();
  const dauSet = new Map<string, { day: string; userHash: string; platform: string }>();
  const eventCounts = new Map<string, { day: string; eventType: string; count: number }>();
  const verifiedTxs = new Map<
    string,
    { txHash: string; actionType: string; assetCode?: string; amountEst?: string; createdAt: number }
  >();

  return {
    async upsertToken(token) {
      const existing = tokens.get(token.assetKey);
      const saved: DexTokenRecord = {
        ...token,
        sacId: token.sacId ?? existing?.sacId,
        name: token.name ?? existing?.name,
        logoUrl: token.logoUrl ?? existing?.logoUrl,
        verifiedLaunchpad: Boolean(existing?.verifiedLaunchpad || token.verifiedLaunchpad),
        reviewStatus:
          existing?.reviewStatus === "official" ? "official" : token.reviewStatus,
        reviewNote: token.reviewNote ?? existing?.reviewNote,
        ammVenue: existing?.ammVenue ?? token.ammVenue,
        pairId: existing?.pairId ?? token.pairId,
        communityUrl: existing?.communityUrl ?? token.communityUrl,
      };
      tokens.set(token.assetKey, saved);
      return saved;
    },
    async listTokens(limit = 50) {
      return Array.from(tokens.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
    },
    async upsertPair(pair) {
      pairs.set(pair.pairId, pair);
    },
    async listPairs(limit = 50) {
      return Array.from(pairs.values())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
    },
    async upsertCandle(pairId, timeframe, candle) {
      const key = `${pairId}:${timeframe}:${candle.time}`;
      const existing = candles.get(key);
      if (!existing) {
        candles.set(key, { ...candle });
        return;
      }
      candles.set(key, {
        time: candle.time,
        open: existing.open,
        high: Math.max(existing.high, candle.high),
        low: Math.min(existing.low, candle.low),
        close: candle.close,
        volume: existing.volume + candle.volume,
      });
    },
    async listCandles(pairId, timeframe, limit = 120) {
      const prefix = `${pairId}:${timeframe}:`;
      return Array.from(candles.entries())
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v)
        .sort((a, b) => a.time - b.time)
        .slice(-limit);
    },
    async recordWhaleTrade(trade) {
      whales.set(trade.txHash.toLowerCase(), trade);
    },
    async listWhaleTrades(limit = 30) {
      return Array.from(whales.values())
        .sort((a, b) => b.timestampUnix - a.timestampUnix)
        .slice(0, limit);
    },
    async addWatchlist(telegramUserId, assetKey) {
      const set = watchlists.get(telegramUserId) ?? new Set<string>();
      set.add(assetKey);
      watchlists.set(telegramUserId, set);
    },
    async removeWatchlist(telegramUserId, assetKey) {
      return watchlists.get(telegramUserId)?.delete(assetKey) ?? false;
    },
    async listWatchlist(telegramUserId) {
      return Array.from(watchlists.get(telegramUserId) ?? []);
    },
    async createPriceAlert(alert) {
      alerts.set(alert.id, alert);
      return alert;
    },
    async listPriceAlerts(telegramUserId) {
      return Array.from(alerts.values()).filter(
        (a) => a.telegramUserId === telegramUserId && a.active,
      );
    },
    async deactivatePriceAlert(telegramUserId, alertId) {
      const existing = alerts.get(alertId);
      if (!existing || existing.telegramUserId !== telegramUserId) return false;
      alerts.set(alertId, { ...existing, active: false });
      return true;
    },
    async createSignedIntent(intent) {
      intents.set(intent.intentId, intent);
      return intent;
    },
    async getSignedIntent(intentId) {
      return intents.get(intentId) ?? null;
    },
    async markIntentConfirmed(intentId, txHash) {
      const existing = intents.get(intentId);
      if (!existing) return null;
      const next: SignedIntent = { ...existing, status: "confirmed", txHash: txHash.toLowerCase() };
      intents.set(intentId, next);
      return next;
    },
    async markIntentStatus(intentId, status) {
      const existing = intents.get(intentId);
      if (!existing) return null;
      const next: SignedIntent = { ...existing, status };
      intents.set(intentId, next);
      return next;
    },
    async isTxHashUsed(txHash) {
      const target = txHash.toLowerCase();
      for (const intent of intents.values()) {
        if (intent.txHash?.toLowerCase() === target) return true;
      }
      return false;
    },
    async claimTelegramUpdateId(updateId) {
      if (tgUpdates.has(updateId)) return false;
      tgUpdates.add(updateId);
      return true;
    },
    async incrementRateLimit(input) {
      const now = input.nowSec ?? Math.floor(Date.now() / 1000);
      const windowStart = Math.floor(now / input.windowSec) * input.windowSec;
      const retryAfterSeconds = Math.max(1, windowStart + input.windowSec - now);
      const prev = rateLimits.get(input.key);
      const count = prev && prev.windowStart === windowStart ? prev.count + 1 : 1;
      rateLimits.set(input.key, { windowStart, count });
      return { allowed: count <= input.limit, count, retryAfterSeconds };
    },
    async purgeExpiredRecords(nowSec) {
      for (const [id, intent] of intents) {
        if (intent.status === "pending" && intent.expiresAt < nowSec) {
          intents.delete(id);
        }
      }
    },
    async recordDailyUserActivity(input) {
      dauSet.set(`${input.dayUtc}:${input.userHash}:${input.network}`, {
        day: input.dayUtc,
        userHash: input.userHash,
        platform: input.platform ?? "unknown",
      });
    },
    async incrementProductEvent(input) {
      const k = `${input.dayUtc}:${input.network}:${input.eventType}`;
      const prev = eventCounts.get(k);
      eventCounts.set(k, {
        day: input.dayUtc,
        eventType: input.eventType,
        count: (prev?.count ?? 0) + (input.delta ?? 1),
      });
    },
    async recordVerifiedTx(input) {
      verifiedTxs.set(input.txHash.toLowerCase(), {
        txHash: input.txHash.toLowerCase(),
        actionType: input.actionType,
        ...(input.assetCode ? { assetCode: input.assetCode } : {}),
        ...(input.amountEst ? { amountEst: input.amountEst } : {}),
        createdAt: input.nowSec ?? Math.floor(Date.now() / 1000),
      });
    },
    async getPublicMetricsSnapshot() {
      const uniqueUsers = new Set(Array.from(dauSet.values()).map((d) => d.userHash));
      const platforms: Record<string, number> = {};
      const eventBreakdown: Record<string, number> = {};
      for (const d of dauSet.values()) {
        platforms[d.platform] = (platforms[d.platform] ?? 0) + 1;
      }
      for (const ev of eventCounts.values()) {
        eventBreakdown[ev.eventType] = (eventBreakdown[ev.eventType] ?? 0) + ev.count;
      }
      return {
        totalPairs: pairs.size,
        totalTokens: tokens.size,
        confirmedIntents: Array.from(intents.values()).filter((i) => i.status === "confirmed").length,
        verifiedTxCount: verifiedTxs.size,
        dau: uniqueUsers.size,
        wau: uniqueUsers.size,
        mau: uniqueUsers.size,
        dailySeries: [],
        platforms,
        eventBreakdown,
        recentVerifiedTxs: Array.from(verifiedTxs.values()).slice(0, 15),
      };
    },
  };
}
