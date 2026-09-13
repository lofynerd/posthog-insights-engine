const { dateRangeClause } = require("./dateRange");

/**
 * HogQL queries — Geography / PR domain (audience growth, viral
 * content detection, emerging markets, referral sources).
 */

// Distinct audience size for a time window (used for growth comparison)
const distinctAudienceSize = (days, offsetDays = 0) => `
SELECT
    count(DISTINCT person_id) AS unique_people
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
`;

// Daily audience activity series (for visualization/trending, not growth calculation)
const audienceActivityByDay = (days, offsetDays = 0) => `
SELECT
    toDate(timestamp) AS day,
    count(DISTINCT person_id) AS daily_active_users
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY day
ORDER BY day ASC
`;

const emergingCountries = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$geoip_country_name, 'Unknown') AS country,
    count(DISTINCT person_id) AS visitors
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY country
ORDER BY visitors DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const topContentByViews = (days, limit = 10, offsetDays = 0) => `
SELECT
    properties.$pathname AS path,
    count() AS views,
    count(DISTINCT person_id) AS unique_viewers
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
    AND properties.$pathname IS NOT NULL
GROUP BY path
ORDER BY views DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const referralSources = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$referring_domain, '(direct)') AS referrer,
    count(DISTINCT person_id) AS unique_visitors
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
    AND properties.$referring_domain IS NOT NULL
    AND properties.$referring_domain != ''
GROUP BY referrer
ORDER BY unique_visitors DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

module.exports = {
    distinctAudienceSize,
    audienceActivityByDay,
    emergingCountries,
    topContentByViews,
    referralSources,
};
