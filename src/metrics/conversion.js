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
    const [funnelResult, bySourceResult, revenueResult, topProductsResult] = await Promise.all([
        posthog.runHogQL(queries.funnelCounts(days, offsetDays)),
        posthog.runHogQL(queries.conversionBySource(days, 10, offsetDays)),
        posthog.runHogQL(queries.revenueTotals(days, offsetDays)),
        posthog.runHogQL(queries.topProductsByCartValue(days, 10, offsetDays)),
    ]);

    const funnelRow = rows(funnelResult)[0] || [0, 0, 0, 0, 0];
    const [pageviews, productViews, addToCart, checkoutInitiated, cartRemoved] = funnelRow;

    const conversionRate =
        pageviews > 0 ? Number((checkoutInitiated / pageviews).toFixed(4)) : null;
    const productViewToCartRate =
        productViews > 0 ? Number((addToCart / productViews).toFixed(4)) : null;
    const cartToCheckoutRate =
        addToCart > 0 ? Number((checkoutInitiated / addToCart).toFixed(4)) : null;

    const revenueRow = rows(revenueResult)[0] || [null, 0, null];
    const [totalRevenue, checkoutCount, avgOrderValue] = revenueRow;

    return {
        pageviews: pageviews ?? 0,
        productViews: productViews ?? 0,
        addToCart: addToCart ?? 0,
        checkoutInitiated: checkoutInitiated ?? 0,
        cartRemoved: cartRemoved ?? 0,
        conversionRate,
        productViewToCartRate,
        cartToCheckoutRate,
        // Revenue figures are an estimate derived from checkout_initiated
        // total_value — the schema has no confirmed "payment succeeded"
        // event yet, so this represents initiated, not necessarily
        // completed, revenue.
        estimatedRevenue: totalRevenue ?? null,
        checkoutCount: checkoutCount ?? 0,
        avgOrderValue: avgOrderValue ?? null,
        topProductsByCartValue: rows(topProductsResult).map(([product, totalPrice, timesAdded]) => ({
            product,
            totalPrice,
            timesAdded,
        })),
        conversionBySource: rows(bySourceResult).map(([source, visits, conversions]) => ({
            source,
            visits,
            conversions,
        })),
    };
}

module.exports = { collect };
