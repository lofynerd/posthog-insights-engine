const { dateRangeClause } = require("./dateRange");

/**
 * HogQL queries — Engagement domain (device, browser, OS, geography,
 * technical/UX signals). Shared by Marketing, PR, and Developer reports.
 */

const deviceBreakdown = (days, offsetDays = 0) => `
SELECT
    coalesce(properties.$device_type, 'Unknown') AS device,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY device
ORDER BY visits DESC
`;

const browserBreakdown = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$browser, 'Unknown') AS browser,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY browser
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const osBreakdown = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$os, 'Unknown') AS os,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY os
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const screenSizeBreakdown = (days, limit = 10, offsetDays = 0) => `
SELECT
    concat(toString(properties.$screen_width), 'x', toString(properties.$screen_height)) AS resolution,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
    AND properties.$screen_width IS NOT NULL
GROUP BY resolution
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const geographyBreakdown = (days, limit = 10, offsetDays = 0) => `
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

const averageWebVitals = (days, offsetDays = 0) => `
SELECT
    avg(toFloat(properties.$web_vitals_LCP_value)) AS avg_lcp_ms,
    avg(toFloat(properties.$web_vitals_FCP_value)) AS avg_fcp_ms,
    avg(toFloat(properties.$web_vitals_CLS_value)) AS avg_cls,
    avg(toFloat(properties.$web_vitals_INP_value)) AS avg_inp_ms
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$web_vitals'
`;

const rageClickCount = (days, offsetDays = 0) => `
SELECT count()
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$rageclick'
`;

const bounceSignal = (days, offsetDays = 0) => `
SELECT
    countIf(pageviews_in_session = 1) AS single_page_sessions,
    count() AS total_sessions
FROM (
    SELECT
        properties.$session_id AS session_id,
        count() AS pageviews_in_session
    FROM events
    WHERE ${dateRangeClause(days, offsetDays)}
        AND event = '$pageview'
        AND properties.$session_id IS NOT NULL
    GROUP BY session_id
)
`;

module.exports = {
    deviceBreakdown,
    browserBreakdown,
    osBreakdown,
    screenSizeBreakdown,
    geographyBreakdown,
    averageWebVitals,
    rageClickCount,
    bounceSignal,
};
