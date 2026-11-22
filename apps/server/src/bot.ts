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
  const astroWalletUrl = `https://t.me/${config.astroWalletBotUsername ?? "AstroWalletAppBot"}/${config.astroWalletMiniAppShortName ?? "wallet"}`;
  const astroGateBot = config.astroGateBotUsername ?? "AstroGateSorobanBot";
  const astroGateHomeUrl = `https://t.me/${astroGateBot}/app`;

  bot.command("start", async (ctx) => {
    const caption = [
      "<b>AstroDex — Stellar Classic SDEX + Soroban Terminal</b>",
      "100% non-custodial inside Telegram. Identity &amp; signing powered exclusively by <b>AstroWallet (AstroID)</b>.",
      "",
      "• <code>/scan &lt;asset&gt;</code> — Forensic Astro Shield audit (0–100)",
      "• <code>/chart &lt;asset&gt;</code> — Live OHLCV &amp; depth chart",
      "• <code>/book &lt;base&gt; &lt;quote&gt;</code> — Live Classic SDEX orderbook",
      "• <code>/route &lt;amount&gt; &lt;from&gt; &lt;to&gt;</code> — 5-Way Smart Router quote",
      "• <code>/list &lt;asset&gt; [venue]</code> — Auto-scan &amp; list token/AMM",
      "• <code>/whales</code> · <code>/jackpot</code> · <code>/alerts</code> — Radar &amp; alerts",
    ].join("\n");
    const replyMarkup = {
      inline_keyboard: [
        [{ text: "⚡ Open AstroDex Terminal", url: openAppUrl }],
        [
          { text: "🛡️ Open AstroWallet", url: astroWalletUrl },
          { text: "🚀 Open AstroGate", url: astroGateHomeUrl },
        ],
        [
          { text: "💬 @AstroSoroban", url: "https://t.me/AstroSoroban" },
          { text: "📡 @AstroGateFeed", url: "https://t.me/AstroGateFeed" },
        ],
      ],
    };
    const bannerUrl = `${config.tmaOrigin.replace(/\/+$/, "")}/telegram/astrodex-bot-banner.png`;
    try {
      await ctx.replyWithPhoto(bannerUrl, {
        caption,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
    } catch {
      await ctx.reply(caption, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
    }
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
        inline_keyboard: [
          [
            { text: "📊 Inspect in AstroDex", url: deepLink },
            {
              text: "🚀 AstroGate Curve",
              url: `https://t.me/${astroGateBot}/app?startapp=${encodeURIComponent(audit.assetKey)}`,
            },
          ],
          [{ text: "🛡️ Sign in AstroWallet", url: astroWalletUrl }],
        ],
      },
    });
  });

  bot.command("list", async (ctx) => {
    const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
    const assetId = parts[0];
    if (!assetId) {
      await ctx.reply(
        "Usage: <code>/list CODE:G... [soroswap|aquarius|phoenix|sdex_pool]</code> or <code>/list C...</code>",
        { parse_mode: "HTML" },
      );
      return;
    }
    const rawVenue = parts[1]?.toLowerCase() ?? "soroswap";
    const allowedVenues = new Set(["soroswap", "aquarius", "phoenix", "sdex_pool", "astrogate_curve"]);
    const ammVenue = allowedVenues.has(rawVenue) ? rawVenue : "soroswap";

    try {
      const audit = await scanner.auditToken(assetId);
      if (audit.verdict === "malicious" || audit.trustTier === "spoof_blocked") {
        await ctx.reply(
          `<b>Listing Blocked by Astro Shield</b>\n<code>${audit.code}</code> was flagged as spoofed or malicious and cannot be listed.`,
          { parse_mode: "HTML" },
        );
        return;
      }

      const isClean =
        audit.astroShieldScore >= 75 && audit.verdict === "safe" && audit.findings.length === 0;
      const reviewStatus = isClean ? "verified" : "unreviewed_warning";
      const findingTitles = audit.findings.map((f) => f.title).join(", ");
      const reviewNote = isClean
        ? "Passed automated Astro Shield forensic check."
        : findingTitles
          ? `Community-listed (not yet reviewed): ${findingTitles}. Verify before trading.`
          : `Community-listed (not yet reviewed): Shield score ${audit.astroShieldScore}/100. Verify before trading.`;

      await repo.upsertToken({
        assetKey: audit.assetKey,
        kind: audit.kind,
        sacId: audit.sacContractId ?? audit.contractId,
        code: audit.code,
        name: audit.name,
        issuer: audit.issuer,
        decimals: audit.decimals,
        logoUrl: audit.logoUrl,
        shieldScore: audit.astroShieldScore,
        verifiedLaunchpad: Boolean(audit.sorobanAudit?.astroGate?.isLaunchpadToken),
        reviewStatus,
        reviewNote,
        ammVenue,
        updatedAt: Math.floor(Date.now() / 1000),
      });

      const tradeLink = buildAstroDexDeepLink({
        tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
        tgMiniAppShortName: config.tgMiniAppShortName,
        startParam: `token_${audit.assetKey}`,
      });
      const statusBadge = isClean
        ? "✅ <b>Verified &amp; Listed</b>"
        : "⚠️ <b>Listed with Unreviewed Warning</b>";

      await ctx.reply(
        `${statusBadge} (${ammVenue})\n${reviewNote}\n\n${formatScanCard(audit)}`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "⚡ Trade in AstroDex", url: tradeLink }]],
          },
        },
      );
    } catch (err) {
      await ctx.reply(
        `Could not list asset: ${err instanceof Error ? err.message : "Invalid Stellar asset ID"}`,
      );
    }
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
        inline_keyboard: [
          [
            { text: "📊 Open Pro Chart", url: deepLink },
            {
              text: "🚀 AstroGate Curve",
              url: `https://t.me/${astroGateBot}/app?startapp=${encodeURIComponent(arg)}`,
            },
          ],
          [{ text: "🛡️ Sign in AstroWallet", url: astroWalletUrl }],
        ],
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
          inline_keyboard: [
            [
              { text: "Open Jackpot Radar", url: openAppUrl },
              {
                text: "Open AstroGate Market",
                url: `https://t.me/${config.astroGateBotUsername ?? "AstroGateSorobanBot"}/app?startapp=market`,
              },
            ],
          ],
        },
      },
    );
  });

  bot.command("alerts", async (ctx) => {
    if (
      ctx.chat?.type !== "private" &&
      !(ctx.message?.text ?? "").toLowerCase().includes(`@${(ctx.me?.username ?? config.tgBotUsername ?? "AstroDexBot").toLowerCase()}`)
    ) {
      return;
    }
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
    let assetKey = query;
    try {
      const audit = await scanner.auditToken(query);
      cardText = formatScanCard(audit);
      assetKey = audit.assetKey;
    } catch {
      // Fallback safely when free-text ticker is searched inline
    }
    const dexDeepLink = buildAstroDexDeepLink({
      tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
      tgMiniAppShortName: config.tgMiniAppShortName,
      startParam: `scan_${assetKey}`,
    });
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
            inline_keyboard: [
              [
                { text: "📊 Inspect in AstroDex", url: dexDeepLink },
                {
                  text: "🚀 AstroGate Curve",
                  url: `https://t.me/${astroGateBot}/app?startapp=${encodeURIComponent(assetKey)}`,
                },
              ],
              [{ text: "🛡️ Sign in AstroWallet", url: astroWalletUrl }],
            ],
          },
        },
      ],
      { cache_time: 15, is_personal: false },
    );
  });

  return bot;
}
