const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

/**
 * Helper script to discover the chat ID for your Telegram bot.
 *
 * Usage:
 * 1. Add @tomasi_analy_bot to your group/channel (or message it directly)
 * 2. Send any message in that chat
 * 3. Run: node src/explorer/getTelegramChatId.js
 * 4. Copy the chat.id value into TELEGRAM_CHAT_ID in your .env
 */
async function getUpdates() {
    if (!config.notifications.telegram.botToken) {
        logger.error("TELEGRAM_BOT_TOKEN is not configured");
        return;
    }

    try {
        const response = await axios.get(
            `https://api.telegram.org/bot${config.notifications.telegram.botToken}/getUpdates`,
            { timeout: 15_000, maxRedirects: 0 }
        );

        const updates = response.data.result;

        if (!updates.length) {
            logger.info(
                "No updates found. Send a message to the bot/group first, then rerun this script."
            );
            return;
        }

        updates.forEach((update) => {
            const chat = update.message?.chat || update.channel_post?.chat;
            if (chat) {
                logger.info(
                    `Chat found: id=${chat.id} type=${chat.type} title=${chat.title || chat.username || chat.first_name || "N/A"}`
                );
            }
        });
    } catch (error) {
        logger.error("Failed to fetch updates", error.response?.data || error.message);
    }
}

getUpdates();
