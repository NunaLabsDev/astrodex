# AstroDex — Master Vertical-Slice Roadmap

> **Goal:** Deliver a modular, audited, phone-first Stellar Classic (`SDEX`) + Soroban DEX, 5-Way Liquidity Aggregator, and Forensic Token Scanner operating **100% inside Telegram** (`@AstroDexBot`), seamlessly unified under **AstroWallet** (`@AstroWalletAppBot` — exclusive `AstroID` SSO login, custody & signing hub) and **AstroGate v4.5** (`@AstroGateSorobanBot` — launchpad, Sorobits & logo CDN) with zero hardcoding and full Testnet-to-Mainnet parity.

---

## Milestone 1: Hexagonal Monorepo, Zod Config Matrix & Cross-App `AstroID` Protocol
*Outcome: Clean TypeScript monorepo enforcing strict DAG boundaries, 100% env-driven Zod config, and bit-exact `@astrowallet/tg-protocol` Signed Intent + `AstroID` SSO primitives.*

- [x] Initialize `pnpm` + Turborepo workspace (`pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `eslint.config.mjs` `no-restricted-imports`, `scripts/secret-scan.mjs`, `vitest.config.ts`).
- [x] **`@astrodex/domain`:**
  - Define pure domain types and ports (`ScannerPort`, `LiquidityRouterPort`, `LimitOrderPort`, `OraclePort`, `IntentPort`, `IdentityResolverPort`, `AgenticPaymentPort`).
  - Implement fail-fast Zod environment schemas (`parseTmaConfig`, `parseServerConfig`) enforcing **Mainnet hard-blocks** (`FRIENDBOT_URL`, plaintext `http://`, and `VITE_ALLOW_DEV_OUTSIDE_TELEGRAM=true` rejected when `STELLAR_NETWORK=mainnet`), while keeping optional Mainnet-heavy adapters (`XOXNO`, `Reflector`, `Rumble Fish`) cleanly nullable on Testnet.
  - Implement unified asset identifier normalization (`XLM`, `CODE:G...`, `C...`, deterministic SAC `C...` derivation).
- [x] **`@astrodex/tg-protocol`:**
  - Implement `verifyTelegramInitData` (HMAC-SHA256 `WebAppData` + `auth_date <= 300s`), 15m Mini App session tokens, `startapp` parameter parsing (`token_<id>`, `scan_<id>`, `pair_<id>`, `i-<intentId>-<sig>`).
  - Implement **bit-exact 4-field HMAC-SHA256 Signed Intent** (`${network}:${intentId}:${telegramUserId}:${expiresAt}`, `<= 5 min` TTL) and `CrossAppIntentEnvelope v1` builders (`actionType: "swap" | "sign_xdr"`, `xdrSha256`, `originApp: "astrodex"`, `returnStartAppParam`) targeting `@AstroWalletAppBot`, plus `AstroID` public-address resolution client (`AstroWallet` primary + `AstroGate` fallback) and English-only Telegram card formatters.

---

## Milestone 2: "SDEX Reboot + Soroban X-Ray" Forensic Scanner Engine
*Outcome: Deterministic, real-Testnet token forensics covering Classic assets, Soroban SEP-41 contracts, AstroGate v4.5 invariants, Protocol 23 TTLs, and Top-10 Holder distribution.*

- [x] **`@astrodex/stellar-scanner` (`classic/`):**
  - Query Horizon `/assets` and `/accounts/{issuer}` with multi-endpoint failover.
  - Implement mathematical **Issuer Lock** audit (`master_weight === 0` AND combined secondary `signers` weight `< low_threshold`).
  - Decode `AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED`, `AUTH_IMMUTABLE` flags.
  - Port and extend SSRF-safe SEP-0001 `stellar.toml` parser, SDF SEP-42 asset validation, and StellarExpert Directory tags (`#malicious`, `#unsafe`, `#exchange`).
- [x] **`@astrodex/stellar-scanner` (`soroban/`, `holders/`, `scorer/`):**
  - Query Stellar RPC `getLedgerEntries` for SEP-41 `name`/`symbol`/`decimals`/`total_supply`, `owner()`/`admin()`, **SEP-48 `contract.Spec`** dangerous method audit, **SEP-55** build verification, and **Stellar Registry (`rgstry.xyz`)** lookup.
  - Detect **AstroGate Fair-Flywheel v4.5** curves (backwards-compatible with v4.4), verify **48h Upgrade Timelock** (`propose_upgrade`/`execute_upgrade`/`cancel_upgrade`), **7-Year On-Chain LP Lock** vs. `GAAAA...WHF` burn vs. unlocked LP, **30d `CurveClosed` refund eligibility**, resolve **AstroGate SHA-256 Logos** (`/api/v1/logos/*`), tag **Sorobits SEP-50 (`TokenBaseXp`)**, and reconstruct Top-10 Holder / Whale concentration from SEP-41 events + pool reserves.
  - Inspect **Protocol 23 ("Whisk" CAP-0062/0066)** contract & pool `liveUntilLedgerSeq` TTLs and build 1-tap `ExtendFootprintTtlOp` payloads.
  - Compute deterministic **Astro Shield Score (`0–100`)** + dual **Basic Plain-English Summary** and **Pro Forensic Matrix**.

---

## Milestone 3: 5-Way Smart Liquidity Aggregator, SDEX Limit Orders, Oracles & Pre-Sign Shield
*Outcome: Optimal multi-venue routing with exact `bigint` stroops arithmetic, native Classic SDEX Limit Orders, multi-oracle pricing, and zero-WASM pre-sign simulation.*

- [x] **`@astrodex/dex-aggregator`:**
  - **5-Way Parallel Router:** (1) AstroGate v4.5 Bonding Curve (`curve-math.ts` exact `bigint` parity), (2) Soroswap Aggregator (via Worker proxy), (3) Optional XOXNO Swap Aggregator Router (graceful skip if unconfigured), (4) Direct On-Chain Soroswap Pair/Router (`token_0`, `token_1`, `get_reserves`, `router_get_amount_out`), and (5) Horizon `/paths/strict-send` + `/order_book` bid-walk fallback.
  - **Honest `G...` vs. `C...` Route Filtering & Auto-Trustline:** Default to `G...` when no `C...` is deployed; automatically prepend `changeTrust` when missing on `G...` accounts (checking `0.5 XLM` CAP-33 reserve headroom and offering `LumenWipe` reserve reclaim or fee-bump relay); filter Classic SDEX routes when user active account is `C...` and offer 1-tap SAC bridge intent.
  - **Native SDEX Limit Orders:** `Operation.manageBuyOffer` / `manageSellOffer` builders (create, edit, cancel) + live open offers reader (`/offers?seller=G...`) + combined multi-venue **Depth Chart** calculator (`±2% / ±5% / ±10%`).
- [x] **`@astrodex/oracles-and-charts`:**
  - Read on-chain **Chainlink Data Feeds on Stellar** (`latest_round`, Testnet + Mainnet) and optional **Reflector Network (SEP-40)** + **Rumble Fish Stellar Prices API** (24h VWAP) with Horizon/Soroswap spot + multi-CEX XLM/USD fallback.
  - Build OHLCV candle merger combining Horizon `/trade_aggregations` $\rightarrow$ `/trades` $\rightarrow$ `/order_book` with Cloudflare D1 Soroban candles.
- [x] **`@astrodex/security-shield`:**
  - Pre-sign XDR decoder (zero-WASM primary + lazy `inspectRawXdrInWorker`), Stellar RPC `simulateTransaction` (`xdrFormat: "json"`, `balanceDiffs`, Protocol 23 restore detection), 3-tier anti-spoof ticker hard-blocking, and drainer AST rules.

---

## Milestone 4: Cloudflare Edge Server, `DEX_INDEXER` DO, MCP Server & `@AstroDexBot`
*Outcome: Production-grade Cloudflare Worker backend with real-time Soroban OHLCV indexing, `AstroID` SSO federation, SSRF-hardened proxies, AI MCP server, and English-only Telegram Super-Bot.*

- [x] **Cloudflare D1 Migrations (`0001_init.sql`+):** `dex_tokens`, `dex_pairs`, `ohlcv_candles`, `whale_trades`, `user_watchlists`, `price_alerts`, `signed_intents`, `processed_tg_updates`, `rate_limits` (no local `linked_addresses` custody/auth table—identity lives in AstroWallet).
- [x] **`DEX_INDEXER` Durable Object + Alarm Loop:** Cursor-based ingestion of `SoroswapFactory` `new_pair`, `AstroGate Launchpad v4.5` events (`Launch`, `Buy`, `Sell`, `Graduated`, `JackpotClaimed`, `CurveClosed`, `BuybackBurn`, `BurnShout`), Pair **SEP-41 `transfer`** events, and **Protocol 23 CAP-0067** unified events into D1 OHLCV candles and whale alerts.
- [x] **Hono REST & Proxy API (`apps/server`):**
  - `/v1/tg/auth`, `/v1/wallet/resolve` (`AstroID` cascade from AstroWallet primary + AstroGate fallback), `/v1/markets/*`, `/v1/scanner/:assetId`, `/v1/orderbook/:pair`, `/v1/candles/:pair`, `/v1/quote`, `/v1/intents` (persisting & federating `CrossAppIntentEnvelope v1` to AstroWallet) + `/v1/intents/:id/confirm` (op-level verification + anti-replay `tx_hash`).
  - SSRF-hardened `/v1/proxy/stellar-toml`, KV-cached `/v1/proxy/directory`, rate-limited `/v1/proxy/soroswap/*`.
  - Expose `/mcp` (Model Context Protocol tools: `scan_stellar_asset`, `get_best_swap_route`, `get_sdex_orderbook_depth`, `get_astrogate_jackpot_radar`), `/openapi.json`, and `/llms.txt`.
- [x] **`grammY` Bot `@AstroDexBot` (100% English):** `/start`, `/scan <asset>`, `/chart <asset>`, `/book <pair>`, `/route <amt> <from> <to>`, `/whales`, `/jackpot`, `/alerts`, and **Inline Mode (`@AstroDexBot <query>`)** sharing live security + trade cards with deep-links into the TMA.

---

## Milestone 5: Telegram Mini App — Apple Liquid Glass & Progressive Disclosure (`apps/tma`)
*Outcome: Fast, anti-jitter, 60fps mobile trading & forensics UI running exclusively inside Telegram.*

- [x] **App Shell & Design System:**
  - Implement `TelegramOnlyGate`, `Telegram.WebApp` SDK lifecycle (`ready`, `expand`, `BackButton`, `HapticFeedback`, `ClosingConfirmation`, `--tg-safe-area-inset-*`, `--tg-viewport-stable-height`), and the 5-color **Apple Liquid Glass** CSS system (max 2–3 simultaneous blur layers, `tabular-nums`, reserved anti-jitter slot heights).
  - Global Header: **Unified `AstroID` Identity Pill** (Sorobit SEP-50 `32×32` on-chain SVG avatar + `@username` + `G...`/`C...` switcher + Network badge + quick ecosystem switcher **`Wallet ↔ Launchpad ↔ DEX`**) + **`[ ⚡ Basic | 🔬 Pro Scanner ]`** global mode toggle.
  - Floating 5-Tab Bottom Dock: `Radar`, `Trade & Chart`, `Scanner`, `Book & Pools`, `Orders & Alerts`.
- [x] **⚡ Basic Mode Views:** Clean Market Radar (Trending, New AstroGate v4.5 Fair Launches with SHA-256 logos, Safe Verified Assets), smoothed Area Price Chart, plain-English **Astro Shield Card (0–100)**, AstroGate graduation progress bar, and 1-Tap Best-Route Swap (`25% / 50% / MAX`) handing off Signed Intent to `@AstroWalletAppBot`.
- [x] **🔬 Pro Scanner Mode Views:**
  - TradingView `lightweight-charts` (~45 KB) OHLCV candlestick + volume chart (`1m`–`1D`, `XLM`/`USD` toggle) and **Combined Multi-Venue Depth Chart**.
  - Live **Classic SDEX Orderbook** + **Native Limit Order Drawer** (`manageBuyOffer` / `manageSellOffer` + open orders manager) + Multi-Pool Breakdown (`Soroswap`, `Aquarius`, `Phoenix`, `CAP-38`, `AstroGate Curve`).
  - **Forensic X-Ray Matrix:** Classic Issuer Lock proof, compliance flags, SEP-1/42/55 badges, 48h timelock status, Top-10 Holders table, Live Whale Tape, Protocol 23 TTL countdown + 1-tap Extend Intent, and lazy Web Worker Raw XDR Inspector.
  - **AstroGate v4.5 Launchpad Command Center:** Jackpot Ladder snipe calculator (`250 / 500 / 1,000 XLM`), `claim_jackpot` button, 30d `CurveClosed` refund action, Burn-to-Chat shouts, and permissionless `trigger_buyback_burn_with_bounty` button (highlighting the **2% keeper bounty**).

---

## Milestone 6: Real Testnet E2E Verification, Security Gates & Mainnet Readiness
*Outcome: Full automated verification against live Stellar Testnet + zero-hardcoding Mainnet dry-run.*

- [x] Live Testnet integration tests (read-only + disposable Friendbot checks):
  - Inspect `$ASTRO` (`CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE`), `ASTRO/XLM` pair (`CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP`), AstroGate Launchpad v4.5 (`CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK`), Testnet USDC SAC (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`), and Classic Horizon `/order_book` + `/liquidity_pools`.
  - Adversarial tests: spoofed `USDC` issuer hard-blocked, missing `master_weight=0` or hidden co-signer flagged, expired/cross-network Signed Intents rejected, 4-field HMAC compatibility verified against `@astrowallet/tg-protocol`, SSRF redirect traps on `stellar.toml` blocked.
- [x] Quality & Bundle Gates: `pnpm check` passes 100%, `@stellar/stellar-xdr-json` absent from initial `apps/tma/dist/assets/`, CSP parity verified, and Mainnet Zod dry-run passes with Friendbot hard-blocked.

---

## Explicitly Deferred to Post-MVP (Phase 2)
Preserve clean `Port` interfaces in `@astrodex/domain` for seamless drop-in additions without cluttering v1:
- **Paid Agentic Data Endpoints (`x402` / `MPP` over USDC SAC):** Monetize `/api/v1/pro-signals` for external AI trading agents via HTTP 402 facilitator or session channels.
- **On-Chain Soroban Limit Orders / Automated DCA via Smart Account (`C...`) Session Keys:** Policy-bounded recurring buys executed via OpenZeppelin `stellar-contracts` Context Rules & Channels.
- **Blockaid Enterprise Threat Feed (`@blockaid/client`):** Pluggable into `SecurityShieldPort` alongside free v1 rules.
- **Full LP Management Hub:** Add/remove liquidity across Aquarius concentrated pools, Soroswap pairs, and CAP-38 pools directly inside AstroDex.
