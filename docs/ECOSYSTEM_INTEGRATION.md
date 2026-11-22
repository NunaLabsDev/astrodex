# Astro Ecosystem Integration Contract (`AstroWallet` $\leftrightarrow$ `AstroDex` $\leftrightarrow$ `AstroGate v4.5`)

> **Objective:** Define the exact cryptographic, API, smart contract, and Telegram deep-link contracts enabling **AstroWallet**, **AstroGate v4.5**, and **AstroDex** to operate as one harmonious, non-custodial, zero-overlap Telegram-native financial suite ("1 Identity, 3 Pure Pillars").

---

## 1. Core Ecosystem Division of Responsibilities (3-Pillar Harmony)

| Pillar | Telegram Surface | Primary Ownership (Pure Mission) | Never Does (No Overlap) |
| :--- | :--- | :--- | :--- |
| **1. AstroWallet** *(Control Center & `AstroID` Hub)* | `@AstroWalletAppBot` (`t.me/AstroWalletAppBot/wallet`) | **Exclusive Login (`AstroID` SSO) & Directory** (`@username` / `telegram_user_id` $\leftrightarrow$ public `G...`/`C...`/`TON`), Non-custodial SEP-0005 + Smart Account custody (`Argon2id` 64 MiB + `AGVAULT` v1), PIN/Biometrics, Universal `IntentSheet` Clear-Sign + `Scan & Shield`, Fee-Bump Relay (`/v1/relay/submit`), P2P payments & Claim Links V2.2 | Does not duplicate Pro DEX OHLCV charts, multi-venue SDEX orderbook terminals, or launchpad token minting |
| **2. AstroGate v4.5** *(Launchpad & Culture Factory)* | `@AstroGateSorobanBot` (`astrogate.pages.dev`) | **Fair-Flywheel v4.5 Token Launchpad** (`10M` fixed supply, `0 -> 1,000 XLM` bonding curve, 3-Checkpoint Jackpot Ladder, 7-Year LP Lock, 48h timelock, Burn-to-Chat, 2% Keeper Buyback & Burn), and SHA-256 Logo CDN (`/api/v1/logos/{sha256}.{ext}`) | Exclusively delegates wallet custody/signing to `AstroWallet` (`AstroID` SSO + AstroConnect v1, `<HotWalletModal />` deprecated), prepares **Sorobits SEP-50** decoupling into standalone Pillar 4, and delegates graduated DEX terminals to `AstroDex` |
| **3. AstroDex** *(Trading Terminal & Forensic X-Ray)* | `@AstroDexBot` (`t.me/AstroDexBot/dex`) | **5-Way Smart Liquidity Aggregation**, Classic SDEX Orderbooks & Native Limit Orders (`manageBuyOffer`/`manageSellOffer`), "SDEX Reboot + Soroban X-Ray" Forensic Scanner (`Astro Shield 0–100`), D1/DO OHLCV Indexing, On-Chain Oracles, Pro Launchpad Command Center | **Never custodies private keys, generates mnemonics, imports `S...` seeds, prompts for vault PINs, or runs token-minting UI** |
| **4. Sorobits NFT Market** *(Future Decoupled Pillar)* | `@AstroMarketBot` (`VITE_SOROBITS_MARKETPLACE_URL`) | **Standalone Sorobits SEP-50** (`32×32` on-chain SVG NFTs, Quests, `TokenBaseXp`, commit-reveal Forge, independent listings & collector market) | Decoupled from Launchpad (`set_launchpad_optional`); signs via `AstroWallet` |

### No-Overlap Cross-App Routing Table
| User Intent | Source App | Destination App & Deep Link |
| :--- | :--- | :--- |
| **Trade / Pro Chart / Forensic Scan** on any token | `AstroWallet` | `AstroDex`: `https://t.me/AstroDexBot/dex?startapp=token_<assetId>` |
| **Trade on DEX / Pro Chart** for graduated curve pool | `AstroGate` | `AstroDex`: `https://t.me/AstroDexBot/dex?startapp=pair_<pairId>` |
| **Launch New Token / Mint Sorobit NFT** | `AstroDex` or `AstroWallet` | `AstroGate`: `https://t.me/AstroGateSorobanBot?start=launch` |
| **Connect Wallet (`AstroID`) / Sign Any Transaction** | `AstroDex` or `AstroGate` | `AstroWallet`: `https://t.me/AstroWalletAppBot/wallet?startapp=i-<intentId>-<sig>` (or `t-vault` for initial onboarding) |

---

## 2. `AstroID` Single Sign-On & Identity Resolution (`Telegram.WebApp.initData` + `@username`)

1. **Zero-Friction TMA Session Establishment (`AstroDex`):**
   - `apps/tma` reads `window.Telegram.WebApp.initData` and sends `POST /v1/tg/auth`.
   - `apps/server` verifies the HMAC-SHA256 signature (`WebAppData` + `TG_BOT_TOKEN`, `auth_date <= 300s`), extracts immutable `telegram_user_id` and normalized `username_lower`, and issues a short-lived `15m` session Bearer token.
2. **Automatic `AstroID` Public Address Resolution (`G...` & `C...`):**
   - Because `AstroWallet` is the exclusive login and custody hub, `AstroDex` (and `AstroGate`) never prompt users to import seeds or run redundant SEP-53 `/connect` flows.
   - `AstroDex` resolves the authenticated user's verified public addresses (`G...` Classic + optional `C...` Smart Account) and optional **Sorobit SEP-50** avatar via the **Ecosystem Identity Resolver cascade**:
     1. **Primary (`AstroWallet` `AstroID` Directory):** `GET ${ASTROWALLET_API_BASE_URL}/v1/identity/resolve?q=<tgUserId|@username>` (returning only public addresses and `@username`—**never** `encryptedVaultBundle` or `AGVAULT` ciphertext).
     2. **Transitional Fallback (`AstroGate` Directory):** `GET ${ASTROGATE_API_BASE_URL}/api/v1/wallet/resolve?q=<tgUserId|@username>` during `AstroGate` migration.
   - If the user has not yet created/linked an `AstroWallet` account, `AstroDex` remains 100% usable in read-only Radar/Scanner mode and presents a 1-tap **"Connect with AstroWallet"** button opening `https://t.me/AstroWalletAppBot/wallet?startapp=t-vault`.
3. **Protocol-Honest Active Account Switcher & `G...` Default:**
   - When `VITE_SMART_ACCOUNT_WASM_HASH` is unset in `AstroWallet` or the user has no deployed `C...` Smart Account, `AstroDex` defaults cleanly to the user's primary Classic `G...` account (which supports Classic SDEX Limit Orders, `pathPaymentStrictSend`, `changeTrust`, CAP-38 LPs, Soroban AMMs, and AstroGate Curves).
   - Users with both `G...` and `C...` can switch active quoting accounts (`C...` filters out Classic SDEX offers and surfaces a 1-tap SAC transfer intent to `G...` when Classic SDEX is desired).
   - If a `G...` swap requires a missing trustline and lacks `0.5 XLM` CAP-33 reserve headroom, `AstroDex` offers **1-Tap Reserve Rescue (`LumenWipe`)** or sponsored execution via `AstroWallet`'s `/v1/relay/submit` fee-bump relay.

---

## 3. Bit-Exact `CrossAppIntentEnvelope v1` & Boomerang Signing Handshake

Every state-changing action initiated in `AstroDex` (or `AstroGate`) uses **bit-exact cryptographic parity** with `@astrowallet/tg-protocol` (`intent-token.ts`) so `AstroWallet`'s `IntentSheet.tsx` executes seamlessly:

### Canonical 4-Field HMAC-SHA256 Token (Exact `@astrowallet/tg-protocol` Parity)
- **Canonical HMAC-SHA256 message:**
  ```text
  ${network}:${intentId}:${telegramUserId}:${expiresAt}
  ```
- **TTL:** `<= 5 minutes` (`300s`).
- **XDR Integrity Binding:** `xdrSha256` (`SHA-256` hex of `unsignedXdr`) is stored and verified inside `payloadJson` (`CrossAppIntentEnvelope v1`) so the 4-field HMAC signature remains 100% compatible with `signIntentToken` / `verifyIntentToken` in `AstroWallet`.

### Mapping AstroDex Actions to `AstroWallet` `IntentSheet` Types
`AstroWallet` validates `actionType` against `["connect", "pay", "request", "split", "swap", "claim", "reclaim_reserve", "sign_xdr"]`. `AstroDex` emits:
1. `actionType: "swap"` — Used for 5-Way Smart Router swaps (`AstroGate Curve`, `Soroswap`, `XOXNO`, `Direct Pair`, `Horizon Path` with optional prepended `changeTrust`).
   - `payload`: `{ originApp: "astrodex", subAction: "dex_swap", fromAsset, toAsset, amount, expectedOutputAmount, provider, priceImpactPct, unsignedXdr, xdrSha256, returnStartAppParam }`.
2. `actionType: "sign_xdr"` — Used for all other non-swap on-chain transactions:
   - `subAction: "sdex_limit_order_create" | "sdex_limit_order_cancel"` (`manageBuyOffer` / `manageSellOffer`, `G...` only).
   - `subAction: "soroban_extend_ttl"` (Protocol 23 `ExtendFootprintTtlOp`).
   - `subAction: "astrogate_buyback_burn"` (`trigger_buyback_burn_with_bounty` / `trigger_buyback_burn_min`).
   - `subAction: "astrogate_claim_jackpot"` (`claim_jackpot` Spark/Crown reward claim) or `astrogate_close_curve_refund` (30d `CurveClosed` refund).
   - `payload`: `{ originApp: "astrodex", subAction, humanSummary, unsignedXdr, xdrSha256, returnStartAppParam }`.

### Canonical "Boomerang" Handoff Flow
1. **Build & Pre-Scan (`AstroDex`):**
   - Construct unsigned `TransactionEnvelope` XDR bound to `STELLAR_NETWORK_PASSPHRASE` and the user's `G...` or `C...` public source account.
   - Run `@astrodex/security-shield` (`simulateTransaction` + `balanceDiffs` + SEP-42 spoof guard + drainer AST check). Abort fail-closed on any `malicious` verdict.
2. **Persist & Federate Intent (`<= 5 min` TTL):**
   - Persist locally in `AstroDex` D1 `signed_intents` table (`intent_id`, `telegram_user_id`, `network`, `action_type`, `source_address`, `unsigned_xdr`, `xdr_sha256`, `summary_json`, `expires_at`, `hmac_sig`) and register/federate with `AstroWallet` (`POST ${ASTROWALLET_API_BASE_URL}/v1/intents/external`, authenticated via `ECOSYSTEM_SHARED_INTENT_SECRET` or direct Worker binding) so `AstroWallet`'s `IntentSheet.tsx` loads `GET /v1/intents/:intentId?sig=...`.
3. **Deep-Link Launch to `AstroWallet`:**
   - `apps/tma` invokes `Telegram.WebApp.openTelegramLink("https://t.me/AstroWalletAppBot/wallet?startapp=i-" + intentId + "-" + hmacSig)` (or renders an inline Telegram button in `@AstroDexBot`).
4. **Independent Clear-Sign & Broadcast (`AstroWallet`):**
   - `AstroWallet` validates the 4-field HMAC token and `xdrSha256`, re-runs its own `Scan & Shield` verification independently (**Zero Trust between apps**), displays the human-readable Clear-Sign Glass Sheet, authenticates via PIN/Biometrics, signs with the user's SEP-0005 key / `C...` passkey, and submits to Stellar RPC/Horizon (or OpenZeppelin Channels fee-bump relay).
5. **Boomerang Return & Confirmation Sync:**
   - `AstroWallet` dispatches the server-to-server Boomerang callback `POST /v1/intents/:id/confirm` (`c.env.ASTRODEX` Service Binding or `ASTRODEX_API_BASE_URL`) authenticated with `X-Ecosystem-Secret` (plus optional `originConfirmSig` HMAC), passing `txHash` cleanly. `AstroDex` (`apps/tma`) also auto-syncs `feedNetwork` on `token_`/`scan_`/`pair_` deep-links when running on `testnet` and blocks execution (`executionDisabled = !config.executionEnabled || feedNetwork !== config.network`) if a cross-network mismatch exists.

---

## 4. Real-Time Integration with `AstroGate v4.5` + Sorobits SEP-50 + Logo CDN

- **Contract Truth Over Centralized DBs:** `AstroDex` reads directly from `ASTROGATE_LAUNCHPAD_CONTRACT_ID` (`CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK` on Testnet; v4.5 WASM `9db8d446725715069d85c51c4fb1b897bb93d036507a6b95fe085c64f4aaa4e9`, backwards-compatible with v4.4 `fd2f1a6e...`) and its `DEX_INDEXER` Durable Object cursor:
  - **Auto-Discovery:** Every `launch_fair` event automatically registers the new token in `AstroDex` with badge `AstroGate Fair Launch v4.5` and deep-links to `AstroGate` (`https://t.me/AstroGateSorobanBot?start=token_<id>`).
  - **1:1 Bonding Curve Parity (`v4.5`):** `@astrodex/dex-aggregator` implements exact integer `bigint` parity with `contracts/launchpad/src/contract.rs` (`1,000 vXLM` virtual start, `6,600,000` curve tokens, 3-stage buy fees `30/50/25 bps`, 3-stage sell fees `120/180/150 bps`, `1,000 XLM` graduation target).
  - **Seamless Graduation Venue Switch:** When `graduated == true`, `SmartRouter` automatically switches from `buy_curve`/`sell_curve` to the seeded `Soroswap` pair while `@astrodex/stellar-scanner` verifies **7-Year Contract-Locked LP**, **48h Upgrade Timelock** (`propose_upgrade` / `execute_upgrade` / `cancel_upgrade`), and **30d `CurveClosed` principal refund** status directly from the Launchpad contract.
  - **Jackpot Ladder & Keeper Buyback Radar (`v4.5`):** Displays remaining XLM to Spark (`250 XLM`, `+5K`), Crown (`500 XLM`, `+10K`), and Graduation (`1,000 XLM`, `+25K`), escrowed `claim_jackpot` availability, live `burn_shout` messages, and permissionless `trigger_buyback_burn_with_bounty` (`200 bps` / `2%` keeper rebate capped at `0.05 XLM`, max chunk `25 bps` of reserve / `0.80 XLM`, min dust `0.001 XLM`, `300s` cooldown).
  - **Immutable Content-Addressed Logo Resolution:** Resolves token raster logos from `AstroGate`'s SHA-256 CDN (`${ASTROGATE_API_BASE_URL}/api/v1/logos/{sha256}.{ext}`) alongside SEP-0001 `stellar.toml` `[[CURRENCIES]]` metadata.
  - **Sorobits SEP-50 (`CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3`, v4.5):** Displays verified `32×32` on-chain RLE/SVG trader avatars in the `AstroID` header and `TokenBaseXp` badges in the Launchpad Command Center.
