const uniqueVisitors = `
SELECT
    count(DISTINCT person_id)
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
`;

module.exports = {
    uniqueVisitors,
};