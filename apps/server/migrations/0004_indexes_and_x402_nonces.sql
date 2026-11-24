-- AstroDex D1 Indexes & x402 Replay Protection (0004_indexes_and_x402_nonces.sql)

CREATE INDEX IF NOT EXISTS idx_signed_intents_status_expires
  ON signed_intents(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_signed_intents_tg_user_created
  ON signed_intents(telegram_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signed_intents_tx_hash
  ON signed_intents(tx_hash);

CREATE INDEX IF NOT EXISTS idx_whale_trades_pair_created
  ON whale_trades(pair_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_alerts_active_asset
  ON price_alerts(active, asset_key);

CREATE INDEX IF NOT EXISTS idx_dex_pairs_base_updated
  ON dex_pairs(base_asset_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS x402_used_nonces (
  nonce_hash TEXT PRIMARY KEY,
  payer TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_x402_used_nonces_created
  ON x402_used_nonces(created_at);
