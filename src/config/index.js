require("dotenv").config();

const config = {
    app: {
        environment: process.env.NODE_ENV || "development",
        logLevel: process.env.LOG_LEVEL || "info",
    },
    posthog: {
        apiKey: process.env.POSTHOG_API_KEY,
        projectId: process.env.POSTHOG_PROJECT_ID,
        host: process.env.POSTHOG_HOST || "https://us.posthog.com",
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
    },
    notifications: {
        slackBotToken: process.env.SLACK_BOT_TOKEN,
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    },
    aws: {
        region: process.env.AWS_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
};

module.exports = config;
