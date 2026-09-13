const cron = require("node-cron");
const groupRegistry = require("../notifications/groupRegistry");
const { generateCompactSummary } = require("../insights/reportGenerator");
const logger = require("../utils/logger");
const { splitForTelegram, sanitizeMarkdown } = require("../utils/telegramFormat");

/**
 * Send a scheduled report to every registered group for a given
 * period type. Each group's failure is isolated so one bad group
 * (e.g. a stale registration) doesn't block delivery to the others.
 *
 * Uses the same compact chart+caption summary as the on-demand
 * /latest /weekly /monthly /quarterly bot commands (see
 * reportGenerator.js's generateCompactSummary) rather than the full
 * multi-section text report, so scheduled and on-demand reports look
 * identical.
 *
 * @param {import("telegraf").Telegraf} bot
 * @param {string} periodType - weekly | monthly | quarterly
 */
async function runScheduledReports(bot, periodType) {
    const groups = await groupRegistry.listGroups();
    logger.info(`Running ${periodType} scheduled reports`, { groupCount: groups.length });

    for (const group of groups) {
        try {
            const { caption, imageBuffer } = await generateCompactSummary(
                group.groupName,
                group.reportType,
                periodType
            );

            const header = `📊 *${periodType.toUpperCase()} REPORT* — ${group.groupName}\n\n`;
            const sanitizedCaption = sanitizeMarkdown(header + caption);

            if (imageBuffer) {
                try {
                    await bot.telegram.sendPhoto(group.chatId, { source: imageBuffer }, {
                        caption: sanitizedCaption,
                        parse_mode: "Markdown",
                    });
                    logger.info("Scheduled report delivered", { chatId: group.chatId, periodType });
                    continue;
                } catch (photoError) {
                    logger.warn("Scheduled photo delivery failed, falling back to text", {
                        chatId: group.chatId,
                        error: photoError.message,
                    });
                }
            }

            const chunks = splitForTelegram(sanitizedCaption);
            for (const chunk of chunks) {
                try {
                    await bot.telegram.sendMessage(group.chatId, chunk, { parse_mode: "Markdown" });
                } catch {
                    await bot.telegram.sendMessage(group.chatId, chunk);
                }
            }

            logger.info("Scheduled report delivered", { chatId: group.chatId, periodType });
        } catch (error) {
            logger.error("Scheduled report failed for group", {
                chatId: group.chatId,
                periodType,
                error: error.message,
            });
        }
    }
}

/**
 * Register cron jobs for weekly, monthly, and quarterly automatic reports.
 * 
 * Weekly: Every Monday at 08:00 server time
 * Monthly: 1st of every month at 08:00 server time  
 * Quarterly: 1st of January, April, July, October at 08:00 server time
 * 
 * Daily automatic reports are intentionally NOT included per product decision.
 * 
 * Quarterly uses calendar quarters (Q1=Jan, Q2=Apr, Q3=Jul, Q4=Oct) rather
 * than rolling 90-day windows. This aligns with business reporting cycles
 * even though the underlying report generator uses a rolling 90-day window
 * when calculating the quarterly period.
 *
 * @param {import("telegraf").Telegraf} bot
 * @returns {Array<import("node-cron").ScheduledTask>} scheduled tasks, for cleanup on shutdown.
 */
function startScheduler(bot) {
    const tasks = [];

    // Every Monday at 08:00 server time.
    tasks.push(
        cron.schedule("0 8 * * 1", () => {
            runScheduledReports(bot, "weekly").catch((error) =>
                logger.error("Weekly scheduler run failed", error.message)
            );
        })
    );

    // 1st of every month at 08:00 server time.
    tasks.push(
        cron.schedule("0 8 1 * *", () => {
            runScheduledReports(bot, "monthly").catch((error) =>
                logger.error("Monthly scheduler run failed", error.message)
            );
        })
    );

    // 1st of January, April, July, October at 08:00 server time (calendar quarters).
    tasks.push(
        cron.schedule("0 8 1 1,4,7,10 *", () => {
            runScheduledReports(bot, "quarterly").catch((error) =>
                logger.error("Quarterly scheduler run failed", error.message)
            );
        })
    );

    logger.info("Scheduler started", { jobs: tasks.length });
    return tasks;
}

module.exports = { startScheduler, runScheduledReports };
