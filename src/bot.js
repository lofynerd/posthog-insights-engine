const fs = require("fs");
const config = require("./config");
const logger = require("./utils/logger");
const { createBot } = require("./notifications/bot");
const { startScheduler } = require("./scheduler/scheduledReports");

// Path written to periodically while the bot's long-polling loop is
// alive. The container HEALTHCHECK (see Dockerfile) checks this
// file's mtime instead of a port, since this process has no HTTP
// server — it's a long-polling Telegram client + cron scheduler.
const HEARTBEAT_PATH = process.env.HEARTBEAT_PATH || "/tmp/bot-heartbeat";
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Bot entrypoint.
 *
 * Run with: node src/bot.js
 *
 * Launches the interactive Telegram bot (long polling) plus the
 * weekly/monthly automatic report scheduler. Intended to run as a
 * long-lived process (e.g. a small always-on container/VM), distinct
 * from src/pipeline.js which is a one-shot script suited to a
 * scheduled Lambda invocation.
 */
function main() {
    if (!config.notifications.telegram.botToken) {
        logger.error("TELEGRAM_BOT_TOKEN is not configured. Aborting.");
        process.exit(1);
    }

    const bot = createBot();
    const scheduledTasks = startScheduler(bot);

    bot.launch();
    logger.info("Telegram bot launched (long polling)");

    const heartbeat = setInterval(() => {
        fs.writeFile(HEARTBEAT_PATH, String(Date.now()), (error) => {
            if (error) {
                logger.warn("Failed to write heartbeat file", error.message);
            }
        });
    }, HEARTBEAT_INTERVAL_MS);

    const shutdown = (signal) => {
        logger.info(`Received ${signal}, shutting down...`);
        clearInterval(heartbeat);
        scheduledTasks.forEach((task) => task.stop());
        bot.stop(signal);
        process.exit(0);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) {
    main();
}

module.exports = { main };
