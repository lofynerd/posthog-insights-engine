const { Telegraf } = require("telegraf");
const config = require("../config");
const logger = require("../utils/logger");
const groupRegistry = require("./groupRegistry");
const { generateGroupReport } = require("../insights/reportGenerator");
const analysisService = require("../ai/analysis.service");
const { isRelevant, heuristicReject, MAX_QUESTION_LENGTH } = require("../ai/relevanceGuard");
const { normalizeReportType, REPORT_TYPES, VALID_REPORT_TYPES } = require("../ai/reportTypes");
const { collectAll } = require("../insights/collector");
const { RateLimiter } = require("../utils/rateLimiter");
const { splitForTelegram, sanitizeMarkdown } = require("../utils/telegramFormat");

// Per-chat limits, independent of each other, to bound AI spend from
// any single group:
// - Reports (/latest, /weekly, ...) are naturally infrequent and
//   cached in S3 for a full day, so a generous limit is fine.
// - Free-form /ask questions always trigger a fresh AI call (no
//   caching, since questions vary), so they get a tighter limit.
// - /details, /recommend, /funnel are always fresh AI calls (never
//   cached), so they share the tighter ask-style limit.
const reportLimiter = new RateLimiter({ maxRequests: 10, windowMs: 10 * 60 * 1000 });
const askLimiter = new RateLimiter({ maxRequests: 5, windowMs: 10 * 60 * 1000 });

async function replyLong(ctx, text) {
    const sanitized = sanitizeMarkdown(text);
    const chunks = splitForTelegram(sanitized);
    for (const chunk of chunks) {
        try {
            await ctx.reply(chunk, { parse_mode: "Markdown" });
        } catch (error) {
            // Fall back to plain text if Markdown entities are unbalanced.
            await ctx.reply(chunk);
        }
    }
}

/**
 * Short command menu shown whenever someone joins a group and on
 * /start. Kept intentionally brief (per the Tomasi AI "scannable, not
 * a wall of text" philosophy) — the deeper walkthrough lives in
 * /help for anyone who wants the full explanation.
 */
function buildQuickMenu() {
    return (
        "👋 *Tomasi AI* — analytics reports for this group\n\n" +
        "*Setup (admin, once):*\n" +
        `/register <type> [name] — types: ${VALID_REPORT_TYPES.join(", ")}\n\n` +
        "*Reports:*\n" +
        "/latest /weekly /monthly /quarterly\n" +
        "/board /marketing /pr /dev — view any audience's report\n\n" +
        "*Dig deeper:*\n" +
        "/details /recommend /funnel\n" +
        "/ask <question>\n\n" +
        "*Board group only:*\n" +
        "/influencer add|list|update|disable — manage influencer discount codes\n" +
        "/campaign <slug> — ROI report for a collaboration\n\n" +
        "*Social:*\n" +
        "/social [days] — Instagram reach and top post\n\n" +
        "Send /help for a full walkthrough, or /test to check everything's connected."
    );
}

/**
 * Full walkthrough shown by /help — every command explained, not
 * just listed. Kept out of the join-message path (buildQuickMenu)
 * since a wall of text on every join would work against the
 * "scannable" philosophy the reports themselves follow.
 */
function buildWalkthrough() {
    return (
        "📘 *Tomasi AI — Full Walkthrough*\n\n" +
        "*1. Register this group (admin, once)*\n" +
        "`/register <type> [name]`\n" +
        `Types: ${VALID_REPORT_TYPES.join(", ")} (legacy: founder→board, developer→development)\n` +
        "Example: `/register marketing Marketing Team`\n" +
        "This decides which audience's report this group gets by default.\n\n" +
        "*2. Get a report for a time period*\n" +
        "/latest — today (≤350 words)\n" +
        "/weekly — last 7 days (≤500 words)\n" +
        "/monthly — last 30 days (≤700 words)\n" +
        "/quarterly — last 90 days (≤700 words)\n" +
        "Reports are cached per day, so re-running the same command twice in a day is instant.\n\n" +
        "*3. Check another audience's view*\n" +
        "/board — revenue, growth, business health\n" +
        "/marketing — traffic, campaigns, SEO, funnels\n" +
        "/pr — brand visibility, audience growth, sentiment\n" +
        "/dev — infrastructure, performance, errors\n" +
        "Any registered group can peek at any audience's report.\n\n" +
        "*4. Go deeper on the last report*\n" +
        "/details — full expanded breakdown of your last report\n" +
        "/recommend — ranked priorities only\n" +
        "/funnel — conversion funnel breakdown only\n\n" +
        "*5. Ask a specific question*\n" +
        '/ask "Why did conversion drop this week?"\n' +
        `Only answers questions about ${config.brand.name}'s analytics — off-topic questions are rejected ` +
        "to protect AI usage.\n\n" +
        "*6. Check the bot is working*\n" +
        "/test — verifies PostHog, AI, and Telegram connectivity for this group\n\n" +
        "*7. Manage influencer collaborations (board group only)*\n" +
        "/influencer add <name> <discount%> [platform] [agreedFee] — creates a real Stripe " +
        "discount code + a short tracking link, both handed to the influencer\n" +
        "/influencer list — see all codes created\n" +
        "/influencer update <slug> <platform|-> <agreedFee|-> — set or fix platform/cost on an " +
        "existing code (use - to leave a field unchanged)\n" +
        "/influencer disable <slug> — removes the code: deactivates it in Stripe so it stops " +
        "working at checkout immediately, but keeps all history so /campaign still reports on it\n" +
        "/campaign <slug> [days] — reach, purchases, revenue, and ROI for one collaboration\n\n" +
        "⚠️ *ROI needs both platform and agreedFee set* — if either is skipped in /influencer add " +
        "(they're optional there), /campaign will show ROI as N/A forever until you run " +
        "/influencer update to fill them in. This is by design: a $0/missing cost can't produce a " +
        "real ROI number, only a misleading one.\n\n" +
        "This writes to the live site (a real, working discount code), so it's restricted to " +
        "the board group only.\n\n" +
        "*8. Instagram performance*\n" +
        "/social [days] — reach, accounts engaged, follower count, and top-performing post " +
        "for the Tomasi Instagram Business account (default: last 30 days)\n\n" +
        "Reports show a ❤️ Health Score and 🧠 Confidence Score (0-100, calculated from real data, " +
        "never guessed by AI) plus a 🟢🟡🟠🔴 rating so you know how much to trust the numbers at a glance."
    );
}

/**
 * Build and configure the Telegram bot. Does not start polling —
 * call bot.launch() (long polling) separately, kept out of this
 * module so tests can construct/inspect the bot without opening a
 * live connection.
 */
function createBot(botToken = config.notifications.telegram.botToken) {
    if (!botToken) {
        throw new Error("createBot requires TELEGRAM_BOT_TOKEN to be configured");
    }

    const bot = new Telegraf(botToken);

    // Only operate in groups/supergroups (and allow direct admin setup
    // in private chat for /register). Ignore channel posts entirely —
    // this bot is designed for group Q&A, not broadcast-only channels.
    bot.use(async (ctx, next) => {
        const chatType = ctx.chat?.type;
        if (chatType && !["group", "supergroup", "private"].includes(chatType)) {
            return;
        }
        return next();
    });

    bot.command("start", (ctx) => replyLong(ctx, buildQuickMenu()));

    bot.command("help", (ctx) => replyLong(ctx, buildWalkthrough()));

    /**
     * Fires whenever one or more members join a group the bot is in
     * (Telegram sends this for both regular users joining and the
     * bot itself being added). Shows the quick command menu so new
     * members immediately know what's available, without dumping
     * the full /help walkthrough on every join.
     */
    bot.on("new_chat_members", async (ctx) => {
        const newMembers = ctx.message?.new_chat_members || [];
        const botWasAdded = newMembers.some((member) => member.id === ctx.botInfo?.id);

        if (botWasAdded) {
            const group = await groupRegistry.getGroup(ctx.chat.id).catch(() => null);
            if (!group) {
                await replyLong(
                    ctx,
                    "👋 *Tomasi AI* just joined this group.\n\n" +
                        "An admin should run:\n" +
                        `/register <type> [name] — types: ${VALID_REPORT_TYPES.join(", ")}\n\n` +
                        "Then send /help for the full walkthrough."
                );
                return;
            }
        }

        await replyLong(ctx, buildQuickMenu());
    });

    bot.command("register", async (ctx) => {
        const args = ctx.message.text.split(/\s+/).slice(1);
        const rawType = args[0];
        const reportType = normalizeReportType(rawType);
        const groupName = args.slice(1).join(" ") || ctx.chat.title || `chat-${ctx.chat.id}`;

        if (!rawType || !reportType) {
            return ctx.reply(
                `Usage: /register <report_type> [group name]\nValid types: ${VALID_REPORT_TYPES.join(", ")}`
            );
        }

        try {
            await groupRegistry.registerGroup(ctx.chat.id, groupName, reportType);
            await ctx.reply(
                `✅ Registered as *${REPORT_TYPES[reportType].title}* group ("${groupName}").`,
                { parse_mode: "Markdown" }
            );
        } catch (error) {
            logger.error("Group registration failed", error.message);
            await ctx.reply(`❌ Registration failed: ${error.message}`);
        }
    });

    async function requireRegisteredGroup(ctx) {
        const group = await groupRegistry.getGroup(ctx.chat.id);
        if (!group) {
            await ctx.reply(
                "This group isn't registered yet. An admin should run:\n" +
                    `/register <report_type> [group name]\nValid types: ${VALID_REPORT_TYPES.join(", ")}`
            );
            return null;
        }
        return group;
    }

    // Tracks the last (groupName, periodType) a group requested, so
    // /details, /recommend, and /funnel know what to expand on
    // without the user having to repeat it. In-memory only — if the
    // process restarts, the user just needs to run a report command
    // again first, which is an acceptable tradeoff for something this
    // low-stakes (no data loss, just a slightly less convenient UX).
    const lastReportByChat = new Map();

    async function handlePeriodReport(ctx, periodType, reportTypeOverride) {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return;

        const reportType = reportTypeOverride || group.reportType;

        const limitCheck = reportLimiter.check(String(ctx.chat.id));
        if (!limitCheck.allowed) {
            const seconds = Math.ceil(limitCheck.retryAfterMs / 1000);
            return ctx.reply(`⏳ Report limit reached for this group. Try again in ${seconds}s.`);
        }

        try {
            const { reportText } = await generateGroupReport(group.groupName, reportType, periodType);
            lastReportByChat.set(ctx.chat.id, { groupName: group.groupName, reportType, periodType });
            await replyLong(ctx, reportText);
        } catch (error) {
            logger.error("Report generation failed", { chatId: ctx.chat.id, error: error.message });
            await ctx.reply("❌ Couldn't generate the report right now. Please try again shortly.");
        }
    }

    bot.command("latest", (ctx) => handlePeriodReport(ctx, "latest"));
    bot.command("weekly", (ctx) => handlePeriodReport(ctx, "weekly"));
    bot.command("monthly", (ctx) => handlePeriodReport(ctx, "monthly"));
    bot.command("quarterly", (ctx) => handlePeriodReport(ctx, "quarterly"));

    // Cross-audience on-demand reports: any registered group can peek
    // at another audience's view of the same underlying data (e.g. a
    // marketing group checking /board before a leadership sync).
    // Uses the group's own S3 memory scope (groupName) so cached
    // snapshots are still shared across audiences for the same group.
    bot.command("board", (ctx) => handlePeriodReport(ctx, "weekly", "board"));
    bot.command("marketing", (ctx) => handlePeriodReport(ctx, "weekly", "marketing"));
    bot.command("pr", (ctx) => handlePeriodReport(ctx, "weekly", "pr"));
    bot.command("dev", (ctx) => handlePeriodReport(ctx, "weekly", "development"));

    /**
     * Shared handler for the three "expand on the last report"
     * commands. Each spends a fresh, uncached AI call, so they're
     * rate-limited like /ask rather than like the cached period
     * report commands.
     */
    async function handleExpansion(ctx, { mode, question }) {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return;

        const limitCheck = askLimiter.check(String(ctx.chat.id));
        if (!limitCheck.allowed) {
            const seconds = Math.ceil(limitCheck.retryAfterMs / 1000);
            return ctx.reply(`⏳ Limit reached for this group. Try again in ${seconds}s.`);
        }

        const last = lastReportByChat.get(ctx.chat.id) || {
            groupName: group.groupName,
            reportType: group.reportType,
            periodType: "weekly",
        };

        try {
            if (mode === "details") {
                const { reportText } = await generateGroupReport(
                    last.groupName,
                    last.reportType,
                    last.periodType,
                    { expanded: true }
                );
                await replyLong(ctx, reportText);
                return;
            }

            // /recommend and /funnel are targeted follow-up questions
            // against the same underlying metrics snapshot, reusing
            // the Q&A path (with its own relevance/answer bounds)
            // rather than a second full report generation.
            const metrics = await collectAll(30, 0);
            const answer = await analysisService.answerQuestion(question, metrics, config.brand.name);
            await replyLong(ctx, answer);
        } catch (error) {
            logger.error("Expansion command failed", { chatId: ctx.chat.id, mode, error: error.message });
            await ctx.reply("❌ Couldn't generate that right now. Please try again shortly.");
        }
    }

    bot.command("details", (ctx) => handleExpansion(ctx, { mode: "details" }));
    bot.command("recommend", (ctx) =>
        handleExpansion(ctx, {
            mode: "recommend",
            question: "What are the ranked recommendations and top priorities based on this data?",
        })
    );
    bot.command("funnel", (ctx) =>
        handleExpansion(ctx, {
            mode: "funnel",
            question:
                "Give a detailed breakdown of the conversion funnel: each stage's count, drop-off percentage, and the biggest bottleneck.",
        })
    );

    bot.command("ask", async (ctx) => {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return;

        const question = ctx.message.text.replace(/^\/ask(@\w+)?\s*/, "").trim();

        if (!question) {
            return ctx.reply('Usage: /ask <question about Tomasi\'s analytics>');
        }
        if (question.length > MAX_QUESTION_LENGTH) {
            return ctx.reply(`Question is too long (max ${MAX_QUESTION_LENGTH} characters).`);
        }

        const limitCheck = askLimiter.check(String(ctx.chat.id));
        if (!limitCheck.allowed) {
            const seconds = Math.ceil(limitCheck.retryAfterMs / 1000);
            return ctx.reply(`⏳ Question limit reached for this group. Try again in ${seconds}s.`);
        }

        if (heuristicReject(question)) {
            return ctx.reply(
                `🚫 I can only answer questions about ${config.brand.name}'s analytics. That looks off-topic.`
            );
        }

        try {
            const relevant = await isRelevant({
                client: analysisService,
                brandName: config.brand.name,
                question,
            });

            if (!relevant) {
                return ctx.reply(
                    `🚫 I can only answer questions about ${config.brand.name}'s website analytics ` +
                        "(traffic, conversions, devices, PR, etc). That question is out of scope."
                );
            }

            const metrics = await collectAll(30, 0);
            const answer = await analysisService.answerQuestion(question, metrics, config.brand.name);
            await replyLong(ctx, answer);
        } catch (error) {
            logger.error("Q&A failed", { chatId: ctx.chat.id, error: error.message });
            await ctx.reply("❌ Couldn't answer that right now. Please try again shortly.");
        }
    });

    /**
     * /influencer add|list|disable — manages influencer discount
     * codes by calling tomasi-design's service API. This is the one
     * command family that WRITES to production (creates a real,
     * working Stripe discount code), so it's restricted to groups
     * registered as "board" (leadership) and rate-limited tightly,
     * separate from every other (read-only) command in this bot.
     *
     * Lazily requires tomasiApi.service so a missing
     * TOMASI_BOT_SERVICE_API_KEY only breaks this one command family,
     * not the entire bot on startup.
     */
    async function requireBoardGroup(ctx) {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return null;

        if (normalizeReportType(group.reportType) !== "board") {
            await ctx.reply(
                "🚫 Influencer code management is restricted to the board/leadership group."
            );
            return null;
        }
        return group;
    }

    bot.command("influencer", async (ctx) => {
        const group = await requireBoardGroup(ctx);
        if (!group) return;

        const limitCheck = reportLimiter.check(String(ctx.chat.id));
        if (!limitCheck.allowed) {
            const seconds = Math.ceil(limitCheck.retryAfterMs / 1000);
            return ctx.reply(`⏳ Limit reached for this group. Try again in ${seconds}s.`);
        }

        const args = ctx.message.text.split(/\s+/).slice(1);
        const subcommand = args[0]?.toLowerCase();

        let tomasiApi;
        try {
            tomasiApi = require("../services/tomasiApi.service").getInstance();
        } catch (error) {
            logger.error("tomasiApi.service unavailable", error.message);
            return ctx.reply(
                "❌ Influencer code management isn't configured on this deployment " +
                    "(missing TOMASI_BOT_SERVICE_API_KEY)."
            );
        }

        if (subcommand === "add") {
            // /influencer add <name> <discountPercent> [platform] [agreedFee]
            const rest = args.slice(1);
            const discountIndex = rest.findIndex((token) => /^\d+$/.test(token));

            if (discountIndex === -1) {
                return ctx.reply(
                    "Usage: /influencer add <name> <discount%> [platform] [agreedFee]\n" +
                        "Example: /influencer add Jane Doe 15 instagram 500"
                );
            }

            const name = rest.slice(0, discountIndex).join(" ").trim();
            const discountPercent = Number(rest[discountIndex]);
            const platform = rest[discountIndex + 1];
            const agreedFee = rest[discountIndex + 2] !== undefined ? Number(rest[discountIndex + 2]) : undefined;

            if (!name) {
                return ctx.reply("Please provide the influencer's name before the discount percentage.");
            }

            try {
                const influencer = await tomasiApi.createInfluencer({
                    name,
                    discountPercent,
                    ...(platform ? { platform } : {}),
                    ...(agreedFee !== undefined ? { agreedFee } : {}),
                });

                // ROI (/campaign) can only ever show a real number once
                // BOTH platform and agreedFee are set -- see
                // metrics/campaign.js's computeRoiPercent(), which
                // returns "N/A" rather than a misleading 0%/∞% when
                // cost is missing. Flag it clearly right here, at
                // creation time, rather than leaving the board to
                // discover it later when /campaign just says N/A with
                // no obvious next step.
                const missingForRoi = [];
                if (!influencer.platform || influencer.platform === "other") missingForRoi.push("platform");
                if (influencer.agreedFee === null) missingForRoi.push("agreedFee");

                await replyLong(
                    ctx,
                    `✅ *Influencer code created*\n\n` +
                        `Name: ${influencer.name}\n` +
                        `Platform: ${influencer.platform}\n` +
                        `Discount: *${influencer.discountPercent}%* off\n` +
                        `Code: \`${influencer.code}\`\n` +
                        `Link: ${influencer.shortLink}\n` +
                        (influencer.agreedFee !== null ? `Agreed fee: ${influencer.agreedFee}\n` : "") +
                        `\nSend either the code or the link to the influencer. ` +
                        `Check performance later with /campaign ${influencer.slug}\n` +
                        (missingForRoi.length > 0
                            ? `\n🟡 *ROI can't be calculated yet* — missing ${missingForRoi.join(" and ")}. Set ${missingForRoi.length > 1 ? "them" : "it"} anytime with:\n` +
                              `\`/influencer update ${influencer.slug} ${missingForRoi.includes("platform") ? "<platform>" : influencer.platform} ${missingForRoi.includes("agreedFee") ? "<agreedFee>" : influencer.agreedFee}\`\n`
                            : "") +
                        `\nTo remove this code later: \`/influencer disable ${influencer.slug}\``
                );
            } catch (error) {
                logger.error("Influencer creation failed", { chatId: ctx.chat.id, error: error.message });
                await ctx.reply(`❌ ${error.message}`);
            }
            return;
        }

        if (subcommand === "update") {
            // /influencer update <slug> <platform|"-"> <agreedFee|"-">
            // Either positional value can be "-" to leave that field
            // unchanged, so the board can set just one field (e.g.
            // only the fee) without having to already know or re-type
            // the other.
            const slug = args[1];
            const rawPlatform = args[2];
            const rawAgreedFee = args[3];

            if (!slug || (rawPlatform === undefined && rawAgreedFee === undefined)) {
                return ctx.reply(
                    "Usage: /influencer update <slug> <platform|-> <agreedFee|->\n" +
                        "Use - to leave a field unchanged. Both fields must be set at least once " +
                        "for /campaign to calculate ROI.\n" +
                        "Example: /influencer update jane-doe instagram 500\n" +
                        "Example (fee only): /influencer update jane-doe - 500"
                );
            }

            const platform = rawPlatform && rawPlatform !== "-" ? rawPlatform : undefined;
            const agreedFee = rawAgreedFee && rawAgreedFee !== "-" ? Number(rawAgreedFee) : undefined;

            if (platform === undefined && agreedFee === undefined) {
                return ctx.reply("Nothing to update — provide a platform, an agreedFee, or both (use - to skip one).");
            }

            try {
                const influencer = await tomasiApi.updateInfluencer(slug.toLowerCase(), {
                    ...(platform !== undefined ? { platform } : {}),
                    ...(agreedFee !== undefined ? { agreedFee } : {}),
                });

                const stillMissing = [];
                if (!influencer.platform || influencer.platform === "other") stillMissing.push("platform");
                if (influencer.agreedFee === null) stillMissing.push("agreedFee");

                await replyLong(
                    ctx,
                    `✅ *Influencer updated*\n\n` +
                        `Name: ${influencer.name}\n` +
                        `Platform: ${influencer.platform}\n` +
                        `Agreed fee: ${influencer.agreedFee !== null ? influencer.agreedFee : "not set"}\n\n` +
                        (stillMissing.length > 0
                            ? `🟡 ROI still can't be calculated — missing ${stillMissing.join(" and ")}.`
                            : `🟢 ROI can now be calculated. Check it with /campaign ${influencer.slug}`)
                );
            } catch (error) {
                logger.error("Influencer update failed", { chatId: ctx.chat.id, error: error.message });
                await ctx.reply(`❌ ${error.message}`);
            }
            return;
        }

        if (subcommand === "list") {
            try {
                const influencers = await tomasiApi.listInfluencers();
                if (influencers.length === 0) {
                    return ctx.reply("No influencer codes created yet. Use /influencer add to create one.");
                }

                const lines = influencers.map(
                    (inf) =>
                        `${inf.status === "active" ? "🟢" : "⚪"} *${inf.name}* — \`${inf.code}\` (${inf.discountPercent}% off, ${inf.platform})`
                );
                await replyLong(ctx, `*Influencer codes:*\n\n${lines.join("\n")}`);
            } catch (error) {
                logger.error("Influencer list failed", { chatId: ctx.chat.id, error: error.message });
                await ctx.reply(`❌ ${error.message}`);
            }
            return;
        }

        if (subcommand === "disable") {
            // Stripe doesn't support deleting a promotion code, only
            // deactivating it -- this is the closest thing to
            // "removing" an influencer: the code stops working at
            // checkout immediately, but historical orders/ROI for it
            // remain fully queryable via /campaign.
            const slug = args[1];
            if (!slug) {
                return ctx.reply("Usage: /influencer disable <slug>\nNote: this deactivates the code (Stripe can't delete promo codes) — past orders and /campaign history are kept.");
            }

            try {
                const result = await tomasiApi.disableInfluencer(slug);
                await ctx.reply(`✅ ${result.message}`);
            } catch (error) {
                logger.error("Influencer disable failed", { chatId: ctx.chat.id, error: error.message });
                await ctx.reply(`❌ ${error.message}`);
            }
            return;
        }

        await ctx.reply(
            "Usage:\n" +
                "/influencer add <name> <discount%> [platform] [agreedFee]\n" +
                "/influencer list\n" +
                "/influencer update <slug> <platform|-> <agreedFee|-> — set/fix platform and cost so ROI can be calculated\n" +
                "/influencer disable <slug> — removes the code (deactivates it; history is kept)"
        );
    });

    /**
     * /campaign <slug> [days] — ROI report for one influencer
     * collaboration: reach (click-through), purchases, revenue, and
     * ROI against the agreed fee. Defaults to all-time (no [days])
     * since collaborations run on their own schedule, not calendar
     * weeks/months.
     */
    bot.command("campaign", async (ctx) => {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return;

        const limitCheck = askLimiter.check(String(ctx.chat.id));
        if (!limitCheck.allowed) {
            const seconds = Math.ceil(limitCheck.retryAfterMs / 1000);
            return ctx.reply(`⏳ Limit reached for this group. Try again in ${seconds}s.`);
        }

        const args = ctx.message.text.split(/\s+/).slice(1);
        const slug = args[0];
        const days = args[1] ? Number(args[1]) : null;

        if (!slug) {
            return ctx.reply("Usage: /campaign <slug> [days]\nExample: /campaign jane-doe 30");
        }

        let tomasiApi;
        try {
            tomasiApi = require("../services/tomasiApi.service").getInstance();
        } catch (error) {
            return ctx.reply("❌ Influencer campaign reporting isn't configured on this deployment.");
        }

        try {
            const influencers = await tomasiApi.listInfluencers();
            const influencer = influencers.find((inf) => inf.slug === slug.toLowerCase());

            if (!influencer) {
                return ctx.reply(`No influencer found with slug "${slug}". Use /influencer list to see all codes.`);
            }

            const campaignMetrics = require("../metrics/campaign");
            const performance = await campaignMetrics.collect(influencer, days);

            // ROI/cost are explicitly rendered as "N/A" (never 0% or a
            // number) when no usable cost figure exists -- a ₹0/missing
            // campaign cost makes ROI mathematically meaningless, not
            // infinite or zero. See metrics/campaign.js computeRoiPercent().
            const costLine = performance.cost !== null ? `${performance.cost}` : "N/A (not set)";
            const roiLine =
                performance.roiPercent !== null
                    ? `${performance.roiPercent >= 0 ? "🟢" : "🔴"} *ROI: ${performance.roiPercent}%* (profit: ${performance.profit})`
                    : "🟡 *ROI: N/A* — campaign cost not set. Use /influencer add with a fee, or update the record, to compute ROI.";

            await replyLong(
                ctx,
                `📊 *Campaign: ${performance.influencer.name}* (${performance.influencer.platform})\n` +
                    `Code: \`${performance.code}\`\n` +
                    `${performance.campaign.periodDays ? `Last ${performance.campaign.periodDays} days` : "All-time"}\n\n` +
                    `💵 Campaign cost: *${costLine}*\n` +
                    `👥 Reach (click-through): *${performance.reach}*\n` +
                    `🛒 Orders: *${performance.orders}*\n` +
                    `📦 Units sold: *${performance.unitsSold}*\n` +
                    `💰 Revenue: *${performance.revenue}*\n` +
                    `📈 Conversion (reach → order): *${performance.conversionRate !== null ? (performance.conversionRate * 100).toFixed(2) + "%" : "N/A"}*\n\n` +
                    roiLine
            );
        } catch (error) {
            logger.error("Campaign report failed", { chatId: ctx.chat.id, error: error.message });
            await ctx.reply(`❌ ${error.message}`);
        }
    });

    /**
     * /social [days] — Instagram reach, accounts engaged, follower
     * count, and top-performing post. Lazily requires
     * instagram.service so a missing credential only breaks this one
     * command, not the whole bot.
     */
    bot.command("social", async (ctx) => {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return;

        const limitCheck = reportLimiter.check(String(ctx.chat.id));
        if (!limitCheck.allowed) {
            const seconds = Math.ceil(limitCheck.retryAfterMs / 1000);
            return ctx.reply(`⏳ Limit reached for this group. Try again in ${seconds}s.`);
        }

        const args = ctx.message.text.split(/\s+/).slice(1);
        const days = args[0] ? Number(args[0]) : 30;

        let socialMetrics;
        try {
            socialMetrics = require("../metrics/social");
        } catch (error) {
            return ctx.reply(
                "❌ Instagram reporting isn't configured on this deployment (missing INSTAGRAM_* credentials)."
            );
        }

        try {
            const metrics = await socialMetrics.collectInstagram(days, 10);

            const lines = [
                `📸 *Instagram Performance* (last ${days} days)`,
                "",
                `👁️ Reach: *${metrics.reach ?? "n/a"}*`,
                `🤝 Accounts engaged: *${metrics.accountsEngaged ?? "n/a"}*`,
                `👥 Followers: *${metrics.followerCount ?? "n/a"}*`,
                "",
            ];

            if (metrics.topPost) {
                lines.push(
                    `🏆 *Top post*: ${metrics.topPost.caption || "(no caption)"}`,
                    `❤️ ${metrics.topPost.likes ?? "n/a"} likes · 💬 ${metrics.topPost.comments ?? "n/a"} comments · ` +
                        `🔖 ${metrics.topPost.saved ?? "n/a"} saves · 👁️ ${metrics.topPost.reach ?? "n/a"} reach`,
                    metrics.topPost.permalink || ""
                );
            } else {
                lines.push("No recent posts found.");
            }

            await replyLong(ctx, lines.filter(Boolean).join("\n"));
        } catch (error) {
            logger.error("Instagram report failed", { chatId: ctx.chat.id, error: error.message });
            await ctx.reply(`❌ ${error.message}`);
        }
    });

    /**
     * /test — sanity-check every command in the current group without
     * spending a full AI report call for each one. Verifies:
     * - the group is registered
     * - PostHog connectivity
     * - AI connectivity (cheap classification call)
     * - Telegram delivery itself (this message)
     */
    bot.command("test", async (ctx) => {
        const group = await groupRegistry.getGroup(ctx.chat.id);
        const lines = [];

        lines.push(`🧪 *Test report for chat* \`${ctx.chat.id}\``);
        lines.push(group ? `✅ Registered as *${group.reportType}* ("${group.groupName}")` : "⚠️ Not registered — run /register");

        try {
            const metrics = await collectAll(1, 0);
            lines.push(`✅ PostHog reachable (today's pageviews: ${metrics.acquisition.pageviews})`);
        } catch (error) {
            lines.push(`❌ PostHog check failed: ${error.message}`);
        }

        try {
            const ping = await analysisService.classify("Reply with exactly: OK", { maxTokens: 16 });
            lines.push(`✅ AI reachable (response: "${ping.trim()}")`);
        } catch (error) {
            lines.push(`❌ AI check failed: ${error.message}`);
        }

        lines.push("");
        lines.push("Available commands here:");
        lines.push("/latest /weekly /monthly /quarterly");
        lines.push("/board /marketing /pr /dev");
        lines.push("/details /recommend /funnel");
        lines.push('/ask <question>');
        lines.push("/influencer add|list|update|disable /campaign <slug> — board group only");
        lines.push("/social [days]");
        lines.push("/help — full walkthrough");

        await replyLong(ctx, lines.join("\n"));
    });

    bot.catch((error, ctx) => {
        logger.error("Unhandled bot error", { chatId: ctx.chat?.id, error: error.message });
    });

    // Periodic cleanup of in-memory rate limiter state. Exposed on
    // the bot instance (rather than left as a bare interval) so
    // callers — production shutdown handling and tests alike — can
    // clear it explicitly instead of relying on process exit.
    bot._rateLimiterSweepInterval = setInterval(() => {
        reportLimiter.sweep();
        askLimiter.sweep();
    }, 5 * 60 * 1000);

    return bot;
}

module.exports = { createBot };
