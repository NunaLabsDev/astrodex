# AstroDex — Master Vertical-Slice Roadmap

> **Goal:** Deliver a modular, audited, phone-first Stellar Classic (`SDEX`) + Soroban DEX, 5-Way Liquidity Aggregator, and Forensic Token Scanner operating **100% inside Telegram** (`@AstroDexBot`), seamlessly interconnected with **AstroWallet** (`@AstroWalletAppBot`) and **AstroGate v4.4** (`@AstroGateSorobanBot`) with zero hardcoding and full Testnet-to-Mainnet parity.

---

## Milestone 1: Hexagonal Monorepo, Zod Config Matrix & Cross-App Telegram Protocol
*Outcome: Clean TypeScript monorepo enforcing strict DAG boundaries, 100% env-driven Zod config, and verified Telegram `initData` + Cross-App Signed Intent primitives.*

- [ ] Initialize `pnpm` + Turborepo workspace (`pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `eslint.config.mjs` `no-restricted-imports`, `scripts/secret-scan.mjs`, `vitest.config.ts`).
- [ ] **`@astrodex/domain`:**
  - Define pure domain types and ports (`ScannerPort`, `LiquidityRouterPort`, `LimitOrderPort`, `OraclePort`, `IntentPort`, `AgenticPaymentPort`).
  - Implement fail-fast Zod environment schemas (`parseTmaConfig`, `parseServerConfig`) enforcing **Mainnet hard-blocks** (`FRIENDBOT_URL`, plaintext `http://`, and `VITE_ALLOW_DEV_OUTSIDE_TELEGRAM=true` rejected when `STELLAR_NETWORK=mainnet`).
  - Implement unified asset identifier normalization (`XLM`, `CODE:G...`, `C...`, deterministic SAC `C...` derivation).
- [ ] **`@astrodex/tg-protocol`:**
  - Implement `verifyTelegramInitData` (HMAC-SHA256 `WebAppData` + `auth_date <= 300s`), 15m Mini App session tokens, `startapp` parameter parsing (`token_<id>`, `scan_<id>`, `pair_<id>`, `i-<intentId>-<sig>`).
  - Implement Cross-App HMAC-Signed Intent builders & deep-link formatters targeting `@AstroWalletAppBot` (`swap`, `limit_order_create`, `limit_order_cancel`, `extend_ttl`, `buyback_burn`) and `@AstroGateSorobanBot`, plus English-only Telegram card formatters.

---

## Milestone 2: "SDEX Reboot + Soroban X-Ray" Forensic Scanner Engine
*Outcome: Deterministic, real-Testnet token forensics covering Classic assets, Soroban SEP-41 contracts, Protocol 23 TTLs, and Top-10 Holder distribution.*

- [ ] **`@astrodex/stellar-scanner` (`classic/`):**
  - Query Horizon `/assets` and `/accounts/{issuer}` with multi-endpoint failover.
  - Implement mathematical **Issuer Lock** audit (`master_weight === 0` AND combined secondary `signers` weight `< low_threshold`).
  - Decode `AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED`, `AUTH_IMMUTABLE` flags.
  - Port and extend SSRF-safe SEP-0001 `stellar.toml` parser, SDF SEP-42 asset validation, and StellarExpert Directory tags (`#malicious`, `#unsafe`, `#exchange`).
- [ ] **`@astrodex/stellar-scanner` (`soroban/`, `holders/`, `scorer/`):**
  - Query Stellar RPC `getLedgerEntries` for SEP-41 `name`/`symbol`/`decimals`/`total_supply`, `owner()`/`admin()`, **SEP-48 `contract.Spec`** dangerous method audit, **SEP-55** build verification, and **Stellar Registry (`rgstry.xyz`)** lookup.
  - Detect **AstroGate Fair-Flywheel v4.4** curves, verify **7-Year On-Chain LP Lock** vs. `GAAAA...WHF` burn vs. unlocked LP, and reconstruct Top-10 Holder / Whale concentration from SEP-41 events + pool reserves.
  - Inspect **Protocol 23 ("Whisk" CAP-0062/0066)** contract & pool `liveUntilLedgerSeq` TTLs and build 1-tap `ExtendFootprintTtlOp` payloads.
  - Compute deterministic **Astro Shield Score (`0–100`)** + dual **Basic Plain-English Summary** and **Pro Forensic Matrix**.

---

## Milestone 3: 5-Way Smart Liquidity Aggregator, SDEX Limit Orders, Oracles & Pre-Sign Shield
*Outcome: Optimal multi-venue routing with exact `bigint` stroops arithmetic, native Classic SDEX Limit Orders, multi-oracle pricing, and zero-WASM pre-sign simulation.*

- [ ] **`@astrodex/dex-aggregator`:**
  - **5-Way Parallel Router:** (1) AstroGate v4.4 Bonding Curve (`curve-math.ts` exact `bigint` parity), (2) Soroswap Aggregator (via Worker proxy), (3) XOXNO Swap Aggregator Router, (4) Direct On-Chain Soroswap Pair/Router (`token_0`, `token_1`, `get_reserves`, `router_get_amount_out`), and (5) Horizon `/paths/strict-send` + `/order_book` bid-walk fallback.
  - **Honest `G...` vs. `C...` Route Filtering & Auto-Trustline:** Automatically prepend `changeTrust` when missing on `G...` accounts (checking `0.5 XLM` CAP-33 reserve headroom); filter Classic SDEX routes when user active account is `C...` and offer 1-tap SAC bridge intent.
  - **Native SDEX Limit Orders:** `Operation.manageBuyOffer` / `manageSellOffer` builders (create, edit, cancel) + live open offers reader (`/offers?seller=G...`) + combined multi-venue **Depth Chart** calculator (`±2% / ±5% / ±10%`).
- [ ] **`@astrodex/oracles-and-charts`:**
  - Read on-chain **Reflector Network (SEP-40)** & **Chainlink Data Feeds on Stellar** (`latest_round`), plus **Rumble Fish Stellar Prices API** (24h VWAP) and multi-CEX XLM/USD waterfall.
  - Build OHLCV candle merger combining Horizon `/trade_aggregations` $\rightarrow$ `/trades` $\rightarrow$ `/order_book` with Cloudflare D1 Soroban candles.
- [ ] **`@astrodex/security-shield`:**
  - Pre-sign XDR decoder (zero-WASM primary + lazy `inspectRawXdrInWorker`), Stellar RPC `simulateTransaction` (`xdrFormat: "json"`, `balanceDiffs`, Protocol 23 restore detection), 3-tier anti-spoof ticker hard-blocking, and drainer AST rules.

---

## Milestone 4: Cloudflare Edge Server, `DEX_INDEXER` DO, MCP Server & `@AstroDexBot`
*Outcome: Production-grade Cloudflare Worker backend with real-time Soroban OHLCV indexing, SSRF-hardened proxies, AI MCP server, and English-only Telegram Super-Bot.*

- [ ] **Cloudflare D1 Migrations (`0001_init.sql`+):** `dex_tokens`, `dex_pairs`, `ohlcv_candles`, `whale_trades`, `user_watchlists`, `price_alerts`, `signed_intents`, `processed_tg_updates`, `rate_limits`.
- [ ] **`DEX_INDEXER` Durable Object + Alarm Loop:** Cursor-based ingestion of `SoroswapFactory` `new_pair`, `AstroGate Launchpad v4.4` events, Pair **SEP-41 `transfer`** events, and **Protocol 23 CAP-0067** unified events into D1 OHLCV candles and whale alerts.
- [ ] **Hono REST & Proxy API (`apps/server`):**
  - `/v1/tg/auth`, `/v1/wallet/resolve` (bridging AstroWallet/AstroGate public addresses), `/v1/markets/*`, `/v1/scanner/:assetId`, `/v1/orderbook/:pair`, `/v1/candles/:pair`, `/v1/quote`, `/v1/intents` + `/v1/intents/:id/confirm` (op-level verification + anti-replay `tx_hash`).
  - SSRF-hardened `/v1/proxy/stellar-toml`, KV-cached `/v1/proxy/directory`, rate-limited `/v1/proxy/soroswap/*`.
  - Expose `/mcp` (Model Context Protocol tools: `scan_stellar_asset`, `get_best_swap_route`, `get_sdex_orderbook_depth`, `get_astrogate_jackpot_radar`), `/openapi.json`, and `/llms.txt`.
- [ ] **`grammY` Bot `@AstroDexBot` (100% English):** `/start`, `/scan <asset>`, `/chart <asset>`, `/book <pair>`, `/route <amt> <from> <to>`, `/whales`, `/jackpot`, `/alerts`, and **Inline Mode (`@AstroDexBot <query>`)** sharing live security + trade cards with deep-links into the TMA.

---

## Milestone 5: Telegram Mini App — Apple Liquid Glass & Progressive Disclosure (`apps/tma`)
*Outcome: Fast, anti-jitter, 60fps mobile trading & forensics UI running exclusively inside Telegram.*

- [ ] **App Shell & Design System:**
  - Implement `TelegramOnlyGate`, `Telegram.WebApp` SDK lifecycle (`ready`, `expand`, `BackButton`, `HapticFeedback`, `ClosingConfirmation`, `--tg-safe-area-inset-*`, `--tg-viewport-stable-height`), and the 5-color **Apple Liquid Glass** CSS system (max 2–3 simultaneous blur layers, `tabular-nums`, reserved anti-jitter slot heights).
  - Global Header: **AstroWallet Identity Pill** (`@username` + `G...` / `C...` switcher + Network badge) + **`[ ⚡ Basic | 🔬 Pro Scanner ]`** global mode toggle.
  - Floating 5-Tab Bottom Dock: `Radar`, `Trade & Chart`, `Scanner`, `Book & Pools`, `Orders & Alerts`.
- [ ] **⚡ Basic Mode Views:** Clean Market Radar (Trending, New AstroGate Fair Launches, Safe Verified Assets), smoothed Area Price Chart, plain-English **Astro Shield Card (0–100)**, AstroGate graduation progress bar, and 1-Tap Best-Route Swap (`25% / 50% / MAX`) handing off Signed Intent to `@AstroWalletAppBot`.
- [ ] **🔬 Pro Scanner Mode Views:**
  - TradingView `lightweight-charts` (~45 KB) OHLCV candlestick + volume chart (`1m`–`1D`, `XLM`/`USD` toggle) and **Combined Multi-Venue Depth Chart**.
  - Live **Classic SDEX Orderbook** + **Native Limit Order Drawer** (`manageBuyOffer` / `manageSellOffer` + open orders manager) + Multi-Pool Breakdown (`Soroswap`, `Aquarius`, `Phoenix`, `CAP-38`, `AstroGate Curve`).
  - **Forensic X-Ray Matrix:** Classic Issuer Lock proof, compliance flags, SEP-1/42/55 badges, Top-10 Holders table, Live Whale Tape, Protocol 23 TTL countdown + 1-tap Extend Intent, and lazy Web Worker Raw XDR Inspector.
  - **AstroGate Launchpad Command Center:** Jackpot Ladder snipe calculator (`250 / 500 / 1,000 XLM`), Burn-to-Chat shouts, and permissionless `trigger_buyback_burn_min` button.

---

## Milestone 6: Real Testnet E2E Verification, Security Gates & Mainnet Readiness
*Outcome: Full automated verification against live Stellar Testnet + zero-hardcoding Mainnet dry-run.*

- [ ] Live Testnet integration tests (read-only + disposable Friendbot checks):
  - Inspect `$ASTRO` (`CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE`), `ASTRO/XLM` pair (`CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP`), AstroGate Launchpad v4.4 (`CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK`), Testnet USDC SAC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`), and Classic Horizon `/order_book` + `/liquidity_pools`.
  - Adversarial tests: spoofed `USDC` issuer hard-blocked, missing `master_weight=0` or hidden co-signer flagged, expired/cross-network Signed Intents rejected, SSRF redirect traps on `stellar.toml` blocked.
- [ ] Quality & Bundle Gates: `pnpm check` passes 100%, `@stellar/stellar-xdr-json` absent from initial `apps/tma/dist/assets/`, CSP parity verified, and Mainnet Zod dry-run passes with Friendbot hard-blocked.

---

## Explicitly Deferred to Post-MVP (Phase 2)
Preserve clean `Port` interfaces in `@astrodex/domain` for seamless drop-in additions without cluttering v1:
- **Paid Agentic Data Endpoints (`x402` / `MPP` over USDC SAC):** Monetize `/api/v1/pro-signals` for external AI trading agents via HTTP 402 facilitator or session channels.
- **On-Chain Soroban Limit Orders / Automated DCA via Smart Account (`C...`) Session Keys:** Policy-bounded recurring buys executed via OpenZeppelin `stellar-contracts` Context Rules & Channels.
- **Blockaid Enterprise Threat Feed (`@blockaid/client`):** Pluggable into `SecurityShieldPort` alongside free v1 rules.
- **Full LP Management Hub:** Add/remove liquidity across Aquarius concentrated pools, Soroswap pairs, and CAP-38 pools directly inside AstroDex.
