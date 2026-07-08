const cron = require("node-cron");
const groupRegistry = require("../notifications/groupRegistry");
const { generateGroupReport } = require("../insights/reportGenerator");
const logger = require("../utils/logger");

const MAX_TELEGRAM_MESSAGE = 4000;

function splitForTelegram(text) {
    if (text.length <= MAX_TELEGRAM_MESSAGE) return [text];
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

/**
 * Send a scheduled report to every registered group for a given
 * period type. Each group's failure is isolated so one bad group
 * (e.g. a stale registration) doesn't block delivery to the others.
 *
 * @param {import("telegraf").Telegraf} bot
 * @param {string} periodType - weekly | monthly | quarterly
 */
async function runScheduledReports(bot, periodType) {
    const groups = await groupRegistry.listGroups();
    logger.info(`Running ${periodType} scheduled reports`, { groupCount: groups.length });

    for (const group of groups) {
        try {
            const { reportText } = await generateGroupReport(
                group.groupName,
                group.reportType,
                periodType
            );

            const header = `📊 *${periodType.toUpperCase()} REPORT* — ${group.groupName}\n${"─".repeat(24)}\n\n`;
            const chunks = splitForTelegram(header + reportText);

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
 * Register cron jobs for weekly and monthly automatic reports.
 * Quarterly is intentionally left to on-demand /quarterly only,
 * since a 90-day cadence rarely aligns usefully with a fixed cron
 * schedule — add one here later if a fixed quarterly cadence is wanted.
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

    logger.info("Scheduler started", { jobs: tasks.length });
    return tasks;
}

module.exports = { startScheduler, runScheduledReports };
