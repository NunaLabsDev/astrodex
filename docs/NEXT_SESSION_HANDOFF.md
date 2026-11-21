# AstroDex — Next Session Handoff & Milestone 1 Bootstrap

> **Current Phase:** **Planning & Architecture Complete** (`PLAN MODE` documentation suite finalized). Ready to execute **Milestone 1** immediately in the next session.
> **Language Policy:** 100% English across all code, docs, UI, and `@AstroDexBot`.
> **Ecosystem Rule:** Integrate strictly with **AstroWallet** (`/home/dev/projects/astrowallet`) and **AstroGate v4.4** (`/home/dev/projects/astrogate`).

---

## 1. Verified Testnet Ecosystem Reference IDs (For `.env.example` / `.dev.vars.example` Only — Never Hardcode in Source)

| Component | Verified Stellar Testnet Identifier (`Test SDF Network ; September 2015`) |
| :--- | :--- |
| **Stellar RPC** | `https://soroban-testnet.stellar.org` |
| **Horizon API** | `https://horizon-testnet.stellar.org` |
| **Native XLM SAC** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Circle Testnet USDC Issuer & SAC** | Issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` / SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| **SEP-42 Testnet Asset List** | `https://api.stellar.expert/explorer/testnet/asset-list/top50` |
| **AstroWallet Bot & Mini App** | `@AstroWalletAppBot` (`t.me/AstroWalletAppBot/wallet`, `https://astrowallet-b1o.pages.dev`) |
| **AstroGate Bot & Launchpad v4.4** | `@AstroGateSorobanBot` (`https://astrogate.pages.dev`), Launchpad `CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK` |
| **AstroGate Flagship Token (`$ASTRO`) & Pair** | Token `CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE` / Pair `CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP` |
| **Sorobits SEP-50 Contract** | `CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3` |
| **Soroswap Factory & Router (Testnet)** | Factory `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` / Router `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` |
| **Chainlink Price Proxy (Testnet / Mainnet)** | Testnet `CBUF6IADAWPWIDWRTHJNINKXHG2UTIQ6TU2F2HRAXWAI7OT3KJPKK6O4` / Mainnet `CDQBHEUGLDHMSUHG4IH33RJBUTMNCZOT4JIAQR4WZFRDZW6DR6S32ZLZ` |
| **Reflector Network DEX Oracle (Mainnet)** | `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` |

---

## 2. Reference Modules to Port / Align From Sibling Repos

Before writing each Milestone package, inspect these proven implementations in the workspace:
- **From `astrowallet` (`3f958f3`):**
  - `packages/domain/src/config.ts` — Zod env parser pattern & Mainnet Friendbot hard-block.
  - `packages/tg-protocol/src/mini-app.ts` & `intent-token.ts` — Telegram `initData` HMAC & Signed Intent cryptography.
  - `packages/stellar-core/src/ledger/token-explorer.ts` — `parseStellarTomlForAsset`, `discoverLiquidHorizonAssets`, `fetchTokenPriceHistoryAgainstXlm`, `fetchTokenOrderbookAgainstXlm`.
  - `packages/security-shield/src/` — Zero-WASM decoder, `simulateTransaction` wrapper, `sep42.ts`, `rules.ts`, `raw-xdr.worker.ts`.
  - `packages/defi/src/index.ts` — `createHorizonPathSwapAdapter`, `createSoroswapProxyAdapter`, stroops `bigint` helpers.
  - `apps/server/src/routes/proxy.ts` — SSRF-hardened manual-redirect `stellar.toml` proxy.
  - `apps/pwa/src/styles/glass.css` & `components/token-catalog.ts` — Apple Liquid Glass anti-jitter styles & `classifyTokenTrust`.
- **From `astrogate` (`6cbef2c`):**
  - `frontend/src/lib/curve-math.ts` — Pure integer `bigint` bonding curve quote & fee parity with `contracts/launchpad/src/contract.rs`.
  - `frontend/src/lib/holders.ts` — `analyzeTokenHolders` SEP-41 event + pool concentration reconstruction.
  - `frontend/src/lib/soroswap.ts` — `Pair.token_0()`, `Pair.token_1()`, `Pair.get_reserves()`, `router_get_amount_out` (never `router_get_amounts_out`).
  - `frontend/worker/protocol.ts` & `mcp.ts` — `auditTokenApi` and `/mcp` JSON-RPC endpoint patterns.

---

## 3. Exact First Commands for Next Session (Start Milestone 1)

1. Read [`AGENTS.md`](../AGENTS.md), [`docs/ENV_MATRIX.md`](ENV_MATRIX.md), and [`PLAN.md`](../PLAN.md) Milestone 1.
2. Scaffold root workspace files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `scripts/secret-scan.mjs`).
3. Implement and test **`packages/domain`** and **`packages/tg-protocol`** first, ensuring:
   ```bash
   pnpm install
   pnpm --filter "./packages/*" build
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm secret-scan
   ```
   pass cleanly before starting Milestone 2 (`@astrodex/stellar-scanner`).
