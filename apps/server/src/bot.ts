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
import type { InlineKeyboardButton } from "grammy/types";
import type { DexServerRepository } from "./db/repository.js";
import {
  buildUnifiedCatalog,
  createConfiguredCurveStateLoader,
  createConfiguredPairReservesLoader,
  fetchTokenAmmPools,
  fetchTokenTopHolders,
  loadLiveAmmOrderbookAndSpot,
  resolveAssetTarget,
  resolveReadFeedConfig,
} from "./services/catalog.js";
import { adaptFetch, type FetchLike } from "./stellar-verifier.js";

function resolveBotFeedConfig(baseConfig: ServerConfig, rawText: string) {
  const tokens = rawText.trim().split(/\s+/).filter(Boolean);
  const hasTestnet = tokens.some((t) => t.toLowerCase() === "testnet");
  const hasMainnet = tokens.some((t) => t.toLowerCase() === "mainnet");
  const cleanTokens = tokens.filter(
    (t) => t.toLowerCase() !== "testnet" && t.toLowerCase() !== "mainnet",
  );
  const targetNet = hasTestnet ? "testnet" : hasMainnet ? "mainnet" : "mainnet";
  return {
    botCfg: resolveReadFeedConfig(baseConfig, targetNet),
    tokens: cleanTokens,
  };
}

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

  const createScannerFor = (cfg: ServerConfig) =>
    createStellarForensicScanner({
      network: cfg.network,
      networkPassphrase: cfg.networkPassphrase,
      rpcUrls: cfg.rpcUrls,
      horizonUrls: cfg.horizonUrls,
      sep42AssetListUrls: cfg.sep42AssetListUrls,
      stellarExpertApiBase: cfg.stellarExpertApiBase,
      astroGateApiBaseUrl: cfg.astroGateApiBaseUrl,
      fetchFn,
    });

  const openAppUrl = buildAstroDexDeepLink({
    tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
    tgMiniAppShortName: config.tgMiniAppShortName,
  });
  const astroWalletUrl = `https://t.me/${config.astroWalletBotUsername ?? "AstroWalletAppBot"}/${config.astroWalletMiniAppShortName ?? "wallet"}`;
  const botHandle = config.tgBotUsername ?? "AstroDexBot";

  function miniAppBtn(
    isPrivate: boolean,
    text: string,
    startParam?: string,
  ): InlineKeyboardButton {
    if (isPrivate) {
      const base = config.tmaOrigin.replace(/\/+$/, "");
      return {
        text,
        web_app: {
          url: startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base,
        },
      };
    }
    return {
      text,
      url: buildAstroDexDeepLink({
        tgBotUsername: botHandle,
        tgMiniAppShortName: config.tgMiniAppShortName,
        ...(startParam ? { startParam } : {}),
      }),
    };
  }

  function isExplicitMentionInGroup(ctx: {
    chat?: { type?: string } | undefined;
    message?: { text?: string | undefined } | undefined;
    me?: { username?: string | undefined } | undefined;
  }): boolean {
    if (ctx.chat?.type === "private") return true;
    const raw = (ctx.message?.text ?? "").toLowerCase();
    const handle = (ctx.me?.username ?? botHandle).toLowerCase();
    return raw.includes(`@${handle}`);
  }

  bot.command("start", async (ctx) => {
    if (!isExplicitMentionInGroup(ctx)) return;
    const caption = [
      `<b>AstroDex</b> · <code>MAINNET &amp; TESTNET</code>`,
      "5-Way Stellar Trading Terminal powered by <b>AstroWallet</b>.",
      "",
      "• <b>Ethena USDe / sUSDe</b> &amp; <b>LayerZero USDT0</b> live Mainnet routing",
      "• <b>5-Way Aggregator:</b> XOXNO · Aquarius · Soroswap · SDEX · Path",
      "• <b>Oracles &amp; Forensics:</b> RedStone SEP-40 · Chainlink · Astro Shield X-Ray",
      "• <b>Express Sign:</b> One-tap non-custodial Clear-Sign via AstroWallet",
      "",
      "Tap below to trade, or run /usde or /help for chat commands.",
    ].join("\n");
    const isPrivate = ctx.chat?.type === "private";
    const replyMarkup = {
      inline_keyboard: [
        [miniAppBtn(isPrivate, "⚡ Open AstroDex")],
        [{ text: "🛡️ Open AstroWallet", url: astroWalletUrl }],
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

  bot.command("stats", async (ctx) => {
    if (!isExplicitMentionInGroup(ctx)) return;
    const snap = await repo.getPublicMetricsSnapshot(config.network);
    const walletBase = (config.astroWalletApiBaseUrl ?? "https://astrowallet-soroban.pages.dev").replace(/\/+$/, "");
    await ctx.reply(
      [
        `📊 <b>AstroDex · Live Traction</b> · <code>MAINNET &amp; TESTNET</code>`,
        "",
        `• <b>Active (DAU / WAU / MAU):</b> <code>${snap.dau} / ${snap.wau} / ${snap.mau}</code>`,
        `• <b>Indexed Pairs / Tokens:</b> <code>${snap.totalPairs} / ${snap.totalTokens}</code>`,
        `• <b>Verified Swaps &amp; Orders:</b> <code>${snap.verifiedTxCount}</code>`,
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "📊 Open ASTRO Ecosystem Stats", url: `${walletBase}/stats` }]],
        },
      },
    );
  });

  bot.command("help", async (ctx) => {
    if (!isExplicitMentionInGroup(ctx)) return;
    await ctx.reply(
      [
        `<b>AstroDex</b> · <code>MAINNET &amp; TESTNET</code>`,
        "Non-custodial 5-way trading terminal powered by AstroWallet (Express Sign).",
        "",
        "<b>Markets &amp; Routing:</b> /usde · /route · /chart · /book",
        "<b>Forensics &amp; Data:</b> /scan · /whales · /list · /alerts · /stats",
        `<i>Examples:</i> <code>/usde</code> · <code>/route 10 XLM USDE</code> · <code>/scan USDT0</code>`,
        `<i>Inline:</i> <code>@${botHandle} USDE</code>`,
      ].join("\n"),
      { parse_mode: "HTML" },
    );
  });

  bot.command("scan", async (ctx) => {
    if (!isExplicitMentionInGroup(ctx)) return;
    const { botCfg, tokens } = resolveBotFeedConfig(config, ctx.match);
    const arg = tokens.join(" ");
    if (!arg) {
      await ctx.reply("Usage: <code>/scan XLM</code>, <code>/scan AQUA</code>, <code>/scan XLM testnet</code>, or <code>/scan CODE:G...</code>", {
        parse_mode: "HTML",
      });
      return;
    }
    try {
      const botScanner = createScannerFor(botCfg);
      const { target } = await resolveAssetTarget({ config: botCfg, repo, fetchFn, rawAsset: arg });
      const audit = await botScanner.auditToken(target.resolvedKey);
      const isPrivate = ctx.chat?.type === "private";
      await ctx.reply(`<code>[${botCfg.network.toUpperCase()}]</code>\n${formatScanCard(audit)}`, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              miniAppBtn(isPrivate, "📊 Open in AstroDex", `${botCfg.network}_scan_${audit.assetKey}`),
              { text: "🛡️ AstroWallet", url: astroWalletUrl },
            ],
          ],
        },
      });
    } catch (err) {
      await ctx.reply(
        `Could not scan asset (${botCfg.network}): ${err instanceof Error ? err.message : "Asset not found"}`,
      );
    }
  });

  bot.command("list", async (ctx) => {
    const { botCfg, tokens } = resolveBotFeedConfig(config, ctx.match);
    const assetId = tokens[0];
    if (!assetId) {
      await ctx.reply(
        "Usage: <code>/list CODE:G... [soroswap|aquarius|phoenix|sdex_pool]</code> or <code>/list C...</code>",
        { parse_mode: "HTML" },
      );
      return;
    }
    const rawVenue = tokens[1]?.toLowerCase() ?? "soroswap";
    const allowedVenues = new Set(["soroswap", "aquarius", "phoenix", "sdex_pool"]);
    const ammVenue = allowedVenues.has(rawVenue) ? rawVenue : "soroswap";

    try {
      const botScanner = createScannerFor(botCfg);
      const { target } = await resolveAssetTarget({ config: botCfg, repo, fetchFn, rawAsset: assetId });
      const audit = await botScanner.auditToken(target.resolvedKey);
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
    const { botCfg, tokens } = resolveBotFeedConfig(config, ctx.match);
    const arg = tokens[0] ?? "XLM";
    const isPrivate = ctx.chat?.type === "private";
    await ctx.reply(`Open live <code>${botCfg.network.toUpperCase()}</code> chart for <code>${arg}</code>:`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            miniAppBtn(isPrivate, "📊 Open Pro Chart", `${botCfg.network}_token_${arg}`),
            { text: "🛡️ AstroWallet", url: astroWalletUrl },
          ],
        ],
      },
    });
  });

  bot.command("book", async (ctx) => {
    const { botCfg, tokens } = resolveBotFeedConfig(config, ctx.match);
    const rawBase = tokens[0] ?? "XLM";
    const defaultQuote =
      rawBase.toUpperCase() === "XLM"
        ? botCfg.network === "mainnet"
          ? "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
          : "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        : "XLM";
    const rawQuote = tokens[1] ?? defaultQuote;
    const snapshot = await buildUnifiedCatalog(botCfg, repo, fetchFn, {
      includeRepoTokens: botCfg.network === config.network,
    });
    const [{ target: baseTarget }, { target: quoteTarget }] = await Promise.all([
      resolveAssetTarget({ config: botCfg, repo, fetchFn, rawAsset: rawBase, snapshot }),
      resolveAssetTarget({ config: botCfg, repo, fetchFn, rawAsset: rawQuote, snapshot }),
    ]);
    const [horizonBook, ammPools] = await Promise.all([
      fetchHorizonOrderbook(
        botCfg.horizonUrls,
        baseTarget.classicAsset ?? baseTarget.resolvedKey,
        quoteTarget.classicAsset ?? quoteTarget.resolvedKey,
        10,
        fetchFn,
      ),
      fetchTokenAmmPools({ config: botCfg, target: baseTarget, snapshot, fetchFn, limit: 3 }).catch(() => []),
    ]);
    const book =
      horizonBook.bids.length === 0 && horizonBook.asks.length === 0
        ? (await loadLiveAmmOrderbookAndSpot({ config: botCfg, snapshot, baseTarget, quoteTarget, fetchFn })
            .then((r) => r.syntheticSnapshot)
            .catch(() => null)) ?? horizonBook
        : horizonBook;
    const poolLines = ammPools.length > 0
      ? `\n\n<b>Top AMM Pools (${ammPools.length}):</b>\n` +
        ammPools
          .map(
            (p) =>
              `• <code>${p.venue}</code> vs <b>${p.counterCode}</b> · Fee ${(p.feeBps / 100).toFixed(2)}%${p.totalTrustlines > 0 ? ` · ${p.totalTrustlines} LPs` : ""}`,
          )
          .join("\n")
      : "";
    const isPrivate = ctx.chat?.type === "private";
    await ctx.reply(`<code>[${botCfg.network.toUpperCase()}]</code>\n${formatOrderbookCard(book)}${poolLines}`, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            miniAppBtn(
              isPrivate,
              "📖 Open Orderbook",
              `${botCfg.network}_book_${(baseTarget.classicAsset ? (baseTarget.resolvedKey.split(":")[0] ?? baseTarget.resolvedKey) : baseTarget.resolvedKey).slice(0, 44)}`,
            ),
            { text: "🛡️ AstroWallet", url: astroWalletUrl },
          ],
        ],
      },
    });
  });

  bot.command("route", async (ctx) => {
    const { botCfg, tokens } = resolveBotFeedConfig(config, ctx.match);
    if (tokens.length < 3) {
      await ctx.reply("Usage: <code>/route 100 XLM AQUA</code> (or add <code>testnet</code>)", { parse_mode: "HTML" });
      return;
    }
    const [amount = "10", rawFrom = "XLM", rawTo = ""] = tokens;
    const snapshot = await buildUnifiedCatalog(botCfg, repo, fetchFn, {
      includeRepoTokens: botCfg.network === config.network,
    });
    const [{ target: fromTarget }, { target: toTarget }] = await Promise.all([
      resolveAssetTarget({ config: botCfg, repo, fetchFn, rawAsset: rawFrom, snapshot }),
      resolveAssetTarget({ config: botCfg, repo, fetchFn, rawAsset: rawTo, snapshot }),
    ]);
    const routerEngine = createSmartLiquidityRouter({
      horizonUrls: botCfg.horizonUrls,
      networkPassphrase: botCfg.networkPassphrase,
      xoxnoApiBase: botCfg.xoxnoSwapApiBase,
      verifiedAssets: snapshot.sep42Assets,
      curveStateLoader: createConfiguredCurveStateLoader(botCfg, fetchFn),
      directPairReservesLoader: createConfiguredPairReservesLoader(botCfg, snapshot, fetchFn),
      fetchFn,
    });
    const quote = await routerEngine.quoteBestRoutes({
      fromAsset: fromTarget.resolvedKey,
      toAsset: toTarget.resolvedKey,
      amount,
      slippageBps: 50,
      accountKind: "classic",
    });
    const displayFrom = fromTarget.catalogItem?.code ?? rawFrom.split(":")[0]?.toUpperCase() ?? quote.fromAsset;
    const displayTo = toTarget.catalogItem?.code ?? rawTo.split(":")[0]?.toUpperCase() ?? quote.toAsset;
    const displayQuote = {
      ...quote,
      fromAsset: displayFrom,
      toAsset: displayTo,
      ...(quote.bestRoute
        ? {
            bestRoute: {
              ...quote.bestRoute,
              fromAsset: displayFrom,
              toAsset: displayTo,
            },
          }
        : {}),
    };
    const isPrivate = ctx.chat?.type === "private";
    await ctx.reply(formatQuoteCard(displayQuote), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            miniAppBtn(isPrivate, "⚡ Trade in AstroDex", `${botCfg.network}_token_${toTarget.resolvedKey}`),
            { text: "🛡️ Sign in AstroWallet", url: astroWalletUrl },
          ],
        ],
      },
    });
  });

  bot.command("whales", async (ctx) => {
    const { botCfg, tokens } = resolveBotFeedConfig(config, ctx.match);
    const assetArg = tokens[0];
    if (assetArg) {
      try {
        const snapshot = await buildUnifiedCatalog(botCfg, repo, fetchFn, {
          includeRepoTokens: botCfg.network === config.network,
        });
        const { target } = await resolveAssetTarget({
          config: botCfg,
          repo,
          fetchFn,
          rawAsset: assetArg,
          snapshot,
        });
        const holders = await fetchTokenTopHolders({
          config: botCfg,
          target,
          fetchFn,
          limit: 10,
        });
        const deepLink = buildAstroDexDeepLink({
          tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
          tgMiniAppShortName: config.tgMiniAppShortName,
          startParam: `${botCfg.network}_token_${target.resolvedKey}`,
        });
        if (holders.length === 0) {
          await ctx.reply(`No on-chain holders returned for <code>${assetArg}</code> on ${botCfg.network.toUpperCase()}.`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "📊 Open Token Hub", url: deepLink }]] },
          });
          return;
        }
        const lines = holders.map(
          (h, idx) =>
            `${idx + 1}. <code>${h.address.slice(0, 6)}…${h.address.slice(-4)}</code> · <b>${Number(h.balance).toLocaleString("en-US", { maximumFractionDigits: 2 })}</b>`,
        );
        await ctx.reply(
          `<code>[${botCfg.network.toUpperCase()}]</code> <b>Top ${holders.length} Holders — ${assetArg.toUpperCase()}</b>\n\n${lines.join("\n")}`,
          {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[{ text: "📊 Open Token Hub", url: deepLink }]] },
          },
        );
        return;
      } catch (err) {
        await ctx.reply(
          `Could not fetch holders: ${err instanceof Error ? err.message : "Asset not found"}`,
        );
        return;
      }
    }

    const whales = await repo.listWhaleTrades(5);
    if (whales.length === 0) {
      await ctx.reply("Usage: <code>/whales AQUA</code> or <code>/whales SSLX</code> — or open AstroDex Radar for live pairs.", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Open Whale Radar", url: openAppUrl }]] },
      });
      return;
    }
    await ctx.reply(whales.map(formatWhaleAlertCard).join("\n\n"), { parse_mode: "HTML" });
  });

  bot.command("usde", async (ctx) => {
    const mainnetCfg = resolveReadFeedConfig(config, "mainnet");
    try {
      const snapshot = await buildUnifiedCatalog(mainnetCfg, repo, fetchFn, {
        includeRepoTokens: false,
      });
      const routerEngine = createSmartLiquidityRouter({
        horizonUrls: mainnetCfg.horizonUrls,
        networkPassphrase: mainnetCfg.networkPassphrase,
        xoxnoApiBase: mainnetCfg.xoxnoSwapApiBase,
        verifiedAssets: snapshot.sep42Assets,
        curveStateLoader: createConfiguredCurveStateLoader(mainnetCfg, fetchFn),
        directPairReservesLoader: createConfiguredPairReservesLoader(mainnetCfg, snapshot, fetchFn),
        fetchFn,
      });
      const USDE_KEY = "USDE:GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47";
      const SUSDE_KEY = "SUSDE:GDJ5BNU5NN6NQ54D7OX6NQTUYNBZ42CAT33QGM5BIQ2QIYADAC5ICH47";
      const USDC_KEY = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

      const [qXlmUsde, qXlmSusde, qUsdcUsde] = await Promise.all([
        routerEngine
          .quoteBestRoutes({
            fromAsset: "XLM",
            toAsset: USDE_KEY,
            amount: "10",
            slippageBps: 100,
            accountKind: "classic",
          })
          .catch(() => null),
        routerEngine
          .quoteBestRoutes({
            fromAsset: "XLM",
            toAsset: SUSDE_KEY,
            amount: "10",
            slippageBps: 100,
            accountKind: "classic",
          })
          .catch(() => null),
        routerEngine
          .quoteBestRoutes({
            fromAsset: USDC_KEY,
            toAsset: USDE_KEY,
            amount: "100",
            slippageBps: 100,
            accountKind: "classic",
          })
          .catch(() => null),
      ]);

      const lines = [
        `⚡ <b>Ethena USDe &amp; sUSDe on Stellar</b> · <code>MAINNET</code>`,
        "Live 5-Way Aggregator routing (XOXNO + Aquarius + Soroswap + SDEX):",
        "",
        qXlmUsde?.bestRoute
          ? `• <b>10 XLM → USDe:</b> <code>${qXlmUsde.bestRoute.expectedOutputAmount} USDe</code> (${qXlmUsde.bestRoute.venue})`
          : `• <b>10 XLM → USDe:</b> <i>Quote unavailable</i>`,
        qXlmSusde?.bestRoute
          ? `• <b>10 XLM → sUSDe:</b> <code>${qXlmSusde.bestRoute.expectedOutputAmount} sUSDe</code> (${qXlmSusde.bestRoute.venue})`
          : `• <b>10 XLM → sUSDe:</b> <i>Quote unavailable</i>`,
        qUsdcUsde?.bestRoute
          ? `• <b>100 USDC → USDe:</b> <code>${qUsdcUsde.bestRoute.expectedOutputAmount} USDe</code> (${qUsdcUsde.bestRoute.venue})`
          : `• <b>100 USDC → USDe:</b> <i>Quote unavailable</i>`,
        "",
        "<i>Buy directly in chat with /buy 10 USDE in @AstroWalletAppBot</i>",
      ];

      const isPrivate = ctx.chat?.type === "private";
      await ctx.reply(lines.join("\n"), {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              miniAppBtn(isPrivate, "⚡ Trade USDe in AstroDex", `mainnet_token_${USDE_KEY}`),
              { text: "🛡️ Buy in AstroWallet", url: astroWalletUrl },
            ],
          ],
        },
      });
    } catch (err) {
      await ctx.reply(
        `Could not load live USDe pulse: ${err instanceof Error ? err.message : "Network error"}`,
      );
    }
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
    const isPrivate = ctx.chat?.type === "private";
    await ctx.reply(
      alerts.length === 0
        ? "You have no active price alerts. Configure alerts inside the AstroDex Mini App."
        : `You have ${alerts.length} active price alert(s).`,
      {
        reply_markup: { inline_keyboard: [[miniAppBtn(isPrivate, "🔔 Manage Alerts", "orders")]] },
      },
    );
  });

  bot.on("inline_query", async (ctx) => {
    const { botCfg, tokens } = resolveBotFeedConfig(config, ctx.inlineQuery.query.trim() || "XLM");
    const query = tokens[0] ?? "XLM";
    let cardText = `<b>AstroDex Market Card — ${query}</b>\nTap below to open Pro Chart &amp; Forensic X-Ray.`;
    let assetKey = query;
    try {
      const botScanner = createScannerFor(botCfg);
      const { target } = await resolveAssetTarget({ config: botCfg, repo, fetchFn, rawAsset: query });
      const audit = await botScanner.auditToken(target.resolvedKey);
      cardText = `<code>[${botCfg.network.toUpperCase()}]</code>\n${formatScanCard(audit)}`;
      assetKey = audit.assetKey;
    } catch {
      // Fallback safely when free-text ticker is searched inline
    }
    const dexDeepLink = buildAstroDexDeepLink({
      tgBotUsername: config.tgBotUsername ?? "AstroDexBot",
      tgMiniAppShortName: config.tgMiniAppShortName,
      startParam: `${botCfg.network}_scan_${assetKey}`,
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
                { text: "🛡️ Sign in AstroWallet", url: astroWalletUrl },
              ],
            ],
          },
        },
      ],
      { cache_time: 15, is_personal: false },
    );
  });

  return bot;
}
