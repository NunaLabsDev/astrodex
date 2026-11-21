# Astro Ecosystem Integration Contract (`AstroWallet` $\leftrightarrow$ `AstroDex` $\leftrightarrow$ `AstroGate v4.4`)

> **Objective:** Define the exact cryptographic, API, smart contract, and Telegram deep-link contracts enabling **AstroWallet**, **AstroGate v4.4**, and **AstroDex** to operate as one harmonious, non-custodial Telegram-native financial suite.

---

## 1. Core Ecosystem Division of Responsibilities

| Pillar | Telegram Surface | Primary Ownership | Never Does |
| :--- | :--- | :--- | :--- |
| **AstroWallet** | `@AstroWalletAppBot` (`t.me/AstroWalletAppBot/wallet`) | Non-custodial SEP-0005 (`G...`) + Smart Account (`C...`) key custody, `AGVAULT` v1, PIN/Biometrics, Clear-Sign `Scan & Shield`, OpenZeppelin Channels fee sponsorship, Telegram P2P & Claim Links V2 | Does not duplicate full Pro DEX charting, multi-venue orderbook terminals, or launchpad token minting |
| **AstroGate v4.4** | `@AstroGateSorobanBot` (`astrogate.pages.dev`) | Fair-Flywheel v4.4 Token Launchpad (`10M` fixed supply, `0 -> 1,000 XLM` bonding curve, 3-Checkpoint Jackpot Ladder, 7-Year LP Lock, Burn-to-Chat, Buyback & Burn) + Sorobits (SEP-50) | Does not duplicate multi-token Classic SDEX orderbook scanning or cross-DEX aggregation |
| **AstroDex** | `@AstroDexBot` (`t.me/AstroDexBot/dex`) | 5-Way Liquidity Aggregation, Classic SDEX Orderbooks & Limit Orders, "SDEX Reboot + Soroban X-Ray" Forensic Scanner, OHLCV Indexing, On-Chain Oracles, Pro Launchpad Command Center | **Never custodies private keys, generates mnemonics, imports `S...` seeds, or prompts for vault PINs** |

---

## 2. Authentication & Identity Resolution (`Telegram.WebApp.initData` + `@username`)

1. **TMA Session Establishment (`AstroDex`):**
   - `apps/tma` reads `window.Telegram.WebApp.initData` and sends `POST /v1/tg/auth`.
   - `apps/server` verifies the HMAC-SHA256 signature (`WebAppData` + `TG_BOT_TOKEN`, `auth_date <= 300s`), extracts immutable `telegram_user_id` and normalized `username_lower`, and issues a short-lived `15m` session Bearer token.
2. **Public Address Resolution (`G...` & `C...`):**
   - `AstroDex` resolves the authenticated user's verified Stellar public addresses from the ecosystem wallet directory (`AstroWallet` / `AstroGate` `GET /api/v1/wallet/resolve?q=<tgUserId|@username>`, returning only public `G...` and `C...` addresses—**never** `encryptedVaultBundle`).
   - If the user has not yet linked an AstroWallet account, `AstroDex` displays read-only market/scanner tools seamlessly and shows a 1-tap **"Connect AstroWallet"** button launching `https://t.me/AstroWalletAppBot/wallet?startapp=t-vault`.
3. **Protocol-Honest Active Account Switcher:**
   - Users with both a Classic `G...` and a Smart Account `C...` can toggle which public address `AstroDex` quotes against (`G...` unlocks Classic SDEX + Limit Orders + `changeTrust` + Soroban SAC; `C...` focuses on gasless Soroban AMMs + AstroGate Curve).

---

## 3. Exclusive Signing Handoff Protocol (`AstroDex` $\rightarrow$ `AstroWallet`)

Every state-changing action initiated in `AstroDex` passes through this exact flow:

### Supported `SignedIntent` Action Types
1. `dex_swap`: 5-Way Smart Router swap (`Soroswap`, `XOXNO`, `Direct Pair`, `AstroGate Curve`, or `Horizon Path` with optional prepended `changeTrust`).
2. `sdex_limit_order_create` / `sdex_limit_order_cancel`: Classic SDEX `manageBuyOffer` or `manageSellOffer` (`G...` only).
3. `soroban_extend_ttl`: Protocol 23 `ExtendFootprintTtlOp` to rescue/extend token or pool storage TTL.
4. `astrogate_buyback_burn`: Permissionless `trigger_buyback_burn_min` call on `AstroGate Launchpad v4.4`.

### Canonical Handoff Steps
1. **Build & Pre-Scan (`AstroDex`):**
   - Construct unsigned `TransactionEnvelope` XDR bound to `STELLAR_NETWORK_PASSPHRASE` and the user's `G...` or `C...` public source account.
   - Run `@astrodex/security-shield` (`simulateTransaction` + `balanceDiffs` + SEP-42 spoof guard + drainer AST check). Abort fail-closed on any `malicious` verdict.
2. **Mint Short-Lived Signed Intent (`<= 5 min` TTL):**
   - Persist in `signed_intents` D1 table: `intent_id`, `telegram_user_id`, `network`, `action_type`, `source_address`, `unsigned_xdr`, `xdr_sha256`, `summary_json`, `expires_at`, `hmac_sig`.
   - Canonical HMAC-SHA256 message: `${network}:${intentId}:${telegramUserId}:${expiresAt}:${xdrSha256}`.
3. **Deep-Link Launch to AstroWallet:**
   - `apps/tma` triggers `Telegram.WebApp.openTelegramLink("https://t.me/AstroWalletAppBot/wallet?startapp=i-" + intentId + "-" + hmacSig)` (or renders the native Telegram button in `@AstroDexBot`).
4. **Clear-Sign & Broadcast (`AstroWallet`):**
   - `AstroWallet` validates the intent token, re-runs its own `Scan & Shield` verification independently (**Zero Trust between apps**), displays the human-readable Clear-Sign Glass Sheet, authenticates via local PIN/Biometrics, signs with the user's SEP-0005 key / `C...` passkey, and submits to Stellar RPC/Horizon (or OpenZeppelin Channels if sponsored).
5. **Confirmation Sync:**
   - `AstroWallet` notifies `POST /v1/intents/:id/confirm` with `txHash` (or `DEX_INDEXER` detects the matching transaction on-chain), verifying op-level match and updating both `AstroDex` TMA and `@AstroDexBot` chat cards (`⏳ Pending` $\rightarrow$ `✅ Confirmed`).

---

## 4. Real-Time Integration with `AstroGate v4.4`

- **Contract Truth Over Centralized DBs:** `AstroDex` reads directly from `ASTROGATE_LAUNCHPAD_CONTRACT_ID` (`CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK` on Testnet) and its `DEX_INDEXER` Durable Object cursor:
  - **Auto-Discovery:** Every `launch_fair` event automatically registers the new token in `AstroDex` with badge `AstroGate Fair Launch v4.4` and links `AstroGate` token details (`https://t.me/AstroGateSorobanBot?start=token_<id>`).
  - **1:1 Bonding Curve Parity:** `@astrodex/dex-aggregator` implements exact integer `bigint` parity with `contracts/launchpad/src/contract.rs` (`1,000 vXLM` virtual start, `6,600,000` curve tokens, 3-stage buy fees `30/50/25 bps`, 3-stage sell fees `120/180/150 bps`, `1,000 XLM` graduation target).
  - **Graduation Seamlessly Switches Liquidity Venue:** When `graduated == true`, `SmartRouter` automatically stops routing to `buy_curve`/`sell_curve` and routes to the seeded `Soroswap` pair while the Scanner reads `7-Year Contract-Locked LP` status directly from the Launchpad contract.
  - **Jackpot & Burn Radar:** Displays remaining XLM to Spark (`250`), Crown (`500`), and Graduation (`1,000`) checkpoints, live `burn_shout` messages, and `buybackXlmReserve` cooldown status (`300s`, max `0.50%` reserve / `250 XLM` chunk).
