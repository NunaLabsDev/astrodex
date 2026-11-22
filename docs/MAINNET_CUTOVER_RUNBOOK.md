# AstroDex — Mainnet Hot-Swap & Operations Runbook

> **Scope:** Authoritative step-by-step protocol for switching AstroDex between Read-Only Visualizer, Testnet Execution, and Full Stellar Mainnet Production without touching application code, plus emergency Kill-Switch response.

---

## 1. Environment-Driven Hot-Swap Flags (`@astrodex/domain`)

All network and execution boundaries are enforced at startup by Zod (`parseTmaConfig` & `parseServerConfig` in `packages/domain/src/config.ts`):

| Layer | Variable | Purpose |
| :--- | :--- | :--- |
| **Worker (`apps/server`)** | `EXECUTION_ENABLED` | Master backend Kill-Switch (`"true"` / `"false"`). When `"false"`, `POST /v1/intents` immediately rejects with `403`. |
| **Worker (`apps/server`)** | `STELLAR_NETWORK` | Active signing & persistence network (`"testnet"` or `"mainnet"`). Rejects `body.network !== config.network` (`409`). |
| **TMA (`apps/tma`)** | `VITE_DEFAULT_FEED_NETWORK` | Initial visualizer network on load (`"mainnet"` or `"testnet"`). |
| **TMA (`apps/tma`)** | `VITE_EXECUTION_ENABLED` | Controls interactive signing controls (`Sign Swap`, `Place Limit Order`, `Cancel`, `Extend TTL`). |

---

## 2. Verified Mainnet Infrastructure IDs

| Service / Contract | Stellar Mainnet Address (`Public Global Stellar Network ; September 2015`) |
| :--- | :--- |
| **Soroban RPC Pool** | `https://mainnet.sorobanrpc.com,https://rpc.lightsail.network` |
| **Horizon API** | `https://horizon.stellar.org` |
| **Native XLM SAC** | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |
| **Soroswap Factory** | `CA4HEQTL2WPEUYKYKCDOHCDNIV4QHNJ7EL4J4NQ6VADP7SYHVRYZ7AW2` |
| **Soroswap Router** | `CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH` |
| **Reflector SEP-40 DEX Oracle** | `CALI2BYU2JE6WVRUFYTS6MSBNEHGJ35P4AVCZYF3B6QOE3QKOB2PLE6M` |
| **Chainlink Price Proxy** | `CDQBHEUGLDHMSUHG4IH33RJBUTMNCZOT4JIAQR4WZFRDZW6DR6S32ZLZ` |
| **SEP-42 Asset List** | `https://api.stellar.expert/explorer/public/asset-list/top50` |

---

## 3. Provisioning Isolated Mainnet Cloudflare Resources (< 5 Minutes)

1. **Create Mainnet D1 Database & Apply Schema Migrations:**
   ```bash
   wrangler d1 create astrodex-mainnet
   # Update database_id inside apps/server/wrangler.toml [env.mainnet.d1_databases]
   wrangler d1 migrations apply astrodex-mainnet --remote
   ```
2. **Create Mainnet KV Namespace:**
   ```bash
   wrangler kv namespace create CACHE --env mainnet
   # Update id inside apps/server/wrangler.toml [env.mainnet.kv_namespaces]
   ```
3. **Provision Independent Mainnet Secrets (Never Reuse Testnet Secrets):**
   ```bash
   wrangler secret put TG_BOT_TOKEN --env mainnet
   wrangler secret put TG_WEBHOOK_SECRET --env mainnet
   wrangler secret put INTENT_HMAC_SECRET --env mainnet
   wrangler secret put ECOSYSTEM_SHARED_INTENT_SECRET --env mainnet
   ```
4. **Verify Zod Mainnet Safety Gates:**
   - Ensure `FRIENDBOT_URL` and `VITE_FRIENDBOT_URL` are unset.
   - Ensure `VITE_ALLOW_DEV_OUTSIDE_TELEGRAM="false"`.
   - Confirm `pnpm check` passes before deploy.

5. **Deploy Mainnet Worker & Pages:**
   ```bash
   cd apps/server && npx wrangler deploy --env mainnet
   cd ../tma && VITE_STELLAR_NETWORK=mainnet \
     VITE_STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" \
     VITE_STELLAR_RPC_URLS="https://mainnet.sorobanrpc.com,https://rpc.lightsail.network" \
     VITE_HORIZON_URLS="https://horizon.stellar.org" \
     VITE_DEFAULT_FEED_NETWORK=mainnet \
     VITE_EXECUTION_ENABLED=true \
     VITE_ALLOW_DEV_OUTSIDE_TELEGRAM=false \
     pnpm build && npx wrangler pages deploy dist --project-name=astrodex --branch=main
   ```

---

## 4. Emergency 60-Second Kill-Switch & Incident Response

If an anomalous RPC feed, compromised upstream aggregator, or Soroban contract vulnerability is detected:

1. **Disable Signing Immediately on Worker:**
   Set `EXECUTION_ENABLED = "false"` in Cloudflare Worker Environment Variables (or `wrangler.toml` `[env.mainnet.vars]` + `wrangler deploy --env mainnet`). `POST /v1/intents` immediately returns `403`.
2. **Revert Frontend to Read-Only Visualizer:**
   Set `VITE_EXECUTION_ENABLED=false` and redeploy `apps/tma` Pages.
3. **Preserve Forensic Evidence:**
   Inspect `GET /v1/dex/status` and Cloudflare Worker logs (`wrangler tail --env mainnet`), and keep `DexIndexerDO` / D1 `signed_intents` audit rows intact.
