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
 * Conversion rates are USER-BASED: conversionRate measures the ratio
 * of distinct users who purchased to distinct users who visited,
 * not raw event frequencies. A user visiting 10 times counts once
 * as a visitor; a user purchasing twice counts once as a purchaser.
 * This matches standard e-commerce conversion rate definitions and
 * makes the metric comparable to industry benchmarks.
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

    const funnelRow = rows(funnelResult)[0] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const [
        uniqueVisitors,
        uniqueProductViewers,
        uniqueCartUsers,
        uniqueCheckoutUsers,
        uniquePurchasers,
        pageviews,
        productViews,
        addToCart,
        checkoutInitiated,
        purchases,
        cartRemoved,
    ] = funnelRow;

    // User-based conversion rate: distinct users who purchased / distinct users who visited
    // This is the standard e-commerce conversion rate metric
    const conversionRate = uniqueVisitors > 0 ? Number((uniquePurchasers / uniqueVisitors).toFixed(4)) : null;
    
    // Funnel stage conversion rates (user-based)
    const productViewToCartRate =
        uniqueProductViewers > 0 ? Number((uniqueCartUsers / uniqueProductViewers).toFixed(4)) : null;
    const cartToCheckoutRate =
        uniqueCartUsers > 0 ? Number((uniqueCheckoutUsers / uniqueCartUsers).toFixed(4)) : null;
    const checkoutToPurchaseRate =
        uniqueCheckoutUsers > 0 ? Number((uniquePurchasers / uniqueCheckoutUsers).toFixed(4)) : null;

    const revenueRow = rows(revenueResult)[0] || [null, 0, null];
    const [totalRevenue, orderCount, avgOrderValue] = revenueRow;

    return {
        // User-based funnel metrics (unique persons at each stage)
        uniqueVisitors: uniqueVisitors ?? 0,
        uniqueProductViewers: uniqueProductViewers ?? 0,
        uniqueCartUsers: uniqueCartUsers ?? 0,
        uniqueCheckoutUsers: uniqueCheckoutUsers ?? 0,
        uniquePurchasers: uniquePurchasers ?? 0,
        // Event-count metrics (preserved for volume analysis)
        pageviews: pageviews ?? 0,
        productViews: productViews ?? 0,
        addToCart: addToCart ?? 0,
        checkoutInitiated: checkoutInitiated ?? 0,
        purchases: purchases ?? 0,
        cartRemoved: cartRemoved ?? 0,
        // User-based conversion rates
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
