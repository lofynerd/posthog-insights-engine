const posthog = require("../services/posthog.service");
const queries = require("../queries/conversion.queries");

function rows(result) {
    return result.results || [];
}

/**
 * Collect funnel and conversion-by-source metrics for a report window.
 *
 * @param {number} days - Lookback window in days.
 * @param {number} [offsetDays=0] - Shift the window into the past.
 * @returns {Promise<object>} Structured conversion metrics.
 */
async function collect(days, offsetDays = 0) {
    const [funnelResult, bySourceResult] = await Promise.all([
        posthog.runHogQL(queries.funnelCounts(days, offsetDays)),
        posthog.runHogQL(queries.conversionBySource(days, 10, offsetDays)),
    ]);

    const funnelRow = rows(funnelResult)[0] || [0, 0, 0, 0];
    const [pageviews, addToCart, checkoutInitiated, cartRemoved] = funnelRow;

    const conversionRate =
        pageviews > 0 ? Number((checkoutInitiated / pageviews).toFixed(4)) : null;

    return {
        pageviews: pageviews ?? 0,
        addToCart: addToCart ?? 0,
        checkoutInitiated: checkoutInitiated ?? 0,
        cartRemoved: cartRemoved ?? 0,
        conversionRate,
        conversionBySource: rows(bySourceResult).map(([source, visits, conversions]) => ({
            source,
            visits,
            conversions,
        })),
    };
}

module.exports = { collect };
