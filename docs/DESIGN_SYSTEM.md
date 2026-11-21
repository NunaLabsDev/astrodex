# AstroDex — Design System & Visual Identity ("Apple Liquid Glass × Progressive Pro Terminal")

> **Scope:** UI/UX architecture, color tokens, Apple Liquid Glass elevation system, mobile GPU budgets, anti-jitter reserved slots, and Progressive Disclosure (`⚡ Basic Mode` $\leftrightarrow$ `🔬 Pro Scanner Mode`) inside Telegram Mini App (`apps/tma`).

---

## 1. Visual Philosophy & Ergonomic Pillars

1. **Unified Astro Ecosystem Identity:** Shares the **Apple Liquid Glass** visual language and 5-color cosmic banking palette of **AstroWallet** (`#F15A24`, `#F5C928`, `#8050C8`, `#A58BE0`, `#172C69`) so switching between **AstroWallet**, **AstroGate**, and **AstroDex** inside Telegram feels like one cohesive super-app.
2. **Progressive Disclosure Without Clutter (`375pt` Mobile First):**
   - A single persistent header pill toggles between **`⚡ Basic`** (intuitive swap, plain-English safety shield, line/area price chart, AstroGate curve progress) and **`🔬 Pro Scanner`** (TradingView Lightweight OHLCV candlesticks, Combined Depth Chart, live SDEX Orderbook + Limit Orders, Issuer Lock proof, Top-10 Holders, Protocol 23 TTL gauge, Raw XDR inspector).
3. **Zero Layout Jitter & Financial Legibility:**
   - All numeric values (prices, spreads, orderbook amounts, stroop balances, slippage) use `font-variant-numeric: tabular-nums`.
   - Async panels (charts, live quotes, orderbook rows, scanner matrix) render inside fixed/min-height reserved containers (`.ad-chart-stage`, `.ad-orderbook-stage`, `.ad-quote-slot`, `.ad-scanner-matrix`) with `scrollbar-gutter: stable` and `minmax(0, 1fr)` grid containment so mobile WebViews never jump while streaming updates.
4. **One-Handed Thumb Reach & Telegram SDK Native Polish:**
   - Minimum `44×44pt` touch targets, bottom floating `glass-dock`, swipeable `glass-sheet` drawers for trade review, native `BackButton` stack navigation, `HapticFeedback` on route selection/trade handoff/warnings, `ClosingConfirmation` during active order drafts, and `--tg-safe-area-inset-*` + `--tg-viewport-stable-height` padding.

---

## 2. Official 5-Color Brand Palette & Trading Semantic Tokens

```css
:root {
  /* Official 5-Color Astro Ecosystem Core */
  --ad-solar-blaze: #F15A24;       /* Primary CTAs (Swap, Place Order), Sell/Ask coral accents */
  --ad-stellar-gold: #F5C928;      /* Verified seals, Astro Shield 80-100 badges, Jackpot milestones */
  --ad-cosmic-purple: #8050C8;     /* Soroban (C...) badges, Pro Scanner mode, Smart Route accents */
  --ad-nebula-lavender: #A58BE0;   /* 1px specular glass rims, focus rings, secondary tags */
  --ad-deep-space-navy: #172C69;   /* Primary atmospheric backdrop & Classic (G...) anchor */

  /* OLED Contrast & Ink Guardrails (60/30/10 Rule) */
  --ad-space-void: #0B1433;        /* Deepened #172C69 canvas */
  --ad-ink-primary: #F8FAFF;       /* Primary text on dark glass */
  --ad-ink-secondary: #C8CBE8;     /* Muted labels & timestamps */
  --ad-ink-on-gold: #101D47;       /* Mandatory dark ink on #F5C928 (>= 7:1 contrast; never white) */
  --ad-ink-on-orange: #FFFFFF;     /* Bold >=16px CTA ink on #F15A24 */

  /* Market & Forensic Semantics */
  --ad-bid-emerald: #10B981;       /* SDEX Bids, positive 24h delta, Safe Shield verdict */
  --ad-ask-coral: #F15A24;         /* SDEX Asks, sell side, price impact warning */
  --ad-danger-crimson: #EF4444;    /* Spoofed ticker block, unlocked LP, clawback/freeze danger */
  --ad-warn-amber: #F5C928;        /* Unverified token, moderate whale concentration, low TTL */

  /* Signature Ambient Gradients (Zero Blur Cost) */
  --ad-grad-aurora: linear-gradient(135deg, #F15A24 0%, #8050C8 55%, #172C69 100%);
  --ad-grad-orb-glow: radial-gradient(circle at 18% 12%, rgba(241, 90, 36, 0.24), transparent 44%),
                      radial-gradient(circle at 86% 22%, rgba(128, 80, 200, 0.30), transparent 50%),
                      radial-gradient(circle at 50% 92%, rgba(165, 139, 224, 0.14), transparent 55%);
}
```

### 60/30/10 Distribution Rules
- **60% Sovereign Banking Navy (`#0B1433` / `#172C69`):** Anchors canvas backdrops, charts, and orderbooks so rapid market data remains calm and readable.
- **30% Frosted Glass & Royal Amethyst (`#8050C8` / `#A58BE0`):** Frames Soroban contracts (`C...`), the Pro Scanner matrix, and 5-way routing chips.
- **10% Stellar Gold (`#F5C928`) & Solar Blaze (`#F15A24`):** Gold is reserved for **Astro Shield** verified badges and **AstroGate** Jackpot tiers (always paired with `#101D47` ink); Orange is reserved for primary trade triggers (`Sign in AstroWallet`, `Execute Swap`, `Place Limit`).

---

## 3. Apple Liquid Glass Elevation & Mobile GPU Budget

| Elevation Token | Use Case | Backdrop Blur | Surface Fill | Specular Rim |
| :--- | :--- | :--- | :--- | :--- |
| **`glass-canvas`** | Root viewport (`100dvh`) | `none` | `#0B1433` + `--ad-grad-orb-glow` | Zero blur cost |
| **`glass-card`** | Token summary, OHLCV container, scanner section, orderbook card | `blur(16px) saturate(160%)` | `rgba(23, 44, 105, 0.48)` | `1px solid rgba(165, 139, 224, 0.24)` + `inset 0 1px 0 rgba(255,255,255,0.22)` |
| **`glass-sheet`** | Pre-sign **Scan & Shield** trade confirmation drawer, token selector | `blur(24px) saturate(180%)` | `rgba(14, 26, 68, 0.80)` | `1px solid rgba(165, 139, 224, 0.34)` |
| **`glass-pill`** | `[Basic | Pro]` toggle, `TESTNET` badge, `G...`/`C...` account pill, venue tags | `blur(10px) saturate(140%)` | `rgba(128, 80, 200, 0.22)` | `1px solid rgba(165, 139, 224, 0.32)` |
| **`glass-dock`** | Floating 5-tab bottom bar (`Radar`, `Trade`, `Scanner`, `Book`, `Orders`) | `blur(20px) saturate(175%)` | `rgba(18, 34, 86, 0.74)` | `1px solid rgba(255, 255, 255, 0.18)` |

### Mandatory Mobile WebView Guardrails
1. **Strict 2–3 Blur Cap:** Never stack more than 3 active `backdrop-filter` layers inside the viewport. Dense scrollable rows (orderbook levels, whale tape, holder rows) use crisp solid/alpha fills inside a single parent `glass-card`.
2. **Accessibility Media Queries:** Honor `@media (prefers-reduced-transparency: reduce)` (disable `backdrop-filter`, fallback to `rgba(16, 29, 71, 0.96)`) and `@media (prefers-reduced-motion: reduce)`.
3. **Reserved Anti-Jitter Geometry:**
   - `.ad-chart-stage`: `min-height: 248px` (Basic area chart) / `min-height: 310px` (Pro OHLCV + Volume).
   - `.ad-orderbook-stage`: `min-height: 280px` (fixed 8 asks + spread bar + 8 bids).
   - `.ad-quote-slot`: `min-height: 92px` (prevents trade button jumping during 380ms debounced 5-way quoting).
4. **Input Font Size:** All numeric/search inputs enforce `font-size >= 16px` to prevent automatic iOS WKWebView viewport zoom inside Telegram.

---

## 4. Progressive Disclosure Matrix (`Basic` $\leftrightarrow$ `Pro Scanner`)

| Surface | ⚡ Basic Mode | 🔬 Pro Scanner Mode |
| :--- | :--- | :--- |
| **Chart Stage** | Smoothed area chart (`24H / 7D / 30D`), USD/XLM price, 24h `%` badge | `lightweight-charts` OHLCV candlesticks (`1m`–`1D`), volume bars, `XLM`/`USD` quote switch, + **Depth Chart** tab |
| **Trade Panel** | 1-Tap Swap (`25% / 50% / MAX`), best route auto-selected, clear auto-trustline notice | Tabs: **Smart Swap** (5-way route comparison table, custom slippage) + **SDEX Limit Order** (`Buy` / `Sell` price & amount) |
| **Security Scanner** | **Astro Shield Score (0–100)** + 3 plain-English checks (Freeze?, Mint?, Official?) | Full Classic flags + Issuer Lock math (`master_weight` + signer sum), SEP-1/42/55, Protocol 23 TTL bar + 1-Tap Extend, Top-10 Holders |
| **Liquidity & Tape** | Single summary pill (`Total Liquidity` + `LP Locked 7Y / Burned`) | Live **SDEX Orderbook** + Multi-Venue Pool Reserves + Live **Whale & Trade Tape** |
| **AstroGate Section** | Simple Graduation Progress Bar (`%` to `1,000 XLM`) | Full Jackpot Ladder (`250 / 500 / 1,000 XLM`), Buyback Reserve + Cooldown Timer + `Trigger Buyback` CTA, Burn-to-Chat Feed |
