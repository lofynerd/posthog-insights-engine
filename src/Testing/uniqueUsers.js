require("dotenv").config();
const axios = require("axios");

async function getUniqueUsers() {

    const query = {
        query: {
            kind: "HogQLQuery",
            query: `
                SELECT
                    count(DISTINCT person_id)
                FROM events
                WHERE timestamp >= now() - INTERVAL 30 DAY
            `
        }
    };

    try {

        const response = await axios.post(
            `https://us.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}/query`,
            query,
            {
                headers: {
                    Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log(JSON.stringify(response.data,null,2));

    } catch(err) {

        console.error(err.response?.data || err.message);

    }
}

getUniqueUsers();