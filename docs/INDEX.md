# AstroDex — Documentation Index

> Check this index first and read **only** the document or section required for your current task. Never bulk-read `docs/` upfront.

| Document | Purpose | Status |
| :--- | :--- | :--- |
| [`AGENTS.md`](../AGENTS.md) | Engineering contract, 8 non-negotiable rules, hexagonal DAG, and Definition of Done | **Active** (`GEMINI.md` symlinked, `CLAUDE.md` linked) |
| [`README.md`](../README.md) | Product vision, 6 core pillars, 5-color brand palette, and repository overview | **Active** |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Hexagonal monorepo structure, 5-way router, forensic scanner, AstroWallet handoff, D1/DO indexer | **Active Specification** |
| [`PLAN.md`](../PLAN.md) | 6-Milestone vertical-slice execution roadmap + Phase 2 deferrals | **Milestones 1–6 Complete; Phase 2 Deferred** |
| [`SECURITY.md`](../SECURITY.md) | Trust boundaries, delegation to AstroWallet, STRIDE mitigations, and disclosure | **Active Policy** |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | PR quality gates and contributor checklist | **Active** |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Apple Liquid Glass tokens, `Basic ↔ Pro` Progressive Disclosure, GPU blur budgets, anti-jitter layout | **Active Design Spec** |
| [`ENV_MATRIX.md`](ENV_MATRIX.md) | Complete Zod environment matrix for `apps/tma` (`VITE_*`) and `apps/server` (Cloudflare env/secrets) | **Active Env Spec** |
| [`ECOSYSTEM_INTEGRATION.md`](ECOSYSTEM_INTEGRATION.md) | 3-Pillar Harmony contract: **AstroWallet (`AstroID` SSO & Signer)**, **AstroGate v4.5**, and **AstroDex** | **Active Integration Spec** |
| [`NEXT_SESSION_HANDOFF.md`](NEXT_SESSION_HANDOFF.md) | Completed Testnet verification summary, reference IDs & Cloudflare deployment checklist | **Testnet Ready — Deploy Guide** |

- Scoped Agent Rules (`.agents/rules/`): [`hexagonal-boundaries.md`](../.agents/rules/hexagonal-boundaries.md), [`signing-and-telegram.md`](../.agents/rules/signing-and-telegram.md), [`env-and-zod.md`](../.agents/rules/env-and-zod.md).
