const { getOrBuildSnapshot } = require("./reportMemory");
const { computeHealthScore, computeConfidenceScore } = require("../comparison/compare");
const analysisService = require("../ai/analysis.service");
const logger = require("../utils/logger");

/**
 * Report Generator
 *
 * Orchestrates: S3-backed memory (pull from PostHog only if missing)
 * -> deterministic scoring -> AI report generation, for a specific
 * group + period type. This is the shared core used by both the
 * scheduler (automatic weekly/monthly posts) and the bot's on-demand
 * commands (/latest, /weekly, /monthly, /quarterly).
 *
 * @param {string} groupName - Sanitized group identifier.
 * @param {string} reportType - Report audience: founder/marketing/pr/developer.
 * @param {string} periodType - One of latest/weekly/monthly/quarterly.
 * @returns {Promise<{reportText: string, healthScore: object, confidenceScore: number, periodLabel: string}>}
 */
async function generateGroupReport(groupName, reportType, periodType) {
    const { current, comparison } = await getOrBuildSnapshot(groupName, periodType);

    const healthScore = computeHealthScore(current);
    const confidenceScore = computeConfidenceScore(current);

    const reportText = await analysisService.generateReport(reportType, {
        metrics: current,
        comparison,
        healthScore,
        confidenceScore,
    });

    logger.info("Group report generated", { groupName, reportType, periodType });

    return { reportText, healthScore, confidenceScore, current, comparison };
}

module.exports = { generateGroupReport };
