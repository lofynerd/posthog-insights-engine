const posthog = require("../services/posthog.service");
const queries = require("../queries/acquisition.queries");

async function getUniqueVisitors() {

    const result = await posthog.runHogQL(
        queries.uniqueVisitors
    );

    return result.results[0][0];

}

module.exports = {
    getUniqueVisitors,
};