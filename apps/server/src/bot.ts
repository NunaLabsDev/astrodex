import { createSmartLiquidityRouter, fetchHorizonOrderbook } from "@astrodex/dex-aggregator";
import type { ServerConfig } from "@astrodex/domain";
import { createStellarForensicScanner } from "@astrodex/stellar-scanner";
import {
  buildAstroDexDeepLink,
  formatOrderbookCard,
  formatQuoteCard,
  formatScanCard,
  formatWhaleAlertCard,
} from "@astrodex/tg-protocol";
import { Bot } from "grammy";
import type { DexServerRepository } from "./db/repository.js";
import { adaptFetch, type FetchLike } from "./stellar-verifier.js";

export function createAstroDexBot(
  config: ServerConfig,
  repo: DexServerRepository,
  deps: { fetchFn?: FetchLike | undefined } = {},
): Bot {
  const fetchFn = adaptFetch(deps.fetchFn ?? fetch);
  const bot = new Bot(config.tgBotToken, {
    client: {
      ...(config.telegramApiOrigin ? { apiRoot: config.telegramApiOrigin } : {}),
    },
  });

  bot.catch((err) => {
    console.error("[AstroDexBot] Handler error:", err.error);
  });

  const scanner = createStellarForensicScanner({
    network: config.network,
    networkPassphrase: config.networkPassphrase,
    rpcUrls: config.rpcUrls,
    horizonUrls: config.horizonUrls,
    sep42AssetListUrls: config.sep42AssetListUrls,
    stellarExpertApiBase: config.stellarExpertApiBase,
    astroGateApiBaseUrl: config.astroGateApiBaseUrl,
    fetchFn,
  });

  const routerEngine = createSmartLiquidityRouter({
    horizonUrls: config.horizonUrls,
    xoxnoApiBase: config.xoxnoSwapApiBase,
    fetchFn,
  });

  const openAppUrl = buildAstroDexDeepLink({
    tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
    tgMiniAppShortName: config.tgMiniAppShortName,
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "<b>AstroDex — Stellar Classic SDEX + Soroban Terminal</b>",
        "100% non-custodial inside Telegram. Identity & signing powered exclusively by <b>AstroWallet (AstroID)</b>.",
        "",
        "• <code>/scan &lt;asset&gt;</code> — Forensic Astro Shield audit (0–100)",
        "• <code>/book &lt;base&gt; &lt;quote&gt;</code> — Live Classic SDEX orderbook",
        "• <code>/route &lt;amount&gt; &lt;from&gt; &lt;to&gt;</code> — 5-Way Smart Router quote",
        "• <code>/whales</code> — Live whale tape",
        "• <code>/jackpot</code> — AstroGate v4.5 Jackpot Radar",
        "• <code>/alerts</code> — Your active watchlist & price alerts",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "Open AstroDex Terminal", url: openAppUrl }]],
        },
      },
    );
  });

  bot.command("scan", async (ctx) => {
    const arg = ctx.match.trim();
    if (!arg) {
      await ctx.reply("Usage: <code>/scan XLM</code> or <code>/scan CODE:G...</code> or <code>/scan C...</code>", {
        parse_mode: "HTML",
      });
      return;
    }
    const audit = await scanner.auditToken(arg);
    const deepLink = buildAstroDexDeepLink({
      tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
      tgMiniAppShortName: config.tgMiniAppShortName,
      startParam: `scan_${audit.assetKey}`,
    });
    await ctx.reply(formatScanCard(audit), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Inspect X-Ray Matrix", url: deepLink }]],
      },
    });
  });

  bot.command("chart", async (ctx) => {
    const arg = ctx.match.trim() || "XLM";
    const deepLink = buildAstroDexDeepLink({
      tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
      tgMiniAppShortName: config.tgMiniAppShortName,
      startParam: `token_${arg}`,
    });
    await ctx.reply(`Open live OHLCV & Depth chart for <code>${arg}</code>:`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Open Pro Chart", url: deepLink }]],
      },
    });
  });

  bot.command("book", async (ctx) => {
    const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
    const baseAsset = parts[0] ?? "XLM";
    const quoteAsset = parts[1] ?? "XLM";
    const book = await fetchHorizonOrderbook(config.horizonUrls, baseAsset, quoteAsset, 10, fetchFn);
    await ctx.reply(formatOrderbookCard(book), { parse_mode: "HTML" });
  });

  bot.command("route", async (ctx) => {
    const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
      await ctx.reply("Usage: <code>/route 100 XLM C...</code>", { parse_mode: "HTML" });
      return;
    }
    const [amount = "10", fromAsset = "XLM", toAsset = ""] = parts;
    const quote = await routerEngine.quoteBestRoutes({
      fromAsset,
      toAsset,
      amount,
      slippageBps: 50,
      accountKind: "classic",
    });
    await ctx.reply(formatQuoteCard(quote), { parse_mode: "HTML" });
  });

  bot.command("whales", async (ctx) => {
    const whales = await repo.listWhaleTrades(5);
    if (whales.length === 0) {
      await ctx.reply("No recent whale trades indexed yet. Open AstroDex Radar for live pairs.", {
        reply_markup: { inline_keyboard: [[{ text: "Open Whale Radar", url: openAppUrl }]] },
      });
      return;
    }
    await ctx.reply(whales.map(formatWhaleAlertCard).join("\n\n"), { parse_mode: "HTML" });
  });

  bot.command("jackpot", async (ctx) => {
    await ctx.reply(
      "Track live AstroGate v4.5 250 / 500 / 1,000 XLM checkpoints and 2% keeper buyback bounties inside AstroDex.",
      {
        reply_markup: {
          inline_keyboard: [[{ text: "Open Jackpot Radar", url: openAppUrl }]],
        },
      },
    );
  });

  bot.command("alerts", async (ctx) => {
    const tgId = ctx.from?.id ? String(ctx.from.id) : "";
    const alerts = tgId ? await repo.listPriceAlerts(tgId) : [];
    await ctx.reply(
      alerts.length === 0
        ? "You have no active price alerts. Configure alerts inside the AstroDex Mini App."
        : `You have ${alerts.length} active price alert(s).`,
      {
        reply_markup: { inline_keyboard: [[{ text: "Manage Alerts", url: openAppUrl }]] },
      },
    );
  });

  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim() || "XLM";
    let cardText = `<b>AstroDex Market Card — ${query}</b>\nTap below to open Pro Chart & Forensic X-Ray.`;
    try {
      const audit = await scanner.auditToken(query);
      cardText = formatScanCard(audit);
    } catch {
      // Fallback safely when free-text ticker is searched inline
    }
    await ctx.answerInlineQuery(
      [
        {
          type: "article",
          id: `scan-${query.slice(0, 32)}`,
          title: `AstroDex Scan & Trade: ${query}`,
          description: "Share live Astro Shield score & trade deep link",
          input_message_content: {
            message_text: cardText,
            parse_mode: "HTML",
          },
          reply_markup: {
            inline_keyboard: [[{ text: "Trade & Inspect in AstroDex", url: openAppUrl }]],
          },
        },
      ],
      { cache_time: 15, is_personal: false },
    );
  });

  return bot;
}
