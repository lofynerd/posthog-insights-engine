const posthog = require("../services/posthog.service");
const queries = require("../queries/conversion.queries");

function rows(result) {
    return result.results || [];
}

/**
 * Collect funnel and conversion-by-source metrics for a report window.
 *
 * Purchase/revenue figures use order_completed — fired server-side
 * from the Stripe webhook (tomasi-design's payment.controller.js)
 * only after payment is confirmed. This is the source of truth for
 * completed sales: unlike checkout_initiated, it can't be inflated
 * by abandoned checkouts, and it isn't affected by ad-blockers or a
 * customer closing the tab before the client-side success page loads.
 *
 * @param {number} days - Lookback window in days.
 * @param {number} [offsetDays=0] - Shift the window into the past.
 * @returns {Promise<object>} Structured conversion metrics.
 */
async function collect(days, offsetDays = 0) {
    const [funnelResult, bySourceResult, revenueResult, revenueByCustomerResult, topProductsResult] =
        await Promise.all([
            posthog.runHogQL(queries.funnelCounts(days, offsetDays)),
            posthog.runHogQL(queries.conversionBySource(days, 10, offsetDays)),
            posthog.runHogQL(queries.revenueTotals(days, offsetDays)),
            posthog.runHogQL(queries.revenueByCustomerType(days, offsetDays)),
            posthog.runHogQL(queries.topProductsByCartValue(days, 10, offsetDays)),
        ]);

    const funnelRow = rows(funnelResult)[0] || [0, 0, 0, 0, 0, 0];
    const [pageviews, productViews, addToCart, checkoutInitiated, purchases, cartRemoved] = funnelRow;

    const conversionRate = pageviews > 0 ? Number((purchases / pageviews).toFixed(4)) : null;
    const productViewToCartRate =
        productViews > 0 ? Number((addToCart / productViews).toFixed(4)) : null;
    const cartToCheckoutRate =
        addToCart > 0 ? Number((checkoutInitiated / addToCart).toFixed(4)) : null;
    const checkoutToPurchaseRate =
        checkoutInitiated > 0 ? Number((purchases / checkoutInitiated).toFixed(4)) : null;

    const revenueRow = rows(revenueResult)[0] || [null, 0, null];
    const [totalRevenue, orderCount, avgOrderValue] = revenueRow;

    return {
        pageviews: pageviews ?? 0,
        productViews: productViews ?? 0,
        addToCart: addToCart ?? 0,
        checkoutInitiated: checkoutInitiated ?? 0,
        purchases: purchases ?? 0,
        cartRemoved: cartRemoved ?? 0,
        conversionRate,
        productViewToCartRate,
        cartToCheckoutRate,
        checkoutToPurchaseRate,
        // Confirmed revenue from order_completed (Stripe-verified),
        // not an estimate — see module doc comment above.
        revenue: totalRevenue ?? null,
        orderCount: orderCount ?? 0,
        avgOrderValue: avgOrderValue ?? null,
        revenueByCustomerType: rows(revenueByCustomerResult).map(([isGuest, revenue, count]) => ({
            isGuest: String(isGuest) === "true",
            revenue,
            orderCount: count,
        })),
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
