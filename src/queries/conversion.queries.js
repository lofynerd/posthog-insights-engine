const { dateRangeClause } = require("./dateRange");

/**
 * HogQL queries — Conversion domain (funnels, cart, checkout).
 */

// Full funnel: visitor -> product view -> add to cart -> checkout ->
// purchase. "purchase" uses order_completed, which is fired
// server-side from the Stripe webhook (tomasi-design's
// payment.controller.js) — it only fires once Stripe confirms
// payment, so unlike checkout_initiated it can't be inflated by
// abandoned checkouts or double-count client-side retries.
const funnelCounts = (days, offsetDays = 0) => `
SELECT
    countIf(event = '$pageview') AS pageviews,
    countIf(event = '$pageview' AND properties.$pathname LIKE '/products%') AS product_views,
    countIf(event = 'product_added_to_cart') AS add_to_cart,
    countIf(event = 'checkout_initiated') AS checkout_initiated,
    countIf(event = 'order_completed') AS purchases,
    countIf(event = 'cart_item_removed') AS cart_removed
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
`;

const conversionBySource = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$referring_domain, '(direct)') AS source,
    countIf(event = '$pageview') AS visits,
    countIf(event = 'order_completed') AS conversions
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event IN ('$pageview', 'order_completed')
GROUP BY source
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

// Revenue indicator: sum of `revenue` on order_completed events. This
// is the source-of-truth revenue signal — order_completed only fires
// after Stripe confirms payment (server-side webhook), so it reflects
// actual completed sales, not abandoned/initiated checkouts, and
// isn't affected by ad-blockers or a customer closing the tab before
// the client-side success page loads.
const revenueTotals = (days, offsetDays = 0) => `
SELECT
    sum(toFloat(properties.revenue)) AS total_revenue,
    count() AS order_count,
    avg(toFloat(properties.revenue)) AS avg_order_value
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = 'order_completed'
    AND properties.revenue IS NOT NULL
`;

// Guest vs. identified-user purchase split — useful for both
// marketing (how much revenue depends on account creation) and board
// reports (guest checkout adoption).
const revenueByCustomerType = (days, offsetDays = 0) => `
SELECT
    toString(coalesce(properties.is_guest, false)) AS is_guest,
    sum(toFloat(properties.revenue)) AS total_revenue,
    count() AS order_count
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = 'order_completed'
GROUP BY is_guest
`;

const topProductsByCartValue = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.product_name, 'Unknown') AS product,
    sum(toFloat(properties.price)) AS total_price,
    count() AS times_added
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = 'product_added_to_cart'
GROUP BY product
ORDER BY total_price DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

// NOTE: order_completed.properties.items is a nested JSON array
// (see tomasi-design/server/controllers/payment.controller.js) and
// would be the ideal source for a "top products by actual revenue"
// breakdown. That's deliberately not implemented here yet — flattening
// a nested array in HogQL/ClickHouse needs to be verified against a
// live project (the API key available while writing this was
// rejected by PostHog), and shipping unverified array-handling SQL
// risks silently returning wrong numbers rather than an obvious
// error. topProductsByCartValue above (cart-add intent) remains the
// available product-level signal until this is verified and added.

module.exports = {
    funnelCounts,
    conversionBySource,
    revenueTotals,
    revenueByCustomerType,
    topProductsByCartValue,
};
