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
 * @param {string} reportType - Report audience: board/marketing/pr/development (or legacy founder/developer).
 * @param {string} periodType - One of latest/weekly/monthly/quarterly.
 * @param {object} [options]
 * @param {boolean} [options.expanded] - Request a longer /details-style report.
 * @returns {Promise<{reportText: string, healthScore: object, confidenceScore: number, current: object, comparison: object}>}
 */
async function generateGroupReport(groupName, reportType, periodType, options = {}) {
    const { current, comparison } = await getOrBuildSnapshot(groupName, periodType);

    const healthScore = computeHealthScore(current);
    const confidenceScore = computeConfidenceScore(current);

    const reportText = await analysisService.generateReport(reportType, {
        metrics: current,
        comparison,
        healthScore,
        confidenceScore,
        periodType,
        expanded: Boolean(options.expanded),
    });

    logger.info("Group report generated", { groupName, reportType, periodType });

    return { reportText, healthScore, confidenceScore, current, comparison };
}

module.exports = { generateGroupReport };
