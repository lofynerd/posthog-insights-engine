const posthog = require("../services/posthog.service");
const queries = require("../queries/geography.queries");

function rows(result) {
    return result.results || [];
}

/**
 * Collect PR-focused metrics: distinct audience growth, emerging markets,
 * top-performing content, and referral sources.
 *
 * Audience growth measures whether we're reaching more DISTINCT PEOPLE
 * across two comparison periods, not daily activity volume. A person
 * visiting every day counts once per period, not once per day.
 *
 * @param {number} days - Lookback window in days.
 * @param {number} [offsetDays=0] - Shift the window into the past.
 * @returns {Promise<object>} Structured geography/PR metrics.
 */
async function collect(days, offsetDays = 0) {
    // Split the window into two halves for growth comparison
    const halfWindow = Math.floor(days / 2);
    
    const [
        firstHalfResult,
        secondHalfResult,
        activitySeriesResult,
        countriesResult,
        contentResult,
        referralResult,
    ] = await Promise.all([
        // First half: distinct audience
        posthog.runHogQL(queries.distinctAudienceSize(halfWindow, offsetDays + halfWindow)),
        // Second half: distinct audience
        posthog.runHogQL(queries.distinctAudienceSize(halfWindow, offsetDays)),
        // Daily activity series for visualization
        posthog.runHogQL(queries.audienceActivityByDay(days, offsetDays)),
        posthog.runHogQL(queries.emergingCountries(days, 10, offsetDays)),
        posthog.runHogQL(queries.topContentByViews(days, 10, offsetDays)),
        posthog.runHogQL(queries.referralSources(days, 10, offsetDays)),
    ]);

    const firstHalfAudience = rows(firstHalfResult)[0]?.[0] || 0;
    const secondHalfAudience = rows(secondHalfResult)[0]?.[0] || 0;
    
    // Calculate distinct person growth percentage
    const distinctAudienceGrowthPct =
        firstHalfAudience > 0
            ? Number((((secondHalfAudience - firstHalfAudience) / firstHalfAudience) * 100).toFixed(1))
            : null;

    const activitySeries = rows(activitySeriesResult).map(([day, users]) => ({ 
        day, 
        dailyActiveUsers: users 
    }));

    return {
        // Distinct person growth metric (primary PR/marketing growth indicator)
        distinctAudienceGrowthPct,
        firstHalfDistinctAudience: firstHalfAudience,
        secondHalfDistinctAudience: secondHalfAudience,
        // Daily activity series (for visualization/trending)
        dailyActivitySeries: activitySeries,
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
