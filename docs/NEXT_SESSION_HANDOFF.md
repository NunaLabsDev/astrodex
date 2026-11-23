# AstroDex — Deployment & Operations Handoff (Live Testnet Deployed & Audited)

> **Current Phase:** **Live on Cloudflare Testnet & Telegram** (`AstroWallet` = Exclusive `AstroID` SSO Login & Signing Hub; `AstroGate v4.5` = Launchpad, Sorobits SEP-50 & SHA-256 Logo CDN; `AstroDex` = 5-Way DEX, Orderbooks, Forensic Scanner & Instant Community Listing).
> **Language Policy:** 100% English across all code, docs, UI, and `@AstroDexBot`.
> **Ecosystem Rule:** Integrated across **AstroWallet** (`/Users/munay/dev/ASTRO/astrowallet`) and **AstroGate v4.5** (`/Users/munay/dev/ASTRO/AstroGate`).

---

## 1. Verified Testnet Ecosystem Reference IDs (For `.env.example` / `.dev.vars.example` Only — Never Hardcode in Source)

| Component | Verified Stellar Testnet Identifier (`Test SDF Network ; September 2015`) |
| :--- | :--- |
| **Stellar RPC** | `https://soroban-testnet.stellar.org` (fallback `https://rpc-testnet.stellar.org`) |
| **Horizon API** | `https://horizon-testnet.stellar.org` |
| **Native XLM SAC** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (Mainnet: `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`) |
| **Circle Testnet USDC Issuer & SAC** | Issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` / SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| **SEP-42 Testnet Asset List** | `https://api.stellar.expert/explorer/testnet/asset-list/top50` |
| **AstroWallet (`AstroID` SSO & Signer)** | `@AstroWalletAppBot` (`t.me/AstroWalletAppBot/wallet`, `https://astrowallet-soroban.pages.dev`) |
| **AstroWallet Claim Escrow V2.2** | `CDEOJ4KCHMCSJY2N6VCHD3UYVFIIJ3ZVG7DRZ6XMLSTTU4US6ITH36BQ` (`VITE_SMART_ACCOUNT_WASM_HASH` intentionally unset until audited OZ WASM) |
| **AstroGate Bot & Launchpad v4.5** | `@AstroGateSorobanBot` (`https://astrogate.pages.dev`), Launchpad `CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK` (WASM `9db8d446725715069d85c51c4fb1b897bb93d036507a6b95fe085c64f4aaa4e9`) |
| **AstroGate Flagship Token (`$ASTRO`) & Pair** | Token `CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE` / Pair `CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP` |
| **Sorobits SEP-50 Contract (v4.5)** | `CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3` (WASM `bc5c0d36b9add840685f734709a32945a88e0353d49b57b938d54ae68a7d5adf`) |
| **Soroswap Factory & Router (Testnet)** | Factory `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` / Router `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` |
| **Chainlink Price Proxy (Testnet / Mainnet)** | Testnet `CBUF6IADAWPWIDWRTHJNINKXHG2UTIQ6TU2F2HRAXWAI7OT3KJPKK6O4` / Mainnet `CDQBHEUGLDHMSUHG4IH33RJBUTMNCZOT4JIAQR4WZFRDZW6DR6S32ZLZ` |
| **Reflector Network DEX Oracle (Mainnet)** | `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` *(optional / graceful fallback on Testnet)* |

---

## 2. Completed Architecture, Production UX & Security Audit

- **Monorepo & Packages:** `@astrodex/domain`, `@astrodex/tg-protocol`, `@astrodex/stellar-scanner`, `@astrodex/dex-aggregator`, `@astrodex/oracles-and-charts`, `@astrodex/security-shield` enforcing strict hexagonal DAG boundaries (`eslint.config.mjs`).
- **Edge Server (`apps/server`):** Cloudflare Worker (Hono + `grammY` + D1 `0001_init.sql` & `0002_community_listings.sql` + KV + `DEX_INDEXER` Durable Object), `AstroID` SSO federation (`AstroWallet` primary + `AstroGate` fallback), SSRF-hardened proxies, `/mcp`, `/openapi.json`, `/llms.txt`, and 100% English `@AstroDexBot` (including `/list <asset> [venue]`).
- **Minimalist Production UX & Instant Community Listing (`apps/tma` + `/v1/markets/*`):**
  - Auto-hydrated token & pair catalog (`GET /v1/markets/overview`) merging `XLM`, `SEP42_ASSET_LIST_URLS`, `AstroGate v4.5`, and D1 `dex_tokens` (`49` assets live on Testnet, live `XLM/USD` spot price) + live autocomplete search (`GET /v1/markets/search?q=...` across local catalog, AstroGate, StellarExpert, and Horizon) via `TokenSearchInput` across `RadarView`, `TradeChartView`, `BookPoolsView`, `ScannerView`, and `OrdersAlertsView`.
  - Ticker/name resolution across `/v1/scanner/:assetId`, `/v1/markets/listings`, `/v1/quote`, `/v1/intents`, `/v1/orderbook/:pair`, `/v1/candles/:pair`, `@AstroDexBot`, and `/mcp` (`search_stellar_assets` + `scan_stellar_asset` + `get_best_swap_route` + `get_sdex_orderbook_depth`).
  - Live 5-Way quoting (`createSmartLiquidityRouter` wired with `fetchSoroswapDirectPairReserves` and AstroGate v4.5 `curveStateLoader`), proportional AMM synthetic orderbook depth & live reserves in `BookPoolsView`, 24-point chart spot fallback, `AstroIdHeader` 1-tap AstroWallet SSO + `@AstroID`/`G...`/`C...` preview lookup, and `DexIndexerDO` `getHealth().oldestLedger` clamping + SEP-41 `transfer` whale indexing.
  - Self-serve instant listing (`POST /v1/markets/listings` + `+ List` drawer + `/list` bot command): hard-blocks spoofed/malicious tokens (`403`), auto-verifies clean tokens (`score >= 75`, `safe`), and immediately publishes flagged/unreviewed tokens with an explicit `unreviewed_warning` badge + optional Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`) anomaly summary, while protecting existing `communityUrl`/`ammVenue` from overwrite.
  - End-to-end `dex_swap` XDR builder (`buildClassicSwapXdr` + `buildSoroswapRouterSwapXdr` + `buildAstroGateCurveBuyXdr`/`SellXdr`) with live Horizon `sequence` + auto-`changeTrust` detection, 1-tap SDEX offer cancellation (`sdex_limit_order_cancel`) & price alerts CRUD in `OrdersAlertsView`, and 1-tap Protocol 23 `soroban_extend_ttl` in `ScannerView`.
- **Security Audit Hardening:**
  - Sanitized `sorobitSvg` rendered via isolated `<img src="data:image/svg+xml;utf8,..." />` (zero `dangerouslySetInnerHTML`).
  - `SOURCE_ACCOUNT_MISMATCH` blocking and live StellarExpert Directory lookup inside `scanTransactionXdr` / `POST /v1/intents`.
  - Soroban RPC `envelopeXdr` source-account verification in `verifyTransactionConfirmed`, plus D1 rate limiting on `POST /v1/quote` and `POST /v1/markets/listings`.
- **Cross-Ecosystem Harmony (`astrowallet` & `AstroGate`):** Synchronized `GET /v1/identity/resolve`, `POST /v1/intents/external` (`X-Ecosystem-Secret`), `POST /v1/intents/:intentId/confirm` Boomerang callback acceptance via constant-time `X-Ecosystem-Secret`, automatic `feedNetwork` sync on `token_`/`scan_`/`pair_` deep-links (`testnet`), and strict cross-network guard `executionDisabled = !config.executionEnabled || feedNetwork !== config.network`.
- **Verification Results:**
  - `pnpm check` passes (**10 test files / 31 Vitest tests**, **60 source files clean on `secret-scan`**, `@astrodex/tma` build clean).
  - `gitleaks detect --no-git --no-banner` clean (`0` leaks across `2.23 MB`).
  - `node scripts/verify-testnet.mjs` verified live Testnet Soroban contracts (`$ASTRO`, `ASTRO/XLM` pair, `AstroGate Launchpad v4.5`, `Testnet USDC SAC`, `Sorobits SEP-50`) and Horizon `/order_book` + `/liquidity_pools`.

---

## 3. Live Testnet Deployment & Next-Session Roadmap

1. **Live Testnet Resources Deployed (`0c4db01`):**
   - **D1 (`astrodex`, `4f7684e0-86dd-4696-b725-d7b109f4dd67`):** `0001_init.sql` & `0002_community_listings.sql` applied remotely (`$ASTRO`, `DOGEE`, `HEY` seeded).
   - **Worker (`astrodex-server`):** Deployed (`Version ID: 514c8c12-7d56-44a5-9abd-38966b0ec371`) with `ASTROWALLET`, `ASTROGATE`, `DB`, `CACHE`, and `DEX_INDEXER` bindings.
   - **Pages + Functions (`astrodex-testnet`):** Live at `https://astrodex-testnet.pages.dev` (latest deploy `https://3eb32fc0.astrodex-testnet.pages.dev`; `GET /health` -> `200 ok`).
2. **Universal `@astrowallet/connect` v0.2.0 & Gate 2 Shadow Default (`0c4db01`):**
   - Migrated `@astrodex/tg-protocol` (`intent-token.ts`, `ecosystem.ts`) to consume `@astrowallet/connect` v0.2.0 (`vendor/astrowallet-connect-0.2.0.tgz`) and set `EXECUTION_ENABLED = "false"` by default under `[env.mainnet.vars]` in `apps/server/wrangler.toml`.
3. **Mainnet Cutover Gate (When Approved):**
   - Provision `[env.mainnet]` D1/KV IDs and secrets, deploy in 48h Read-Only Shadow Mode (`EXECUTION_ENABLED=false`) before flipping `EXECUTION_ENABLED=true`, keep `FRIENDBOT_URL` / `VITE_FRIENDBOT_URL` unset and `VITE_ALLOW_DEV_OUTSIDE_TELEGRAM=false`, and re-run `pnpm check`.

---

## 4. Mainnet Live Status & Session Handoff (2026-11-23)

- **Mainnet-Default Token-First CoinGecko × Aquarius UX:**
  - `apps/tma` now defaults unconditionally to **Mainnet** (`feedNetwork = "mainnet"`), with 3 bottom tabs (`Markets`, `Token & Swap`, `Orders & Alerts`).
  - `Markets` (`RadarView.tsx`) is strictly **token-first** with a **`$ USD` | `✦ XLM`** price/evolution toggle, 24h % change, 7d SVG sparklines, and `All / Gainers / Losers / Vol` tabs.
  - All pairs, Aquarius AMM pools (`GET /v1/pools/top` + `amm-api.aqua.network`), Soroswap pools, Horizon SDEX pools, orderbooks, top holders (`fetchTokenTopHolders`), and Astro Shield X-Ray live **inside each token's Hub** (`TradeChartView.tsx`).
- **Cross-App Signing Bridge Fixed:**
  - `ECOSYSTEM_SHARED_INTENT_SECRET` synced across `astrodex-server`, `astrowallet-server-mainnet`, and `astrowallet-server` (stored locally at `~/.secrets/astrowallet/ecosystem-intent.env`, mode `600`).
  - `createEcosystemFetch` routes `env.ASTROWALLET` by `X-Astro-Network`.
- **Live Mainnet Transaction Tests (`externawallet` `GCOKDLYTDOFSLBXOA4PGNSEG6RAYZN2THJJHZ5PFB2RT4GIZWR2N4RGD`):**
  - **Test 1 (`0.5 XLM -> AQUA` + auto-trustline):** **CONFIRMED ON-CHAIN ON MAINNET** (`306.4852274 AQUA` received, `64.2874826 XLM` remaining).
  - **Test 2 (`150 AQUA -> XLM`):** Sent to Telegram DM (`1572614676`) via `@AstroDexBot`.
  - **Next Mainnet Tests:** Verify Test 2 confirmation on Horizon Mainnet, then run Test 3 (Classic SDEX Limit Order + Cancel Order) and Soroswap Smart Route swap.
