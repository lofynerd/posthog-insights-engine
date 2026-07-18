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
