const { safePercentChange } = require("../comparison/compare");

/**
 * Insight Selector
 *
 * Deterministically picks the ONE PostHog insight (real chart, from
 * the "Tomasi AI Report Coverage" dashboard -- see
 * scripts/createMissingInsights.js) most worth showing for a given
 * report, based on which underlying metric moved the most between
 * the current and previous period.
 *
 * This is pure app logic -- no AI, no network call. The point is to
 * spend the one AI call a report needs on explaining something that
 * actually happened, instead of the AI (or a template) speculating
 * across every metric regardless of whether it moved.
 *
 * Insight IDs below come from the "Tomasi AI Report Coverage"
 * dashboard (PostHog project 368729, dashboard id 2053640) created by
 * scripts/createMissingInsights.js. If that dashboard is ever rebuilt
 * with different IDs, update this table to match.
 */

// Each entry: which metric path to read off a metrics snapshot
// (dot-path into acquisition/conversion/engagement/geography), the
// matching real PostHog insight ID, a human label for the AI prompt,
// and which report audiences this metric is relevant to. A metric
// absent from a given audience's `audiences` list is never selected
// for that audience's report, even if it moved the most overall.
const METRIC_INSIGHT_MAP = [
    {
        key: "uniqueVisitors",
        path: "acquisition.uniqueVisitors",
        insightId: 8003829,
        label: "Website Unique Users",
        audiences: ["board", "marketing", "pr", "development"],
    },
    {
        key: "pageviews",
        path: "acquisition.pageviews",
        insightId: 8003829,
        label: "Pageviews",
        audiences: ["marketing", "pr"],
    },
    {
        key: "sessions",
        path: "acquisition.sessions",
        insightId: 8003833,
        label: "Sessions Per User",
        audiences: ["marketing", "development"],
    },
    {
        key: "returningVisitorRate",
        path: "acquisition.returningVisitorRate",
        insightId: 8075433,
        label: "Returning vs New Users",
        audiences: ["marketing", "board"],
    },
    {
        key: "conversionRate",
        path: "conversion.conversionRate",
        insightId: 10204190,
        label: "Full Purchase Funnel",
        audiences: ["board", "marketing"],
    },
    {
        key: "revenue",
        path: "conversion.revenue",
        insightId: 10204160,
        label: "Revenue Over Time",
        audiences: ["board"],
    },
    {
        key: "orderCount",
        path: "conversion.orderCount",
        insightId: 10204180,
        label: "Orders Completed",
        audiences: ["board"],
    },
    {
        key: "avgOrderValue",
        path: "conversion.avgOrderValue",
        insightId: 10204181,
        label: "Average Order Value",
        audiences: ["board"],
    },
    {
        key: "bounceRate",
        path: "engagement.bounceRate",
        insightId: 11511098,
        label: "Bounce Rate Trend",
        audiences: ["marketing", "pr", "development"],
    },
    {
        key: "avgPageDurationSeconds",
        path: "engagement.avgPageDurationSeconds",
        insightId: 10204192,
        label: "Average Engagement Time per Page",
        audiences: ["marketing", "pr"],
    },
    {
        key: "webVitalsLcp",
        path: "engagement.webVitals.avgLcpMs",
        insightId: 11511100,
        label: "Core Web Vitals (LCP)",
        audiences: ["development"],
    },
    {
        key: "audienceGrowthTrendPct",
        path: "geography.audienceGrowthTrendPct",
        insightId: 7733457,
        label: "Growth Accounting",
        audiences: ["pr", "board"],
    },
];

// Per-audience fallback insight, used when no metric in scope for
// that audience has BOTH a current and previous value to compare
// (e.g. first-ever report for a group, or every relevant metric is
// genuinely flat/missing). Keeps every report visual, rather than
// only showing a chart on "eventful" periods.
const DEFAULT_INSIGHT_BY_AUDIENCE = {
    board: { insightId: 10204160, label: "Revenue Over Time" },
    marketing: { insightId: 8003829, label: "Website Unique Users" },
    pr: { insightId: 7733457, label: "Growth Accounting" },
    development: { insightId: 11511100, label: "Core Web Vitals (LCP)" },
};

function readPath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
}

/**
 * Pick the single most-relevant, most-moved insight for a report.
 *
 * @param {object} current - Current period metrics snapshot.
 * @param {object|null} previous - Previous period metrics snapshot, or null.
 * @param {string} audience - board/marketing/pr/development (canonical, already normalized).
 * @param {number} [minChangePct=5] - Minimum absolute % change to count as "moved" rather than noise.
 * @returns {{insightId: number, label: string, metricKey: string|null, changePct: number|null, isFallback: boolean}}
 */
function selectInsight(current, previous, audience, minChangePct = 5) {
    const candidates = METRIC_INSIGHT_MAP.filter((entry) => entry.audiences.includes(audience));

    let best = null;
    for (const entry of candidates) {
        const currentValue = readPath(current, entry.path);
        const previousValue = previous ? readPath(previous, entry.path) : undefined;
        const changePct = safePercentChange(currentValue, previousValue);

        if (changePct === null) continue;
        if (!best || Math.abs(changePct) > Math.abs(best.changePct)) {
            best = { ...entry, changePct };
        }
    }

    if (best && Math.abs(best.changePct) >= minChangePct) {
        return {
            insightId: best.insightId,
            label: best.label,
            metricKey: best.key,
            changePct: best.changePct,
            isFallback: false,
        };
    }

    const fallback = DEFAULT_INSIGHT_BY_AUDIENCE[audience] || DEFAULT_INSIGHT_BY_AUDIENCE.board;
    return {
        insightId: fallback.insightId,
        label: fallback.label,
        metricKey: null,
        changePct: null,
        isFallback: true,
    };
}

module.exports = { selectInsight, METRIC_INSIGHT_MAP, DEFAULT_INSIGHT_BY_AUDIENCE };
