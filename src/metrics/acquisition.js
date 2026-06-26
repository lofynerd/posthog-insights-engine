const posthog = require("../services/posthog.service");
const queries = require("../queries/acquisition.queries");

/**
 * Get the number of unique visitors over the configured query window.
 *
 * @returns {Promise<number>} Unique visitor count.
 */
async function getUniqueVisitors() {
    const result = await posthog.runHogQL(
        queries.uniqueVisitors
    );

    return result.results[0][0];
}

module.exports = {
    getUniqueVisitors,
};
