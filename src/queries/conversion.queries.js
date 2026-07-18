const { dateRangeClause } = require("./dateRange");

/**
 * HogQL queries — Conversion domain (funnels, cart, checkout).
 */

// Full funnel: visitor -> product view -> add to cart -> checkout ->
// purchase. There is no distinct "purchase completed" event in the
// current schema, so checkout_initiated with a total_value is used
// as the purchase proxy (see revenueTotals below) — this is an
// approximation and the report prompt is told to treat it as such.
const funnelCounts = (days, offsetDays = 0) => `
SELECT
    countIf(event = '$pageview') AS pageviews,
    countIf(event = '$pageview' AND properties.$pathname LIKE '/products%') AS product_views,
    countIf(event = 'product_added_to_cart') AS add_to_cart,
    countIf(event = 'checkout_initiated') AS checkout_initiated,
    countIf(event = 'cart_item_removed') AS cart_removed
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
`;

const conversionBySource = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$referring_domain, '(direct)') AS source,
    countIf(event = '$pageview') AS visits,
    countIf(event = 'checkout_initiated') AS conversions
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event IN ('$pageview', 'checkout_initiated')
GROUP BY source
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

// Revenue indicator: sum of total_value on checkout_initiated events.
// This is the closest available revenue signal in the current
// PostHog schema (no dedicated "purchase" event with confirmed
// payment yet) — treated as an estimate, not confirmed revenue.
const revenueTotals = (days, offsetDays = 0) => `
SELECT
    sum(toFloat(properties.total_value)) AS total_value,
    count() AS checkout_count,
    avg(toFloat(properties.total_value)) AS avg_order_value
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = 'checkout_initiated'
    AND properties.total_value IS NOT NULL
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

module.exports = {
    funnelCounts,
    conversionBySource,
    revenueTotals,
    topProductsByCartValue,
};
