require("dotenv").config();
const axios = require("axios");

async function testConnection() {
    try {
        const response = await axios.get(
            `https://us.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`
                }
            }
        );

        console.log(response.data);
    } catch (error) {
        console.error(error.response?.data || error.message);
    }
}

testConnection();
