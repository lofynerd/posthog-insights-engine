const { dateRangeClause } = require("./dateRange");

/**
 * HogQL queries — Acquisition domain.
 *
 * Rule (see docs/ARCHITECTURE.md): this file contains HogQL only.
 * No service imports, no business logic. Every query takes
 * (days, offsetDays) so the same query can fetch the current period
 * or the prior period for comparison — see queries/dateRange.js.
 */

const uniqueVisitors = `
SELECT
    count(DISTINCT person_id)
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
`;

const uniqueVisitorsForWindow = (days, offsetDays = 0) => `
SELECT
    count(DISTINCT person_id)
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
`;

const pageviewsForWindow = (days, offsetDays = 0) => `
SELECT
    count()
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
`;

const topAcquisitionChannels = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.$referring_domain, '(direct)') AS source,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY source
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const trafficByUtmSource = (days, limit = 10, offsetDays = 0) => `
SELECT
    coalesce(properties.utm_source, '(none)') AS utm_source,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY utm_source
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

const organicVsSocial = (days, offsetDays = 0) => `
SELECT
    multiIf(
        properties.$referring_domain LIKE '%google%', 'organic_search',
        properties.$referring_domain LIKE '%instagram%'
            OR properties.$referring_domain LIKE '%facebook%'
            OR properties.$referring_domain LIKE '%tiktok%'
            OR properties.$referring_domain LIKE '%twitter%'
            OR properties.$referring_domain LIKE '%x.com%'
            OR properties.$referring_domain LIKE '%linkedin%', 'social',
        properties.$referring_domain IS NULL, 'direct',
        'other'
    ) AS channel,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
GROUP BY channel
ORDER BY visits DESC
`;

const topLandingPages = (days, limit = 10, offsetDays = 0) => `
SELECT
    properties.$pathname AS path,
    count() AS visits
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
    AND properties.$pathname IS NOT NULL
GROUP BY path
ORDER BY visits DESC
LIMIT ${Number.isInteger(limit) ? limit : 10}
`;

// Sessions is approximated as distinct $session_id values seen on
// pageviews, since PostHog's default schema has no first-class
// "sessions" table available to a HogQL events query here.
const sessionsForWindow = (days, offsetDays = 0) => `
SELECT
    count(DISTINCT properties.$session_id)
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
    AND properties.$session_id IS NOT NULL
`;

// Returning visitors: persons seen in the current window who were
// also seen in the period immediately prior to it (not the same as
// the comparison "previous period" — this always looks at the days
// right before the window regardless of offsetDays, since "returning"
// is a property of the current window's audience).
const returningVisitors = (days, offsetDays = 0) => `
SELECT count(DISTINCT person_id)
FROM events
WHERE ${dateRangeClause(days, offsetDays)}
    AND event = '$pageview'
    AND person_id IN (
        SELECT DISTINCT person_id
        FROM events
        WHERE event = '$pageview'
            AND timestamp < now() - INTERVAL ${Number.isInteger(offsetDays) ? offsetDays : 0} DAY - INTERVAL ${Number.isInteger(days) ? days : 30} DAY
    )
`;

module.exports = {
    uniqueVisitors,
    uniqueVisitorsForWindow,
    pageviewsForWindow,
    topAcquisitionChannels,
    trafficByUtmSource,
    organicVsSocial,
    topLandingPages,
    sessionsForWindow,
    returningVisitors,
};
