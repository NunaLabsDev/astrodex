---
trigger: glob
globs: "packages/**, apps/**, tsconfig*.json, eslint*"
---

# AstroDex Hexagonal Package Dependency Matrix

Enforce this DAG in `eslint.config.mjs` (`no-restricted-imports`) and `tsconfig.base.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`):

| Package / App | May Import From | Strictly Forbidden From Importing |
| :--- | :--- | :--- |
| **`@astrodex/domain`** | `zod` only (pure TS types, ports, schemas) | `@stellar/*`, DOM/Window/IndexedDB, React, `grammy`, `hono`, Cloudflare APIs, `@astrodex/*`, `@noble/*` |
| **`@astrodex/stellar-scanner`** | `@astrodex/domain`, `@stellar/stellar-sdk` | React, DOM UI components, `grammy`, `hono`, peer `@astrodex/*` packages, `cloudflare:*` |
| **`@astrodex/dex-aggregator`** | `@astrodex/domain`, `@stellar/stellar-sdk`, `@soroswap/sdk` | React, DOM UI components, `grammy`, `hono`, peer `@astrodex/*` packages, `cloudflare:*`, `sk_*` API keys |
| **`@astrodex/oracles-and-charts`** | `@astrodex/domain`, `@stellar/stellar-sdk` | React, DOM UI components, `grammy`, `hono`, peer `@astrodex/*` packages, `cloudflare:*` |
| **`@astrodex/security-shield`** | `@astrodex/domain`, `@stellar/stellar-sdk` (lazy worker `@stellar/stellar-xdr-json`) | React, `grammy`, `hono`, peer `@astrodex/*` packages, Cloudflare bindings directly (use injected fetcher port) |
| **`@astrodex/tg-protocol`** | `@astrodex/domain`, Web Crypto / `@noble/ed25519` | React, IndexedDB, DOM APIs, `grammy`, `hono`, peer `@astrodex/*` packages, `cloudflare:*` |
| **`apps/tma`** | All `@astrodex/*` client packages (NEVER `sk_*` server secrets) | `grammy`, `hono`, `cloudflare:*`, Cloudflare D1/KV, server signing secrets, private key custody libs |
| **`apps/server`** | `@astrodex/domain`, `@astrodex/stellar-scanner`, `@astrodex/dex-aggregator`, `@astrodex/oracles-and-charts`, `@astrodex/security-shield`, `@astrodex/tg-protocol`, `hono`, `grammy` | React, DOM/IndexedDB, user private keys or mnemonic/vault storage |

## Additional TS & Bundle Guardrails
- Keep `@stellar/stellar-xdr-json` (~3 MB WASM) excluded from initial `apps/tma` chunks; load it strictly on-demand inside a Web Worker (`inspectRawXdrInWorker`).
- Verify boundaries after edits with `pnpm --filter "./packages/*" build && pnpm -r typecheck && pnpm -r lint`.
