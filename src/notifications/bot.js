const { Telegraf } = require("telegraf");
const config = require("../config");
const logger = require("../utils/logger");
const groupRegistry = require("./groupRegistry");
const { generateGroupReport } = require("../insights/reportGenerator");
const analysisService = require("../ai/analysis.service");
const { isRelevant, heuristicReject, MAX_QUESTION_LENGTH } = require("../ai/relevanceGuard");
const { isValidReportType, REPORT_TYPES } = require("../ai/reportTypes");
const { collectAll } = require("../insights/collector");
const { RateLimiter } = require("../utils/rateLimiter");

const MAX_TELEGRAM_MESSAGE = 4000;

// Per-chat limits, independent of each other, to bound AI spend from
// any single group:
// - Reports (/latest, /weekly, ...) are naturally infrequent and
//   cached in S3 for a full day, so a generous limit is fine.
// - Free-form /ask questions always trigger a fresh AI call (no
//   caching, since questions vary), so they get a tighter limit.
const reportLimiter = new RateLimiter({ maxRequests: 10, windowMs: 10 * 60 * 1000 });
const askLimiter = new RateLimiter({ maxRequests: 5, windowMs: 10 * 60 * 1000 });

function splitForTelegram(text) {
    if (text.length <= MAX_TELEGRAM_MESSAGE) {
        return [text];
    }
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX_TELEGRAM_MESSAGE) {
            chunks.push(remaining);
            break;
        }
        let splitIndex = remaining.lastIndexOf("\n", MAX_TELEGRAM_MESSAGE);
        if (splitIndex === -1 || splitIndex < MAX_TELEGRAM_MESSAGE * 0.5) {
            splitIndex = remaining.lastIndexOf(" ", MAX_TELEGRAM_MESSAGE);
        }
        if (splitIndex === -1) splitIndex = MAX_TELEGRAM_MESSAGE;
        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
    }
    return chunks;
}

function sanitizeMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, "*$1*")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^[ \t]*[-*]\s+/gm, "• ");
}

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

    bot.command("start", (ctx) =>
        ctx.reply(
            "👋 Tomasi Analytics Bot\n\n" +
                "Use /register <report_type> to set up this group (admin setup), then:\n" +
                "/test — sanity-check all commands\n" +
                "/latest — today's snapshot\n" +
                "/weekly — last 7 days\n" +
                "/monthly — last 30 days\n" +
                "/quarterly — last 90 days\n" +
                "/ask <question> — ask about Tomasi's analytics"
        )
    );

    bot.command("register", async (ctx) => {
        const args = ctx.message.text.split(/\s+/).slice(1);
        const reportType = args[0];
        const groupName = args.slice(1).join(" ") || ctx.chat.title || `chat-${ctx.chat.id}`;

        if (!reportType || !isValidReportType(reportType)) {
            return ctx.reply(
                `Usage: /register <report_type> [group name]\nValid types: ${Object.keys(REPORT_TYPES).join(", ")}`
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
                    `/register <report_type> [group name]\nValid types: ${Object.keys(REPORT_TYPES).join(", ")}`
            );
            return null;
        }
        return group;
    }

    async function handlePeriodReport(ctx, periodType) {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return;

        const limitCheck = reportLimiter.check(String(ctx.chat.id));
        if (!limitCheck.allowed) {
            const seconds = Math.ceil(limitCheck.retryAfterMs / 1000);
            return ctx.reply(`⏳ Report limit reached for this group. Try again in ${seconds}s.`);
        }

        await ctx.reply(`⏳ Generating ${periodType} report for "${group.groupName}"...`);

        try {
            const { reportText } = await generateGroupReport(group.groupName, group.reportType, periodType);
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

    bot.command("ask", async (ctx) => {
        const group = await requireRegisteredGroup(ctx);
        if (!group) return;

        const question = ctx.message.text.replace(/^\/ask(@\w+)?\s*/, "").trim();

        if (!question) {
            return ctx.reply("Usage: /ask <question about Tomasi's analytics>");
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
            const ping = await analysisService.classify("Reply with exactly: OK", { maxTokens: 8 });
            lines.push(`✅ AI reachable (response: "${ping.trim()}")`);
        } catch (error) {
            lines.push(`❌ AI check failed: ${error.message}`);
        }

        lines.push("");
        lines.push("Available commands here:");
        lines.push("/latest /weekly /monthly /quarterly /ask <question>");

        await replyLong(ctx, lines.join("\n"));
    });

    bot.catch((error, ctx) => {
        logger.error("Unhandled bot error", { chatId: ctx.chat?.id, error: error.message });
    });

    // Periodic cleanup of in-memory rate limiter state.
    setInterval(() => {
        reportLimiter.sweep();
        askLimiter.sweep();
    }, 5 * 60 * 1000);

    return bot;
}

module.exports = { createBot };
