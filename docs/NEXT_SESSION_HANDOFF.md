# AstroDex — Deployment & Operations Handoff (Milestones 1–6 Complete)

> **Current Phase:** **Milestones 1–6 Complete & Verified (Testnet-Ready)** (`AstroWallet` = Exclusive `AstroID` SSO Login & Signing Hub; `AstroGate v4.5` = Launchpad, Sorobits SEP-50 & SHA-256 Logo CDN; `AstroDex` = 5-Way DEX, Orderbooks & Forensic Scanner).
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

## 2. Completed Architecture & Verified Gates

- **Monorepo & Packages:** `@astrodex/domain`, `@astrodex/tg-protocol`, `@astrodex/stellar-scanner`, `@astrodex/dex-aggregator`, `@astrodex/oracles-and-charts`, `@astrodex/security-shield` enforcing strict hexagonal DAG boundaries (`eslint.config.mjs`).
- **Edge Server (`apps/server`):** Cloudflare Worker (Hono + `grammY` + D1 `0001_init.sql` + KV + `DEX_INDEXER` Durable Object), `AstroID` SSO federation (`AstroWallet` primary + `AstroGate` fallback), SSRF-hardened proxies, `/mcp`, `/openapi.json`, `/llms.txt`, and 100% English `@AstroDexBot`.
- **Telegram Mini App (`apps/tma`):** Apple Liquid Glass UI (`Basic` $\leftrightarrow$ `Pro Scanner`), `AstroID` header + ecosystem switcher, 5-tab dock, lazy Web Worker XDR inspector (`@stellar/stellar-xdr-json` excluded from initial chunks), and strict CSP (`frame-ancestors https://web.telegram.org https://*.telegram.org`).
- **Cross-Ecosystem Harmony (`astrowallet` & `AstroGate`):** Synchronized `GET /v1/identity/resolve`, `POST /v1/intents/external` (`X-Ecosystem-Secret`), `IntentSheet` `sign_xdr` Clear-Sign + Boomerang return, and `AstroGate` `AstroWallet SSO` / `"Pro Terminal on AstroDex"` links.
- **Verification Results:**
  - `pnpm check` passes (`10` test files / `27` Vitest tests, `58` source files clean on `secret-scan`, `@astrodex/tma` build clean).
  - `node scripts/verify-testnet.mjs` verified live Testnet Soroban contracts (`$ASTRO`, `ASTRO/XLM` pair, `AstroGate Launchpad v4.5`, `Testnet USDC SAC`, `Sorobits SEP-50`) and Horizon `/order_book` + `/liquidity_pools`.

---

## 3. Cloudflare Deployment & Mainnet Pre-Flight Checklist

1. **Verify Locally & Against Live Testnet:**
   ```bash
   pnpm check
   node scripts/verify-testnet.mjs
   ```
2. **Provision Cloudflare Testnet Resources (`apps/server/wrangler.toml`):**
   - Create D1 database (`astrodex`) and KV namespace (`CACHE`), replace `REPLACE_WITH_TESTNET_D1_ID` / `REPLACE_WITH_TESTNET_KV_ID`, and apply `apps/server/migrations/0001_init.sql`.
   - Set secrets via `wrangler secret put`: `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `INTENT_HMAC_SECRET`, `ECOSYSTEM_SHARED_INTENT_SECRET` (matching `astrowallet`), and optional `SOROSWAP_API_KEY` / `STELLAR_PRICES_API_KEY` / `INDEXER_WEBHOOK_SECRET`.
3. **Deploy Server & Mini App (`apps/server` + `apps/tma`):**
   - Deploy `apps/server` Worker (`workers_dev = false`), build `apps/tma` with production `VITE_*` vars, and deploy `apps/tma/dist` to Cloudflare Pages so `apps/tma/functions/[[path]].ts` binds `/v1/*`, `/tg/*`, `/mcp` via Service Binding.
4. **Mainnet Cutover Gate:**
   - Provision `[env.mainnet]` D1/KV IDs and secrets, keep `FRIENDBOT_URL` / `VITE_FRIENDBOT_URL` unset and `VITE_ALLOW_DEV_OUTSIDE_TELEGRAM=false`, and re-run `pnpm check` + external security audit before onboarding Mainnet users.
