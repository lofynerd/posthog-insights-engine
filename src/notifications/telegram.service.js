const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
// Hard ceiling on total message size to send in one call, independent
// of chunking, so a runaway AI response can't trigger an unbounded
// number of outbound requests (spam / cost / rate-limit risk).
const MAX_TOTAL_MESSAGE_LENGTH = 20_000;
const CHAT_ID_PATTERN = /^-?\d+$/;

/**
 * Telegram Notification Service
 *
 * Sends formatted reports to a Telegram chat (user, group, or channel)
 * using the Telegram Bot API.
 *
 * Follows the architecture principle: notifications only deliver,
 * they never calculate or analyze.
 */
class TelegramService {
    constructor(telegramConfig = config.notifications.telegram) {
        this.config = telegramConfig;

        if (!this.config.botToken) {
            throw new Error("TelegramService requires TELEGRAM_BOT_TOKEN to be configured");
        }

        this.client = axios.create({
            baseURL: `https://api.telegram.org/bot${this.config.botToken}`,
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxBodyLength: MAX_RESPONSE_BYTES,
            maxRedirects: 0,
        });
    }

    /**
     * Send a text message to the configured Telegram chat.
     *
     * @param {string} message - The message text to send (Markdown supported).
     * @param {string|number} [chatId] - Override chat ID (user, group, or channel).
     * @returns {Promise<object>} Telegram API response(s).
     */
    async sendMessage(message, chatId) {
        const to = String(chatId || this.config.chatId);

        if (!to || to === "undefined") {
            throw new Error("Telegram chat ID is not configured");
        }

        if (!CHAT_ID_PATTERN.test(to)) {
            throw new Error("Telegram chat ID must be numeric (e.g. -100123456789)");
        }

        if (typeof message !== "string" || message.length === 0) {
            throw new Error("Telegram message must be a non-empty string");
        }

        const bounded =
            message.length > MAX_TOTAL_MESSAGE_LENGTH
                ? `${message.slice(0, MAX_TOTAL_MESSAGE_LENGTH)}\n\n[truncated: report exceeded size limit]`
                : message;

        // Telegram has a 4096 character limit per message.
        const chunks = this._splitMessage(bounded, 4000);

        const results = [];
        for (const chunk of chunks) {
            const result = await this._send(chunk, to);
            results.push(result);
        }

        logger.info(`Telegram message sent (${chunks.length} part(s))`);
        return results;
    }

    /**
     * Send a single message chunk via the Telegram Bot API.
     * Falls back to plain text if Markdown parsing fails.
     * @private
     */
    async _send(text, chatId) {
        const sanitized = this._sanitizeMarkdown(text);

        try {
            const response = await this.client.post("/sendMessage", {
                chat_id: chatId,
                text: sanitized,
                parse_mode: "Markdown",
                disable_web_page_preview: true,
            });

            return response.data;
        } catch (error) {
            const isParseError = error.response?.data?.description?.includes(
                "can't parse entities"
            );

            if (isParseError) {
                logger.warn(
                    "Telegram Markdown parsing failed, retrying as plain text"
                );
                try {
                    const response = await this.client.post("/sendMessage", {
                        chat_id: chatId,
                        text,
                        disable_web_page_preview: true,
                    });
                    return response.data;
                } catch (fallbackError) {
                    logger.error(
                        "Telegram plain text fallback also failed",
                        fallbackError.response?.data || fallbackError.message
                    );
                    throw new Error("Telegram message delivery failed");
                }
            }

            logger.error(
                "Telegram message failed",
                error.response?.data || error.message
            );
            throw new Error("Telegram message delivery failed");
        }
    }

    /**
     * Normalize common Markdown issues that break Telegram's legacy
     * Markdown parser (unbalanced or nested entities).
     * @private
     */
    _sanitizeMarkdown(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, "*$1*") // ** bold ** -> * bold *
            .replace(/^#{1,6}\s+/gm, "") // strip markdown headers
            .replace(/^[ \t]*[-*]\s+/gm, "• "); // normalize list markers
    }

    /**
     * Split a long message into chunks at newline boundaries.
     * @private
     */
    _splitMessage(message, maxLength) {
        if (message.length <= maxLength) {
            return [message];
        }

        const chunks = [];
        let remaining = message;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                chunks.push(remaining);
                break;
            }

            let splitIndex = remaining.lastIndexOf("\n", maxLength);
            if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
                splitIndex = remaining.lastIndexOf(" ", maxLength);
            }
            if (splitIndex === -1) {
                splitIndex = maxLength;
            }

            chunks.push(remaining.slice(0, splitIndex));
            remaining = remaining.slice(splitIndex).trimStart();
        }

        return chunks;
    }
}

module.exports = new TelegramService();
module.exports.TelegramService = TelegramService;
