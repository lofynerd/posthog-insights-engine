const posthog = require("../services/posthog.service");
const queries = require("../queries/acquisition.queries");

/**
 * Get the number of unique visitors over the configured query window.
 * Kept for backwards compatibility with the original pipeline.
 *
 * @returns {Promise<number>} Unique visitor count.
 */
async function getUniqueVisitors() {
    const result = await posthog.runHogQL(queries.uniqueVisitors);
    return result.results[0][0];
}

function rows(result) {
    return result.results || [];
}

/**
 * Collect the full acquisition domain for a given report window.
 *
 * @param {number} days - Lookback window in days.
 * @param {number} [offsetDays=0] - Shift the window into the past
 *   (used to fetch a prior period for comparison).
 * @returns {Promise<object>} Structured acquisition metrics.
 */
async function collect(days, offsetDays = 0) {
    const [visitorsResult, pageviewsResult, channelsResult, utmResult, organicSocialResult, landingPagesResult] =
        await Promise.all([
            posthog.runHogQL(queries.uniqueVisitorsForWindow(days, offsetDays)),
            posthog.runHogQL(queries.pageviewsForWindow(days, offsetDays)),
            posthog.runHogQL(queries.topAcquisitionChannels(days, 10, offsetDays)),
            posthog.runHogQL(queries.trafficByUtmSource(days, 10, offsetDays)),
            posthog.runHogQL(queries.organicVsSocial(days, offsetDays)),
            posthog.runHogQL(queries.topLandingPages(days, 10, offsetDays)),
        ]);

    return {
        uniqueVisitors: rows(visitorsResult)[0]?.[0] ?? 0,
        pageviews: rows(pageviewsResult)[0]?.[0] ?? 0,
        topChannels: rows(channelsResult).map(([source, visits]) => ({ source, visits })),
        topUtmSources: rows(utmResult).map(([source, visits]) => ({ source, visits })),
        organicVsSocial: rows(organicSocialResult).map(([channel, visits]) => ({ channel, visits })),
        topLandingPages: rows(landingPagesResult).map(([path, visits]) => ({ path, visits })),
    };
}

module.exports = {
    getUniqueVisitors,
    collect,
};
