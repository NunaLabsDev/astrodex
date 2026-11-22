# Contributing to AstroDex

Thank you for contributing to **AstroDex**! Before writing code or opening a pull request, read:
1. [`README.md`](README.md)
2. [`AGENTS.md`](AGENTS.md)
3. [`ARCHITECTURE.md`](ARCHITECTURE.md)
4. [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md)
5. [`docs/ECOSYSTEM_INTEGRATION.md`](docs/ECOSYSTEM_INTEGRATION.md)

## Required Local Verification Suite
Every PR must pass all checks after the final edit (`pnpm check` runs the full suite below):

```bash
pnpm install
pnpm check
# Or individually:
pnpm --filter "./packages/*" build
pnpm -r typecheck
pnpm -r lint
pnpm test
pnpm secret-scan
pnpm --filter @astrodex/tma build
```

## Engineering Non-Negotiables
- **100% English Only:** Code, docs, UI labels, scanner explanations, and `@AstroDexBot` messages must strictly use English.
- **Zero Hardcoding:** Every URL, network passphrase, contract ID, oracle address, and bot username must come from Zod-validated config in `@astrodex/domain`.
- **Zero Fake Runtime Mocks:** Runtime paths must query real Stellar Testnet/Mainnet infrastructure; mocks belong exclusively inside `*.test.ts`.
- **AstroWallet Signing Only:** Never add local mnemonic generation, `S...` import, or in-app raw private key signing to `AstroDex`. Route all signing intents to `@AstroWalletAppBot`.
- **Hexagonal Boundaries:** Respect the package dependency DAG enforced by `eslint.config.mjs`.
