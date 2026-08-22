const posthog = require("../services/posthog.service");
const queries = require("../queries/conversion.queries");

function rows(result) {
    return result.results || [];
}

/**
 * Compute ROI from revenue and cost.
 *
 * Returns null (never a number) when cost is zero, missing, or
 * negative -- (revenue - 0) / 0 is mathematically undefined/infinite,
 * and displaying it as a number would misrepresent a campaign with no
 * recorded cost as having "infinite" or otherwise meaningless return.
 * Callers should render null as "N/A", never as 0% or ∞%.
 *
 * @param {number} revenue
 * @param {number|null|undefined} cost
 * @returns {number|null} ROI as a percentage, rounded to 1 decimal.
 */
function computeRoiPercent(revenue, cost) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) {
        return null;
    }
    return Number((((revenue - cost) / cost) * 100).toFixed(1));
}

/**
 * Collect a full influencer campaign performance record, structured
 * as:
 *
 *   Campaign
 *   ├── Influencer
 *   ├── Code
 *   ├── Cost
 *   ├── Orders
 *   ├── Units sold
 *   ├── Revenue
 *   ├── Conversion rate
 *   └── ROI
 *
 * Combines two independent signals, joined only by the campaign's
 * slug/code pair:
 * - Reach (top-of-funnel): click-throughs on the tracked short link,
 *   via utm_campaign, set by tomasi-design's redirect handler.
 * - Purchases (bottom-of-funnel): confirmed orders redeeming this
 *   influencer's promo code, via order_completed.promo_code, set by
 *   the Stripe webhook once payment is confirmed.
 *
 * A visitor can click the link without buying (counted in reach only),
 * or buy using the code without having clicked the tracked link at
 * all (counted in purchases only) -- both are legitimate scenarios,
 * and this module does not assume one implies the other.
 *
 * @param {object} influencer - { name, platform, slug, code, agreedFee } from tomasi-design's influencer record.
 * @param {number|null} [days] - Lookback window in days, or null for all-time (the collaboration's full lifetime).
 * @returns {Promise<object>} Structured campaign performance record (see shape above).
 */
async function collect(influencer, days = null) {
    const { name, platform, slug, code, agreedFee } = influencer;

    const [reachResult, purchasesResult] =
        days === null
            ? await Promise.all([
                  posthog.runHogQL(queries.campaignReachAllTime(slug)),
                  posthog.runHogQL(queries.campaignPurchasesAllTime(code)),
              ])
            : await Promise.all([
                  posthog.runHogQL(queries.campaignReach(slug, days, 0)),
                  posthog.runHogQL(queries.campaignPurchases(code, days, 0)),
              ]);

    const [reach, pageviews] = rows(reachResult)[0] || [0, 0];
    const [orderCount, totalRevenue, avgOrderValue, unitsSold] = rows(purchasesResult)[0] || [0, null, null, null];

    const revenue = totalRevenue ?? 0;
    const conversionRate = reach > 0 ? Number((orderCount / reach).toFixed(4)) : null;

    // Cost is only meaningful once an agreed fee is recorded. null/0/
    // negative all resolve to "no usable cost figure" -- see
    // computeRoiPercent's doc comment for why this must not become a
    // misleading 0-cost, "infinite" ROI.
    const cost = typeof agreedFee === "number" && agreedFee > 0 ? agreedFee : null;
    const roiPercent = computeRoiPercent(revenue, cost);
    const profit = cost !== null ? Number((revenue - cost).toFixed(2)) : null;

    return {
        campaign: {
            slug,
            periodDays: days,
        },
        influencer: {
            name,
            platform,
        },
        code,
        cost,
        orders: orderCount ?? 0,
        unitsSold: unitsSold ?? 0,
        revenue,
        avgOrderValue: avgOrderValue ?? null,
        conversionRate,
        roiPercent,
        profit,
        reach,
        pageviews,

        // Flat aliases kept for backwards compatibility with existing
        // callers (src/notifications/bot.js's /campaign command) that
        // were written against the pre-nested shape. New code should
        // prefer the nested fields above.
        agreedFee: cost,
        orderCount: orderCount ?? 0,
    };
}

module.exports = { collect, computeRoiPercent };
