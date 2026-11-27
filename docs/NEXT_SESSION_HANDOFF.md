# AstroDex — Operations & Next Session Handoff

> **Live State (`2ee91f0`, 2026-11-26):** Deployed on Cloudflare Testnet (`astrodex-server`, Pages `https://astrodex-testnet.pages.dev`) + `@AstroDexBot` (`11` commands + inline mode). TMA defaults to Mainnet market data (`feedNetwork = "mainnet"`) with CoinGecko-style **Markets + Watchlist** dock and unified **TokenDetail** hub. Gate 2 (`astrodex-server-mainnet`) remains pending `[env.mainnet]` D1/KV provisioning.

---

## 1. Live Infrastructure & Verified Reference IDs

| Component | Identifier | Notes |
| :--- | :--- | :--- |
| **GitHub Repo** | `NunaLabsDev/astrodex` (`main` branch) | Independent repo |
| **Cloudflare Pages** | `https://astrodex-testnet.pages.dev` | Project `astrodex-testnet` |
| **Testnet Worker** | `astrodex-server` (`workers_dev = false`) | D1 `astrodex` (`4f7684e0-86dd-4696-b725-d7b109f4dd67`, `0001..0004`) · KV `d086ce01143b472d920ec36ccc906668` · DO `DexIndexerDO` |
| **Service Binding** | `ASTROWALLET` → `astro-wallet-server` | `ASTROGATE` binding removed (dormant curve code remains server-side) |
| **Telegram Bot** | `@AstroDexBot` (`dex`) | `/start`, `/stats`, `/help`, `/scan`, `/list`, `/chart`, `/book`, `/route`, `/whales`, `/usde`, `/alerts` |
| **AstroWallet Hub** | `@AstroWalletAppBot` (`https://astro-wallet.pages.dev`) | Exclusive `AstroID` SSO + Clear-Sign + Express Sign popup (`ASTRO_SIGN_COMPLETE`) |
| **AstroWallet ClaimEscrow (Testnet)** | `CCWVGVBSHAFS73HCDRJ5MEFJPYKKG4WQFJ2LJPNIO2PU3U4X6PTDA4TA` | Reference only |
| **Mainnet Oracles (`wrangler.toml`)** | RedStone `CBMGLK...WYR F` · Chainlink `CDQBHE...32ZLZ` · Reflector `CALI2B...PLE6M` | `XOXNO_SWAP_API_BASE = https://stellar-swap.xoxno.com` |
| **Mainnet Soroswap (`wrangler.toml`)** | Factory `CA4HEQTL2WPEUYKYKCDOHCDNIV4QHNJ7EL4J4NQ6VADP7SYHVRYZ7AW2` · Router `CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH` | `XLM_SAC = CAS3J7...OWMA` |

---

## 2. Shipped Capabilities (`2ee91f0`)

- **CoinGecko-Style Markets + Watchlist + TokenDetail (`apps/tma`):** Clean `Markets` & `Watchlist` bottom dock (`$ USD | ✦ XLM`, `All / Gainers / Losers / Vol`), live autocomplete search, and unified `TokenDetail` hub (OHLCV charts, Aquarius/Soroswap/SDEX liquidity depth, orderbooks, top holders, Astro Shield `0–100` scanner, self-serve `+ List`).
- **5-Way Smart Router & Express Sign:** Quotes across Soroswap, XOXNO (`envelopeXdr` extraction + simulation fallback), Aquarius, direct pools, and Horizon SDEX; `POST /v1/intents` hands off HMAC-signed envelopes to AstroWallet Telegram or `expressWebUrl` popup.
- **Hardened Server & Indexer:** D1 `0001..0004` (incl. `x402` nonces), `DEX_INDEXER` DO, `x402` forensic alpha (`/v1/agent/forensic-alpha/:assetId`), `/mcp`, `/openapi.json`, `/llms.txt`.

---

## 3. Quick Resume Commands & Gate 2 Mainnet Next Steps

```bash
pnpm --filter "./packages/*" build && pnpm -r typecheck && pnpm -r lint && pnpm test && pnpm secret-scan && pnpm --filter @astrodex/tma build
astro-docs lint
```

1. **Gate 2 (`[env.mainnet]` Provisioning):** Replace `REPLACE_WITH_MAINNET_D1_ID` and `REPLACE_WITH_MAINNET_KV_ID` in `apps/server/wrangler.toml`, apply D1 migrations `0001..0004` remotely, set Mainnet secrets, and deploy `astrodex-server-mainnet` in 48h shadow mode (`EXECUTION_ENABLED = "false"`) before enabling execution (see [`MAINNET_CUTOVER_RUNBOOK.md`](MAINNET_CUTOVER_RUNBOOK.md)).
2. **Service Binding Activation:** Once `astrodex-server-mainnet` is live, re-enable `[[env.mainnet.services]]` (`ASTRODEX`) in `astrowallet/apps/server/wrangler.toml`.
3. **Real Mainnet Swap QA:** Verify live Express Sign popup + SDEX Limit Order cancel + Soroswap smart route with small capital.
