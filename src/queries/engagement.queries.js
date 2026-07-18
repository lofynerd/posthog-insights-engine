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

// $pageleave carries $prev_pageview_duration (seconds spent on the
// page being left) and $prev_pageview_pathname (the page that was
// exited from), which together give us average session/page duration
// and a real exit-page breakdown without needing a separate sessions table.
//
// Durations above 30 minutes are excluded: these are almost always a
// tab left open in the background rather than genuine engaged time,
// and including them skews the average by orders of magnitude.
const MAX_REALISTIC_DURATION_SECONDS = 1800;

const averagePageDuration = (days, offsetDays = 0) => `
SELECT avg(toFloat(properties.$prev_pageview_duration))
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageleave'
    AND properties.$prev_pageview_duration IS NOT NULL
    AND toFloat(properties.$prev_pageview_duration) <= ${MAX_REALISTIC_DURATION_SECONDS}
`;

const topExitPages = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$prev_pageview_pathname, properties.$pathname) AS path,
    count() AS exits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageleave'
GROUP BY path
ORDER BY exits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const longestSessions = (days, limit = 5, offsetDays = 0) => `
SELECT
    coalesce(properties.$prev_pageview_pathname, properties.$pathname) AS path,
    toFloat(properties.$prev_pageview_duration) AS duration_seconds
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageleave'
    AND properties.$prev_pageview_duration IS NOT NULL
    AND toFloat(properties.$prev_pageview_duration) <= ${MAX_REALISTIC_DURATION_SECONDS}
ORDER BY duration_seconds DESC
LIMIT ${Number.isInteger(limit) ? limit : 5}
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
    averagePageDuration,
    topExitPages,
    longestSessions,
};
