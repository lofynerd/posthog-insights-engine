/**
 * Shared HogQL date-range helper.
 *
 * Every domain query needs to filter events to a window, optionally
 * offset into the past (e.g. "the 7 days before the last 7 days" for
 * week-over-week comparison). Centralizing this avoids each query
 * file reinventing (and potentially mis-escaping) interval math.
 *
 * Only ever called with integers we control (report period
 * definitions), never with raw user input — but validated anyway as
 * defense in depth, since this string is interpolated directly into
 * HogQL.
 */
function sanitizeDays(value, fallback) {
    return Number.isInteger(value) && value > 0 && value <= 3650 ? value : fallback;
}

/**
 * @param {number} windowDays - Length of the window in days.
 * @param {number} [offsetDays=0] - How many days back the window ends
 *   (0 = window ends now; windowDays = the period immediately before
 *   the current one, for period-over-period comparison).
 * @returns {string} A HogQL WHERE-clause fragment filtering `timestamp`.
 */
function dateRangeClause(windowDays, offsetDays = 0) {
    const safeWindow = sanitizeDays(windowDays, 30);
    const safeOffset = sanitizeDays(offsetDays, 0);

    if (safeOffset === 0) {
        return `timestamp >= now() - INTERVAL ${safeWindow} DAY`;
    }

    const totalBack = safeWindow + safeOffset;
    return `timestamp >= now() - INTERVAL ${totalBack} DAY AND timestamp < now() - INTERVAL ${safeOffset} DAY`;
}

module.exports = { dateRangeClause };
