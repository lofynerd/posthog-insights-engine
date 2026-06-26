const latestPageview = `
SELECT
    timestamp,
    properties.$browser,
    properties.$device_type,
    properties.$geoip_country_name,
    properties.$referring_domain,
    properties.$current_url,
    properties.$session_entry_url
FROM events
WHERE event = '$pageview'
ORDER BY timestamp DESC
LIMIT 20
`;

module.exports = {
    latestPageview,
};