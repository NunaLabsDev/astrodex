---
trigger: model_decision
description: "AstroWallet exclusive AstroID SSO & signing delegation, zero key custody in AstroDex, honest G.../C... boundaries, 100% English policy, and Telegram Mini App ToS Clause 7.3-7.4 compliance."
---

# AstroDex SSO, Signing Delegation, Account Boundaries & Telegram Policy

## 1. AstroWallet Exclusive `AstroID` SSO & Signing Hub (Zero Key Custody)
- **Zero Private Keys or Vault Login in AstroDex:** Never generate, request, import, export, or store Stellar `S...` secret seeds, BIP-39 mnemonics, or vault PINs inside `apps/tma` or `apps/server`, and never run duplicate wallet-linking/custody flows. Resolve linked public addresses (`G...`/`C...`) and Sorobits avatars via **AstroWallet `AstroID` SSO** (with transitional fallback to AstroGate's public resolver).
- **Mandatory Signed Intent Handoff (`CrossAppIntentEnvelope v1`):** Every state-changing transaction must pass `@astrodex/security-shield` (`simulateTransaction` + `balanceDiffs` + SEP-42 spoof checks), mint a 4-field HMAC-SHA256 Signed Intent (`${network}:${intentId}:${telegramUserId}:${expiresAt}`, `<= 5 min` TTL) mapping to `AstroWallet`'s `actionType: "swap"` or `"sign_xdr"` (covering `sdex_limit_order_create`, `sdex_limit_order_cancel`, `soroban_extend_ttl`, `astrogate_buyback_burn`, `astrogate_claim_jackpot`, `astrogate_close_curve_refund`) with `xdrSha256` and `returnStartAppParam`, and deep-link to **AstroWallet** (`https://t.me/<ASTROWALLET_BOT_USERNAME>/<SHORT_NAME>?startapp=i-<intentId>-<sig>`).
- **Verified Telegram Sessions:** Authenticate TMA requests exclusively by verifying `Telegram.WebApp.initData` via HMAC-SHA256 (`POST /v1/tg/auth`, `auth_date <= 300s`, 15m Bearer token)—never trust unverified `initDataUnsafe`.

## 2. Honest Classic (`G...`) vs. Smart Account (`C...`) Boundaries
- **Classic (`G...`):** Supports Classic SDEX Limit Orders (`manageBuyOffer` / `manageSellOffer`), `pathPaymentStrictSend`, automatic `changeTrust` bundling (checking `0.5 XLM` reserve headroom or offering 1-tap `LumenWipe` / fee-bump relay), CAP-38 Liquidity Pools, and Soroban SAC swaps. Default to `G...` when the user has no deployed `C...` Smart Account.
- **Smart Account (`C...`):** Supports Soroban AMMs (`Soroswap`, `Aquarius`, `Phoenix`, `XOXNO`, `AstroGate Curve`) and cannot directly place Classic SDEX limit orders or Classic path payments—filter quotes by active address class and offer a 1-tap SAC bridge intent to the linked `G...` account when Classic SDEX is requested.

## 3. Telegram-Exclusive Mini App, 100% English & ToS Clause 7.3–7.4
- `apps/tma` runs **100% inside Telegram** (`TelegramOnlyGate`), strictly in **English** across all UI, scanner verdicts, and `@AstroDexBot` commands/inline cards.
- Use internal Telegram deep links (`https://t.me/<bot>/<short_name>?startapp=...`) in Telegram buttons/messages.
- Never inject `window.stellar` or non-TON WalletConnect/Reown external dApp connectors (Telegram ToS §7.3–7.4). Framing CSP: `frame-ancestors https://web.telegram.org https://*.telegram.org`.
