const posthog = require("../services/posthog.service");
const queries = require("../queries/geography.queries");

function rows(result) {
    return result.results || [];
}

/**
 * Collect PR-focused metrics: audience growth trend, emerging markets,
 * top-performing content, and referral sources.
 *
 * @param {number} days - Lookback window in days.
 * @param {number} [offsetDays=0] - Shift the window into the past.
 * @returns {Promise<object>} Structured geography/PR metrics.
 */
async function collect(days, offsetDays = 0) {
    const [growthResult, countriesResult, contentResult, referralResult] = await Promise.all([
        posthog.runHogQL(queries.audienceGrowthByDay(days, offsetDays)),
        posthog.runHogQL(queries.emergingCountries(days, 10, offsetDays)),
        posthog.runHogQL(queries.topContentByViews(days, 10, offsetDays)),
        posthog.runHogQL(queries.referralSources(days, 10, offsetDays)),
    ]);

    const growthSeries = rows(growthResult).map(([day, visitors]) => ({ day, visitors }));
    const firstHalf = growthSeries.slice(0, Math.floor(growthSeries.length / 2));
    const secondHalf = growthSeries.slice(Math.floor(growthSeries.length / 2));
    const sum = (arr) => arr.reduce((acc, item) => acc + (item.visitors || 0), 0);
    const firstHalfTotal = sum(firstHalf);
    const secondHalfTotal = sum(secondHalf);
    const growthTrendPct =
        firstHalfTotal > 0
            ? Number((((secondHalfTotal - firstHalfTotal) / firstHalfTotal) * 100).toFixed(1))
            : null;

    return {
        audienceGrowthSeries: growthSeries,
        audienceGrowthTrendPct: growthTrendPct,
        topCountries: rows(countriesResult).map(([country, visitors]) => ({ country, visitors })),
        topContent: rows(contentResult).map(([path, views, uniqueViewers]) => ({
            path,
            views,
            uniqueViewers,
        })),
        referralSources: rows(referralResult).map(([referrer, uniqueVisitors]) => ({
            referrer,
            uniqueVisitors,
        })),
    };
}

module.exports = { collect };
