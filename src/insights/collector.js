const acquisition = require("../metrics/acquisition");
const engagement = require("../metrics/engagement");
const conversion = require("../metrics/conversion");
const geography = require("../metrics/geography");
const logger = require("../utils/logger");

// Hard ceiling on the report window. Prevents an accidental or
// malicious request (e.g. via the future Q&A bot) from forcing an
// enormous, expensive HogQL scan across all-time data.
const MAX_WINDOW_DAYS = 400;

/**
 * Insights Collector
 *
 * Gathers all PostHog metric domains into a single structured object
 * ready for AI analysis, snapshotting, or comparison.
 *
 * @param {number} [days=30] - Lookback window in days.
 * @returns {Promise<object>} Structured metrics across all domains.
 */
async function collectAll(days = 30, offsetDays = 0) {
    const safeDays = Number.isInteger(days) && days > 0 && days <= MAX_WINDOW_DAYS ? days : 30;
    const safeOffset =
        Number.isInteger(offsetDays) && offsetDays >= 0 && offsetDays <= MAX_WINDOW_DAYS
            ? offsetDays
            : 0;

    logger.info("Collecting PostHog insights...", { windowDays: safeDays, offsetDays: safeOffset });

    const results = {
        collectedAt: new Date().toISOString(),
        windowDays: safeDays,
        offsetDays: safeOffset,
        acquisition: {},
        conversion: {},
        engagement: {},
        geography: {},
    };

    const domains = [
        ["acquisition", acquisition],
        ["conversion", conversion],
        ["engagement", engagement],
        ["geography", geography],
    ];

    // Run domains independently so one failing query domain doesn't
    // take down the whole report; each failure is captured and
    // surfaced instead of silently producing an incomplete report.
    await Promise.all(
        domains.map(async ([name, module_]) => {
            try {
                results[name] = await module_.collect(safeDays, safeOffset);
            } catch (error) {
                logger.warn(`Failed to collect ${name} metrics`, error.message);
                results[name] = { error: error.message };
            }
        })
    );

    logger.info("Insights collection complete");
    return results;
}

module.exports = { collectAll, MAX_WINDOW_DAYS };
