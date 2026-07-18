/**
 * Shared Telegram message formatting helpers.
 *
 * Centralizes message splitting and Markdown sanitization so the
 * interactive bot (src/notifications/bot.js) and the scheduler
 * (src/scheduler/scheduledReports.js) can't drift out of sync on
 * chunking behavior.
 */

const MAX_TELEGRAM_MESSAGE = 4000;

/**
 * True if `text.slice(0, index)` ends inside an unclosed ``` fence
 * (i.e. an odd number of ``` markers precede it). AI reports may
 * include fenced ASCII diagrams, and splitting a message mid-fence
 * breaks Markdown rendering for the rest of that message.
 */
function isInsideFence(text, index) {
    const fenceCount = (text.slice(0, index).match(/```/g) || []).length;
    return fenceCount % 2 === 1;
}

/**
 * Split a long message into Telegram-sized chunks (max 4096 chars
 * per message; 4000 used here for safety margin), preferring to
 * break on paragraph/line boundaries and never splitting inside an
 * open code fence.
 */
function splitForTelegram(text, maxLength = MAX_TELEGRAM_MESSAGE) {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks = [];
    let remaining = text;

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

        if (isInsideFence(remaining, splitIndex)) {
            const fenceStart = remaining.lastIndexOf("```", splitIndex);
            if (fenceStart > 0) {
                splitIndex = fenceStart;
            }
        }

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
}

/**
 * Normalize common Markdown issues that break Telegram's legacy
 * Markdown parser (unbalanced or nested entities, unsupported
 * heading/list syntax).
 */
function sanitizeMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, "*$1*") // ** bold ** -> * bold *
        .replace(/^#{1,6}\s+/gm, "") // strip markdown headers (kept as plain "#" text by the prompt)
        .replace(/^[ \t]*[-*]\s+/gm, "• "); // normalize list markers
}

module.exports = { splitForTelegram, sanitizeMarkdown, isInsideFence, MAX_TELEGRAM_MESSAGE };
