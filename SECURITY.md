# Security Policy

## Architectural Trust Model (Zero Key Custody in AstroDex)
**AstroDex** never generates, requests, stores, or processes Stellar secret seeds (`S...`), BIP-39 mnemonics, or vault PINs:
- **Identity Verification:** Telegram Mini App sessions validate `Telegram.WebApp.initData` server-side via HMAC-SHA256 (`WebAppData` + `TG_BOT_TOKEN`, `auth_date <= 300s`). `initDataUnsafe` is never trusted.
- **Exclusive Transaction Signing:** All user transactions are simulated via Soroban RPC (`simulateTransaction`), audited by `@astrodex/security-shield`, bound to a single-use **HMAC-SHA256 Intent Token (`<= 5 min` TTL)** scoped by network (`testnet` | `mainnet`) and `telegram_user_id`, and routed to **AstroWallet** (`@AstroWalletAppBot`) for PIN/Biometric authorization.
- **Anti-Spoof & Anti-SSRF Controls:**
  - Protected asset tickers (`USDC`, `EURC`, `PYUSD`, `AQUA`, `BTC`, `ETH`, `USDT`, `YUSDC`, `YXLM`, `XLM`) with mismatched issuers are deterministically hard-blocked from swap execution.
  - SEP-0001 `stellar.toml` fetches run strictly through an SSRF-hardened Cloudflare Worker proxy with manual redirect validation, private-IP blocking, 5s timeout, and 128 KB payload limits.
  - Strict CSP enforces `frame-ancestors https://web.telegram.org https://*.telegram.org` and zero `'unsafe-inline'` scripts/styles or wildcard `*.workers.dev`.
- **Secrets Hygiene:** Never commit `.env`, `.env.local`, `.dev.vars`, `TG_BOT_TOKEN`, `INTENT_HMAC_SECRET`, `SOROSWAP_API_KEY`, or `S...` keys. Secrets live exclusively in `wrangler secret put` or local `~/.secrets/astrodex/` (`chmod 600`).

## Reporting a Vulnerability
Do **not** open a public GitHub issue for exploitable vulnerabilities (HMAC intent forgery/replay, Scan & Shield bypass, spoofed ticker bypass, SSRF on `stellar.toml` proxy, XSS/CSP bypass, or D1/KV poisoning).

Contact the **NunaLabsDev** maintainers privately with reproduction steps, affected commit/module, and impact assessment before public disclosure.
