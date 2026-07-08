const acquisition = require("./metrics/acquisition");
const conversion = require("./metrics/conversion");
const engagement = require("./metrics/engagement");
const geography = require("./metrics/geography");
const analysisService = require("./ai/analysis.service");
const telegramService = require("./notifications/telegram.service");
const groupRegistry = require("./notifications/groupRegistry");
const { collectAll } = require("./insights/collector");
const { getOrBuildSnapshot } = require("./insights/reportMemory");
const { generateGroupReport } = require("./insights/reportGenerator");
const { run: runPipeline } = require("./pipeline");
const { createBot } = require("./notifications/bot");

module.exports = {
    acquisition,
    conversion,
    engagement,
    geography,
    analysisService,
    telegramService,
    groupRegistry,
    collectAll,
    getOrBuildSnapshot,
    generateGroupReport,
    runPipeline,
    createBot,
};
