import type {
  MultiVenueQuoteResult,
  OrderbookSnapshot,
  TokenForensicAudit,
  WhaleTrade,
} from "@astrodex/domain";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Formats a 100% English Telegram HTML forensic scan summary card.
 */
export function formatScanCard(audit: TokenForensicAudit): string {
  const verdictBadge =
    audit.verdict === "safe"
      ? "🟢 SAFE"
      : audit.verdict === "warning"
        ? "🟡 CAUTION"
        : "🔴 BLOCKED / HIGH RISK";
  const topFindings = audit.findings
    .slice(0, 3)
    .map((f) => `• <b>${escapeHtml(f.title)}:</b> ${escapeHtml(f.description)}`)
    .join("\n");

  return [
    `<b>AstroDex X-Ray Scan — ${escapeHtml(audit.code)}</b>`,
    `Verdict: <b>${verdictBadge}</b> · Shield Score: <b>${audit.astroShieldScore}/100</b>`,
    `Key: <code>${escapeHtml(audit.assetKey)}</code>`,
    topFindings || "• No critical anomalies detected.",
  ].join("\n");
}

/**
 * Formats a 100% English 5-Way Smart Router quote card.
 */
export function formatQuoteCard(quote: MultiVenueQuoteResult): string {
  if (quote.blockedReason) {
    return [
      `<b>AstroDex Route Blocked</b>`,
      `Pair: <code>${escapeHtml(quote.fromAsset)} → ${escapeHtml(quote.toAsset)}</code>`,
      `Reason: ${escapeHtml(quote.blockedReason)}`,
    ].join("\n");
  }
  if (!quote.bestRoute) {
    return [
      `<b>AstroDex Quote</b>`,
      `No active route found for <code>${escapeHtml(quote.inputAmount)} ${escapeHtml(quote.fromAsset)} → ${escapeHtml(quote.toAsset)}</code>.`,
    ].join("\n");
  }
  const best = quote.bestRoute;
  return [
    `<b>AstroDex Best Route (${escapeHtml(best.venue)})</b>`,
    `Sell: <code>${escapeHtml(best.inputAmount)} ${escapeHtml(best.fromAsset)}</code>`,
    `Receive (est.): <code>${escapeHtml(best.expectedOutputAmount)} ${escapeHtml(best.toAsset)}</code>`,
    `Min Received: <code>${escapeHtml(best.minOutputAmount)}</code> · Fee: <code>${best.feeBps} bps</code>`,
    `Account Mode: <b>${quote.accountKind === "smart" ? "Smart Account (C...)" : "Classic (G...)"}</b>`,
  ].join("\n");
}

/**
 * Formats a 100% English Classic SDEX orderbook top-of-book snapshot.
 */
export function formatOrderbookCard(book: OrderbookSnapshot): string {
  const asks = book.asks
    .slice(0, 4)
    .map((a) => `🔴 ${escapeHtml(a.price)} (${escapeHtml(a.amount)})`)
    .join("\n");
  const bids = book.bids
    .slice(0, 4)
    .map((b) => `🟢 ${escapeHtml(b.price)} (${escapeHtml(b.amount)})`)
    .join("\n");

  return [
    `<b>SDEX Orderbook — ${escapeHtml(book.baseAsset)} / ${escapeHtml(book.quoteAsset)}</b>`,
    `Spread: <code>${escapeHtml(book.spreadPct ?? "N/A")}%</code>`,
    asks ? `<b>Asks</b>\n${asks}` : "<i>No asks</i>",
    bids ? `<b>Bids</b>\n${bids}` : "<i>No bids</i>",
  ].join("\n");
}

/**
 * Formats a 100% English live whale trade alert card.
 */
export function formatWhaleAlertCard(trade: WhaleTrade): string {
  const emoji = trade.side === "buy" ? "🐋🟢 BUY" : "🐋🔴 SELL";
  return [
    `<b>${emoji} — ${escapeHtml(trade.baseSymbol)}</b>`,
    `Size: <code>${escapeHtml(trade.amountXlm)} XLM</code> (${escapeHtml(trade.amountBase)} ${escapeHtml(trade.baseSymbol)})`,
    `Trader: <code>${escapeHtml(trade.traderAddress.slice(0, 6))}…${escapeHtml(trade.traderAddress.slice(-6))}</code>`,
  ].join("\n");
}

/**
 * Formats a 100% English AstroGate v4.5 Jackpot Ladder status card.
 */
export function formatJackpotCard(input: {
  symbol: string;
  tokenId: string;
  currentXlm: number;
  remainingToNextXlm: number;
  nextCheckpointLabel: string;
  rewardTokens: number;
}): string {
  return [
    `<b>AstroGate v4.5 Jackpot Radar — $${escapeHtml(input.symbol)}</b>`,
    `Curve Progress: <b>${input.currentXlm.toFixed(1)} / 1,000 XLM</b>`,
    `Next Target: <b>${escapeHtml(input.nextCheckpointLabel)}</b> (+${input.rewardTokens.toLocaleString("en-US")} tokens in <b>${input.remainingToNextXlm.toFixed(2)} XLM</b>)`,
    `Token: <code>${escapeHtml(input.tokenId)}</code>`,
  ].join("\n");
}
