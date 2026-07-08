const { dateRangeClause } = require("./dateRange");

/**
 * HogQL queries — Conversion domain (funnels, cart, checkout).
 */

const funnelCounts = (days, offsetDays = 0) => `
SELECT
    countIf(event = '$pageview') AS pageviews,
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

module.exports = {
    funnelCounts,
    conversionBySource,
};
