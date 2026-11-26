# AstroDex

> **100% Phone-First, Telegram-Exclusive Stellar DEX, Multi-Venue Aggregator & Forensic Token Scanner** — Filling the void left by legacy StellarDEX (`SDEX`) explorers for Telegram communities by uniting **Stellar Classic Orderbooks & CAP-38 Liquidity Pools**, **Soroban AMMs** (`Soroswap`, `Aquarius`, `Phoenix`, `SushiSwap V3`, `Comet`, optional `XOXNO`), **AstroGate Fair-Flywheel v4.5 Bonding Curves**, **On-Chain Oracles**, and **Protocol 23 OHLCV Indexing** inside a single **Apple Liquid Glass** Mini App + Super-Bot (`@AstroDexBot`), seamlessly unified under **AstroWallet** (`@AstroWalletAppBot`) as the exclusive `AstroID` SSO Login & Signing Hub.

---

## Vision & Problem Statement

After the disappearance of the legacy StellarDEX (`SDEX`) web explorer, Stellar Telegram trading communities were fragmented across desktop-heavy orderbook UIs (**StellarX**, **StellarTerm**), pure AMM routers without security telemetry (**Soroswap**, **Aquarius**), and raw forensic block explorers without one-tap execution (**StellarExpert**, **SorobanScan**).

**AstroDex** unifies all of them inside Telegram—engineered from day one with modular hexagonal boundaries, zero-hardcoding Zod configuration, and real **Testnet-to-Mainnet** parity:

1. **Progressive Disclosure UI (`⚡ Basic Mode` $\leftrightarrow$ `🔬 Pro Scanner Mode`):**
   - **Basic Mode (Retail / Beginners):** Instant safety verdict (`0–100` Astro Shield Score with plain-English explanations), clean area price chart, liquidity & market cap clarity, AstroGate graduation tracker, and 1-tap best-route swap (`25% / 50% / MAX`) with automatic trustline checks.
   - **Pro Scanner Mode (Traders & Forensic Researchers):** TradingView Lightweight OHLCV candlestick charts + volume, unified multi-venue **Depth Chart** (`±2% / ±5%`), live **Classic SDEX Orderbook** + native **SDEX Limit Orders** (`manageBuyOffer` / `manageSellOffer`), Top-10 Holder & Whale concentration table, full Classic & Soroban forensic security matrix, Protocol 23 TTL/State Archival monitor, and raw XDR pre-sign simulation.
2. **5-Way Smart Liquidity Router + Native SDEX Limit Orders:**
   - Quotes and routes across **Soroswap Aggregator** (`Soroswap`, `Aquarius`, `Phoenix`, `SushiSwap V3`, `Comet`, `SDEX`), optional **XOXNO Swap Aggregator**, **Direct On-Chain Soroswap Pair/Router**, **AstroGate v4.5 Bonding Curve** (`0 → 1,000 XLM`), and **Classic Horizon Path Payments + Orderbook Walk**.
   - Automatically detects missing Classic trustlines on `G...` accounts and bundles `changeTrust` atomically with swaps or limit orders while checking `0.5 XLM` CAP-33 reserve headroom (with 1-tap `LumenWipe` / fee-bump relay options).
3. **"SDEX Reboot + Soroban X-Ray" Forensic Scanner:**
   - **Classic Assets (`G...`):** Mathematical **Issuer Lock** check (`master_weight == 0` AND combined secondary `signers` weight `< low_threshold`), compliance flag inspection (`AUTH_REQUIRED`, `AUTH_REVOCABLE` freeze, `AUTH_CLAWBACK_ENABLED`, `AUTH_IMMUTABLE`), SSRF-hardened **SEP-0001 `stellar.toml`** metadata verification, **SEP-42** official asset registry validation (hard-blocking spoofed tickers like fake `USDC`/`XLM`), and **StellarExpert Directory** threat tags (`#malicious`, `#unsafe`).
   - **Soroban Tokens (`C...` / SEP-41):** `owner()`/`admin()` mint-authority renouncement check, **SEP-48** `contract.Spec` & AST inspection for dangerous functions (`clawback`, `set_admin`, `upgrade`), **SEP-55** verified build & **Stellar Registry (`rgstry.xyz`)** status, 48h timelock & 7-Year LP Lock vs. `GAAAA...WHF` burn verification, **AstroGate SHA-256 logo** resolution, Top-10 Holder concentration, and **Protocol 23 ("Whisk" CAP-0062/0066)** contract TTL / archival countdown with 1-tap TTL extension.
4. **On-Chain Oracles & Real-Time OHLCV Indexer:**
   - Cross-references prices against **Chainlink Data Feeds on Stellar**, plus optional **Reflector Network (SEP-40)** and **Rumble Fish Stellar Prices API** (24h cross-venue VWAP).
   - Runs a Cloudflare **Durable Object (`DEX_INDEXER`) + D1** pipeline ingesting `SoroswapFactory` `new_pair` events, SEP-41 `transfer` events on pair contracts (essential because deployed Soroswap Pair contracts emit zero `swap` events), **Protocol 23 CAP-0067** unified events, and **AstroGate v4.5** curve events for persistent OHLCV candles and live whale feeds.
5. **Exclusive Astro Ecosystem Interoperability (Zero Local Keys in AstroDex):**
   - **AstroWallet (`@AstroWalletAppBot`) — Exclusive `AstroID` SSO Login & Signing Hub:** `AstroDex` custodies **zero** private keys and **zero** seed phrases. Users log in automatically via `AstroWallet` (`AstroID` SSO). Every transaction is pre-scanned via `Scan & Shield` (`simulateTransaction` + `balanceDiffs`), packed into a bit-exact 4-field **HMAC-Signed Intent (`<= 5 min` TTL)** (`CrossAppIntentEnvelope v1`), and sent via Telegram deep link (`https://t.me/AstroWalletAppBot/wallet?startapp=i-...`) or **Web Express Sign Popup** (`expressWebUrl` + `openExpressSignFlow` listening for origin-checked `ASTRO_SIGN_COMPLETE`) for PIN/Biometric authorization and automatic return.
   - *(Note: AstroGate/Sorobits UI and bot commands were removed from active surfaces; server-side bonding-curve quoting remains dormant for the future NFT/launchpad phase.)*
6. **Telegram Super-Bot & AI Agent Ready:**
   - `@AstroDexBot` (100% English, 11 commands) delivers `/start`, `/stats`, `/help`, `/scan`, `/list`, `/chart`, `/book`, `/route`, `/whales`, `/usde` (live Ethena `USDe`/`sUSDe`/`USDT0` Mainnet pulse), `/alerts`, and **Inline Mode** (`@AstroDexBot <ticker|G...|C...>`) rich security & price cards in any group chat.
   - TMA (`apps/tma`) ships a CoinGecko-style **Markets + Watchlist** bottom dock feeding a unified **Token Detail Hub** (`RadarView`, `Watchlist`, `TradeChartView`, `BookPoolsView`, `ScannerView`).
   - Built-in **MCP Server (`/mcp`)**, `/openapi.json`, `/llms.txt`, and `x402` nonces (`0004_indexes_and_x402_nonces.sql`) for `/v1/agent/forensic-alpha/:assetId`.
   - **API Notes:** `POST /v1/quote` accepts `amount` in **human units** (e.g. `"10"`, not stroops). `GET /v1/scanner/:assetId` returns `{ ok, network, audit: { ... }, resolvedFrom }`.

---

## Official Astro Ecosystem Brand Palette

| Color | Role | HEX | RGB |
| :--- | :--- | :--- | :--- |
| **Solar Blaze** *(Orange)* | Primary CTAs (`Swap`, `Place Limit`, `Trade`), ask coral highlights | `#F15A24` | `rgb(241, 90, 36)` |
| **Stellar Gold** *(Gold)* | Verified seals, Astro Shield scores, Jackpot highlights *(with dark ink `#101D47`)* | `#F5C928` | `rgb(245, 201, 40)` |
| **Cosmic Purple** *(Purple)* | Soroban (`C...`) indicators, smart routes, Pro Scanner accents | `#8050C8` | `rgb(128, 80, 200)` |
| **Nebula Lavender** *(Light Violet)* | Glass `1px` specular rims, focus rings, secondary tags | `#A58BE0` | `rgb(165, 139, 224)` |
| **Deep Space Navy** *(Dark Blue)* | Root canvas anchor, Classic (`G...`) depth, high-contrast surfaces | `#172C69` | `rgb(23, 44, 105)` |

---

## Ecosystem Architecture Snapshot

- **6 Hexagonal Packages:** `@astrodex/domain`, `@astrodex/stellar-scanner`, `@astrodex/dex-aggregator`, `@astrodex/oracles-and-charts`, `@astrodex/security-shield`, `@astrodex/tg-protocol`.
- **2 Unified Apps:** `apps/tma` (Telegram-Exclusive Apple Liquid Glass Mini App) and `apps/server` (Cloudflare Worker running Hono + `grammY` + D1 + KV + `DEX_INDEXER` Durable Object + MCP Server, fronted by Cloudflare Pages Functions Service Binding).
- **Zero Hardcoding:** Switching `STELLAR_NETWORK=testnet` $\leftrightarrow$ `mainnet` is 100% environment-driven via Zod schemas with an enforced Mainnet Friendbot hard-block.

---

## Documentation Map

- [`AGENTS.md`](AGENTS.md) — Engineering contract, 8 non-negotiable rules, hexagonal dependency DAG, and Definition of Done.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Consolidated hexagonal monorepo design, 5-way liquidity routing, forensic scanner pipeline, AstroWallet integration, and D1/DO indexer architecture.
- [`SECURITY.md`](SECURITY.md) — Trust boundaries, non-custodial delegation to AstroWallet, STRIDE mitigations, and vulnerability disclosure.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Local verification gates and contribution standards.
- [`docs/INDEX.md`](docs/INDEX.md) — Fast lookup table for targeted reading.
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — Apple Liquid Glass tokens, Progressive Disclosure (`Basic` $\leftrightarrow$ `Pro`), mobile GPU blur budgets, and anti-jitter slot specifications.
- [`docs/ENV_MATRIX.md`](docs/ENV_MATRIX.md) — Complete client (`VITE_*`) and server (Cloudflare env/bindings/secrets) Zod configuration matrix.
- [`docs/ECOSYSTEM_INTEGRATION.md`](docs/ECOSYSTEM_INTEGRATION.md) — Canonical protocol contract linking **AstroWallet (`AstroID`)** and **AstroDex**.
- [`docs/MAINNET_CUTOVER_RUNBOOK.md`](docs/MAINNET_CUTOVER_RUNBOOK.md) — Deterministic Mainnet cutover checklist, D1/KV provisioning, and 60s kill-switch runbook.
- [`docs/NEXT_SESSION_HANDOFF.md`](docs/NEXT_SESSION_HANDOFF.md) — Current deployed Testnet state, verified IDs, and Gate 2 Mainnet priorities.
