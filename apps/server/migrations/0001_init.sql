-- AstroDex D1 Schema (0001_init.sql)

CREATE TABLE IF NOT EXISTS dex_tokens (
  asset_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('native', 'classic', 'soroban')),
  sac_id TEXT,
  code TEXT NOT NULL,
  issuer TEXT,
  decimals INTEGER NOT NULL DEFAULT 7,
  logo_url TEXT,
  shield_score INTEGER NOT NULL DEFAULT 50,
  verified_launchpad INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dex_pairs (
  pair_id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  base_asset_key TEXT NOT NULL,
  quote_asset_key TEXT NOT NULL,
  reserve_base TEXT NOT NULL,
  reserve_quote TEXT NOT NULL,
  lp_lock_kind TEXT NOT NULL DEFAULT 'unknown',
  last_ledger INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ohlcv_candles (
  pair_id TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  bucket_ts INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume_base REAL NOT NULL DEFAULT 0,
  volume_quote REAL NOT NULL DEFAULT 0,
  tx_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pair_id, timeframe, bucket_ts)
);

CREATE TABLE IF NOT EXISTS whale_trades (
  tx_hash TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  base_symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  trader_addr TEXT NOT NULL,
  amount_base TEXT NOT NULL,
  amount_xlm TEXT NOT NULL,
  ledger INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_watchlists (
  telegram_user_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (telegram_user_id, asset_key)
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  threshold REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signed_intents (
  intent_id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  network TEXT NOT NULL,
  action_type TEXT NOT NULL,
  sub_action TEXT NOT NULL,
  source_address TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  xdr_sha256 TEXT NOT NULL,
  hmac_sig TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT UNIQUE,
  chat_id TEXT,
  message_id TEXT,
  inline_message_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_tg_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candles_pair_tf ON ohlcv_candles(pair_id, timeframe, bucket_ts DESC);
CREATE INDEX IF NOT EXISTS idx_whales_created ON whale_trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(telegram_user_id, active);
CREATE INDEX IF NOT EXISTS idx_intents_user ON signed_intents(telegram_user_id, created_at DESC);
