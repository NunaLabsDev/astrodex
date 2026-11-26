# AstroDex — Engineering Contract

> **Scope:** Authoritative rules for contributors and AI models in this repository (`AstroDex`).

## 1. Context Lookup (Read Only What You Need)

Check [`docs/INDEX.md`](docs/INDEX.md) first and read **only** the doc or section relevant to your task—never bulk-read `docs/` upfront.
- Env matrix & schemas: [`docs/ENV_MATRIX.md`](docs/ENV_MATRIX.md)
- Architecture & diagrams: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Ecosystem SSO & signing contract: [`docs/ECOSYSTEM_INTEGRATION.md`](docs/ECOSYSTEM_INTEGRATION.md)
- Stellar official AI resources: `developers.stellar.org/llms.txt`, global skills (`~/.agents/skills/`), and sibling repos `/Users/munay/dev/ASTRO/astrowallet` + `/Users/munay/dev/ASTRO/AstroGate`.

## 2. Non-Negotiable Engineering Rules

1. **Zero Hardcoding (100% Zod Env-Driven):** Never hardcode network passphrases (`Test SDF Network ; September 2015`, `Public Global Stellar Network ; September 2015`), Stellar RPC/Horizon endpoints, Soroswap/AstroGate/Oracle contract IDs, asset issuers, bot usernames, API keys (`sk_*`), or domain origins inside `packages/*/src` or `apps/*/src`. Parse and validate every variable at startup via `@astrodex/domain` (`parseTmaConfig`, `parseServerConfig`); switch `testnet` $\leftrightarrow$ `mainnet` strictly via `STELLAR_NETWORK` / `VITE_STELLAR_NETWORK`.
2. **Real Testnet Parity & Mainnet Hard-Blocks:** Runtime code (`apps/tma`, `apps/server`, `packages/*`) must execute against real Stellar Testnet/Mainnet endpoints—never ship stubbed balances, fake OHLCV candles, fake orderbooks, or simulated tx hashes outside `*.test.ts`. Zod/runtime must reject `FRIENDBOT_URL` / `VITE_FRIENDBOT_URL` and `VITE_ALLOW_DEV_OUTSIDE_TELEGRAM=true` whenever network is `mainnet`.
3. **AstroWallet Exclusive `AstroID` SSO & Signing Hub (Zero Key Custody in AstroDex):** `AstroDex` must **never** generate, store, import, export, or prompt for mnemonics, `S...` secret seeds, or vault PINs, and never duplicate user wallet linking/custody flows. Resolve user public `G...`/`C...` addresses from **AstroWallet** (`AstroID` SSO). Pre-scan all state-changing transactions via `@astrodex/security-shield`, bind them to a 4-field HMAC-Signed Intent (`${network}:${intentId}:${telegramUserId}:${expiresAt}`, `<= 5 min` TTL, `CrossAppIntentEnvelope v1` mapping to `swap` / `sign_xdr`), and hand off to **AstroWallet** (`https://t.me/AstroWalletAppBot/wallet?startapp=i-<intentId>-<sig>`).
4. **Strict Hexagonal DAG Boundaries:** Enforced by `eslint.config.mjs` (`no-restricted-imports`) and `tsconfig.base.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`):
   - `domain` (`zod` only) $\leftarrow$ `stellar-scanner` | `dex-aggregator` | `oracles-and-charts` | `security-shield` | `tg-protocol` (no peer imports between these 5 domain/adapter packages) $\leftarrow$ `apps/tma` (no `grammy`/`hono`/D1/KV/`sk_*`) & `apps/server` (no React/DOM/user private keys).
   - Full matrix: [`.agents/rules/hexagonal-boundaries.md`](.agents/rules/hexagonal-boundaries.md).
5. **Honest Classic (`G...`) vs. Smart Account (`C...`) Boundaries:** Never hide Stellar protocol differences:
   - **Classic (`G...`):** Supports Classic SDEX Limit Orders (`manageSellOffer` / `manageBuyOffer`), `pathPaymentStrictSend`, `changeTrust`, CAP-38 Liquidity Pools, and Soroban SAC swaps. Default here when user has no deployed `C...` Smart Account (`VITE_SMART_ACCOUNT_WASM_HASH` unset).
   - **Smart Account (`C...`):** Supports Soroban AMMs (`Soroswap`, `Aquarius`, `Phoenix`, `XOXNO`, `AstroGate Curve`) and gasless execution via AstroWallet/OpenZeppelin Channels, and **cannot** place Classic SDEX orderbook offers or hold native Classic trustlines—filter routing automatically and surface a 1-tap SAC transfer intent to the user's linked `G...` when Classic SDEX is desired.
6. **Soroswap, AstroGate v4.5 & Precision Invariants:**
   - Always use `bigint` 7-decimal stroops integer math (`1 XLM = 10_000_000` stroops) for quotes, reserves, fees, slippage, and curve calculations—never floating-point arithmetic for signed amounts.
   - Read `token_0()`, `token_1()`, and `get_reserves()` directly from Soroswap Pair contracts; quote direct on-chain swaps via `router_get_amount_out(amount_in, reserve_in, reserve_out)` (never `router_get_amounts_out`).
   - Reconstruct Soroban AMM trade/OHLCV history from SEP-41 `transfer` events on registered Pair contracts, Protocol 23 CAP-0067 events, and AstroGate Launchpad events (deployed Soroswap Pair contracts emit zero `swap` events).
   - Integrate exclusively with **AstroWallet** (`NunaLabsDev/astrowallet`) and **AstroGate v4.5** (`NunaLabsDev/astrogate`, supporting `trigger_buyback_burn_with_bounty`, `claim_jackpot`, 48h timelock, 30d `CurveClosed`, and SHA-256 logos).
7. **Telegram-Exclusive Mini App, 100% English & ToS Clause 7.3–7.4:**
   - `apps/tma` runs **100% inside Telegram** (`TelegramOnlyGate` + `POST /v1/tg/auth` HMAC-SHA256 `initData`, `auth_date <= 300s`, 15m session token; zero standalone public marketing site; never trust `initDataUnsafe`).
   - **100% English:** Every UI string, scanner explanation, error, `@AstroDexBot` command/reply, inline card, and doc must be in English.
   - Use internal Telegram deep links (`https://t.me/<bot>/<short_name>?startapp=...`) in Telegram buttons/messages. Never inject `window.stellar` or non-TON WalletConnect/Reown external dApp connectors (Telegram ToS §7.3–7.4). Framing CSP: `frame-ancestors https://web.telegram.org https://*.telegram.org`.
8. **Verification & Definition of Done:** Every milestone/PR must pass `pnpm check` (`pnpm --filter "./packages/*" build && pnpm -r typecheck && pnpm -r lint && pnpm test && pnpm secret-scan && pnpm --filter @astrodex/tma build`), keep `@stellar/stellar-xdr-json` (~3 MB WASM) excluded from initial `apps/tma` chunks (lazy Web Worker only), and keep CSP free of `'unsafe-inline'`, `'unsafe-eval'`, and wildcard `*.workers.dev`.
