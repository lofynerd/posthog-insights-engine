// const posthog = require("./services/posthog.service");

// (async () => {
//     const result = await posthog.runHogQL(`
//         SELECT count(DISTINCT person_id)
//         FROM events
//         WHERE timestamp >= now() - INTERVAL 30 DAY
//     `);

//     console.log(JSON.stringify(result, null, 2));
// })();

const acquisition = require("./metrics/acquisition");

(async () => {

    const users =
        await acquisition.getUniqueVisitors();

    console.log("Unique Visitors:", users);

})();