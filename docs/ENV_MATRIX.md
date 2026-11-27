# AstroDex — Environment & Network Configuration Matrix

> Authoritative specification for Zod schemas in `packages/domain/src/config.ts` (`parseTmaConfig`, `parseServerConfig`). Zero silent fallback URLs in production mode. Switching between `testnet` and `mainnet` happens **exclusively** via environment configuration.

---

## A. Client Public Config (`apps/tma` — `VITE_*` prefix only; zero secrets)

| Variable | Testnet Example Value | Mainnet Example Value | Notes |
| :--- | :--- | :--- | :--- |
| `VITE_STELLAR_NETWORK` | `testnet` | `mainnet` | Controls badge & network passphrase coherence |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` | Passed directly to `@stellar/stellar-sdk` |
| `VITE_STELLAR_RPC_URLS` | Comma-separated RPC endpoints | Comma-separated RPC endpoints | Primary + failover array (HTTPS required on mainnet) |
| `VITE_HORIZON_URLS` | Comma-separated Horizon endpoints | Comma-separated Horizon endpoints | Failover array for SDEX Orderbooks, Paths, Assets |
| `VITE_API_BASE_URL` | `https://astrodex-testnet.pages.dev` | `https://astrodex.pages.dev` | Points to `apps/server` Worker via Pages Service Binding |
| `VITE_TMA_ORIGIN` | `https://astrodex-testnet.pages.dev` | `https://astrodex.pages.dev` | Origin anchor for CSP & Telegram Mini App routing |
| `VITE_TG_BOT_USERNAME` | `AstroDexTestBot` | `AstroDexBot` | Deep-link builder only |
| `VITE_TG_MINI_APP_SHORT_NAME` | `dex` | `dex` | BotFather Mini App short name (`t.me/<bot>/<short_name>`) |
| `VITE_ASTROWALLET_BOT_USERNAME` | `AstroWalletAppBot` | `AstroWalletBot` | Exclusive signing hub deep link (`t.me/<bot>/<short_name>?startapp=i-...`) |
| `VITE_ASTROWALLET_MINI_APP_SHORT_NAME` | `wallet` | `wallet` | AstroWallet Mini App short name |
| `VITE_ASTROWALLET_API_BASE_URL` | `https://astro-wallet.pages.dev` | `https://app.astrowallet.example` | Primary `AstroID` SSO public identity resolution & intent federation origin |
| `VITE_ASTROWALLET_CLAIM_ESCROW_CONTRACT_ID` | `CDEOJ4KCHMCSJY2N6VCHD3UYVFIIJ3ZVG7DRZ6XMLSTTU4US6ITH36BQ` *(optional display tag)* | Mainnet Claim Escrow `C...` | Used by scanner to tag escrow holdings cleanly |
| `VITE_ASTROWALLET_SOROBITS_CONTRACT_ID` | `CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3` | Mainnet Sorobits `C...` | Sorobits SEP-50 avatar & `TokenBaseXp` verification badge |
| `VITE_ASTROGATE_BOT_USERNAME` | `AstroGateSorobanBot` | `AstroGateBot` | Deep links back to AstroGate Launchpad |
| `VITE_ASTROGATE_API_BASE_URL` | `https://astrogate.pages.dev` | `https://astrogate.example` | Public launchpad metadata, SHA-256 Logo CDN (`/api/v1/logos/*`), & transitional `wallet/resolve` fallback |
| `VITE_ASTROGATE_LAUNCHPAD_CONTRACT_ID` | `CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK` | Mainnet AstroGate Launchpad `C...` | Enables Fair-Flywheel v4.5 curve quoting, 48h timelock & 7Y LP Lock verification |
| `VITE_SOROSWAP_FACTORY_CONTRACT_ID` | `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` | Mainnet Soroswap Factory `C...` | Pair discovery & direct LP reserve checks |
| `VITE_SOROSWAP_ROUTER_CONTRACT_ID` | `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` | Mainnet Soroswap Router `C...` | Direct on-chain swap quoting & execution builder |
| `VITE_XLM_SAC_CONTRACT_ID` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` | Canonical XLM SAC address |
| `VITE_REFLECTOR_DEX_ORACLE_CONTRACT_ID` | *(optional / unset on Testnet)* | `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` | Optional SEP-40 on-chain DEX price oracle (graceful fallback if unset) |
| `VITE_CHAINLINK_PRICE_PROXY_CONTRACT_ID` | `CBUF6IADAWPWIDWRTHJNINKXHG2UTIQ6TU2F2HRAXWAI7OT3KJPKK6O4` | `CDQBHEUGLDHMSUHG4IH33RJBUTMNCZOT4JIAQR4WZFRDZW6DR6S32ZLZ` | Chainlink Data Feeds proxy on Stellar |
| `VITE_SEP42_ASSET_LIST_URLS` | `https://api.stellar.expert/explorer/testnet/asset-list/top50` | SDF `assets.stellar.org` SAL JSON URLs | Anti-spoof token verification registry |
| `VITE_EXPLORER_BASE_URL` | `https://stellar.expert/explorer/testnet` | `https://stellar.expert/explorer/public` | External forensic reference links |
| `VITE_ALLOW_DEV_OUTSIDE_TELEGRAM` | `false` *(or `true` locally)* | *(forbidden: must be `false`)* | Zod rejects if `true` when `mainnet` |
| `VITE_FRIENDBOT_URL` | `https://friendbot.stellar.org` | *(unset — forbidden on mainnet)* | Zod rejects if set when `mainnet` |
| `VITE_SOROBAN_MAX_RESOURCE_FEE_STROOPS` | `5000000` | `5000000` | Simulation resource fee ceiling |

---

## B. Server Worker Env, Bindings & Secrets (`apps/server` — Cloudflare `wrangler.toml` + `wrangler secret`)

| Binding / Secret | Type | Purpose |
| :--- | :--- | :--- |
| `STELLAR_NETWORK` / `STELLAR_NETWORK_PASSPHRASE` | Env Var | Must match `apps/tma` network on every `/v1/*` request |
| `STELLAR_RPC_URLS` / `HORIZON_URLS` | Env Var | Comma-separated RPC & Horizon pools for indexer, scanner, simulation & routing |
| `TMA_ORIGIN` / `ALLOWED_ORIGINS` | Env Var | Strict CORS allowlist + Telegram Mini App origin |
| `TELEGRAM_API_ORIGIN` / `TG_BOT_USERNAME` / `TG_MINI_APP_SHORT_NAME` | Env Var | Telegram Bot API origin + `t.me/<bot>/<short_name>?startapp=...` link builder |
| `ASTROWALLET_BOT_USERNAME` / `ASTROWALLET_MINI_APP_SHORT_NAME` | Env Var | Deep-link builder for `https://t.me/<walletBot>/<shortName>?startapp=i-...` |
| `ASTROWALLET_API_BASE_URL` | Env Var | Primary endpoint for `AstroID` SSO resolution & external intent federation (note: `ASTROGATE_*` and `SOROBITS_CONTRACT_ID` removed from active `wrangler.toml`, kept optional for dormant curve code) |
| `SOROSWAP_FACTORY_CONTRACT_ID` / `SOROSWAP_ROUTER_CONTRACT_ID` / `XLM_SAC_CONTRACT_ID` | Env Var | Contract IDs monitored by `DEX_INDEXER` and used by `SmartRouter` (`MAINNET_*` variants also supported) |
| `REFLECTOR_DEX_ORACLE_CONTRACT_ID` / `REDSTONE_SEP40_ORACLE_CONTRACT_ID` / `CHAINLINK_PRICE_PROXY_CONTRACT_ID` | Env Var | On-chain oracle contracts (`MAINNET_REDSTONE_SEP40_ORACLE_CONTRACT_ID` & `REFLECTOR_*` optional with graceful fallback) |
| `SOROSWAP_API_BASE` / `XOXNO_SWAP_API_BASE` | Env Var | Soroswap Aggregator & XOXNO Swap Aggregator REST bases (`MAINNET_XOXNO_SWAP_API_BASE` = `https://stellar-swap.xoxno.com`) |
| `STELLAR_EXPERT_API_BASE` / `STELLAR_PRICES_API_BASE` / `STELLAR_REGISTRY_API_BASE` | Env Var | Open Directory tags, optional Rumble Fish 24h VWAP API, and SEP-55/Registry lookups |
| `SEP42_ASSET_LIST_URLS` | Env Var | Authoritative SEP-42 asset registries cached in KV |
| `FRIENDBOT_URL` | Env Var | Optional on `testnet`; **Zod rejects if set when `STELLAR_NETWORK=mainnet`** |
| `PROXY_RATE_LIMIT_PER_MIN` / `QUOTE_RATE_LIMIT_PER_MIN` | Env Var | Per-IP / per-user throttling thresholds |
| `DB` | Cloudflare D1 | Indexed tokens, pairs, OHLCV candles, whale trades, watchlists, alerts, `signed_intents`, `rate_limits`, `processed_tg_updates` |
| `CACHE` | Cloudflare KV | Edge-cached `stellar.toml`, StellarExpert tags, SEP-42 lists, short-lived orderbook/quote snapshots |
| `DEX_INDEXER` | Durable Object | Alarm-driven cursor indexer ingesting `new_pair`, AstroGate v4.5 curve, SEP-41 `transfer`, & Protocol 23 CAP-0067 events |
| `TG_BOT_TOKEN` | Secret | `@AstroDexBot` Bot API token (`grammY` + `initData` HMAC verification) |
| `TG_WEBHOOK_SECRET` | Secret | Constant-time `X-Telegram-Bot-Api-Secret-Token` check on `/tg/webhook` |
| `INTENT_HMAC_SECRET` | Secret | Signs & verifies Mini App sessions (`15m`) and 4-field Cross-App Signed Intents (`<= 5m`) |
| `SOROSWAP_API_KEY` | Secret | Proxied `sk_` key (strictly server-side; never exposed to `apps/tma`) |
| `STELLAR_PRICES_API_KEY` | Secret | Optional Rumble Fish Stellar Prices API key (server-side only; graceful fallback if unset) |
| `ECOSYSTEM_SHARED_INTENT_SECRET` | Secret | Authenticates server-to-server `AstroWallet` external intent registration & `AstroID` SSO bindings |
| `INDEXER_WEBHOOK_SECRET` | Secret | Verifies external Goldsky Turbo Pipeline / Mercury webhooks on `/webhooks/indexer` |
