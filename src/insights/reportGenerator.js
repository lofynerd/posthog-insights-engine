const { getOrBuildSnapshot, PERIOD_DEFINITIONS } = require("./reportMemory");
const { computeHealthScore, computeConfidenceScore } = require("../comparison/compare");
const analysisService = require("../ai/analysis.service");
const { normalizeReportType } = require("../ai/reportTypes");
const logger = require("../utils/logger");

// Audiences whose scheduled/on-demand reports should include
// Instagram performance data -- marketing and PR care about social
// reach/engagement, board and development don't (per Tomasi AI's
// per-audience focus). Any group can still pull Instagram data
// directly via /social regardless of its registered report type;
// this only controls what's folded into the automatic summaries.
const SOCIAL_REPORT_TYPES = ["marketing", "pr"];

// How many recent posts to analyze for the report's social section.
// Kept smaller than /social's default (10) since this data feeds a
// compact report section, not a dedicated deep-dive.
const REPORT_SOCIAL_POST_LIMIT = 5;

/**
 * Best-effort Instagram metrics for a report's period window. Never
 * throws -- a failed/unconfigured Instagram integration should omit
 * the social section from the report, not block report generation
 * for marketing/PR groups that otherwise have nothing to do with
 * Instagram being down.
 * @private
 */
async function collectSocialForReport(periodType) {
    const { days } = PERIOD_DEFINITIONS[periodType] || PERIOD_DEFINITIONS.weekly;

    try {
        // Lazily required, same rationale as bot.js's /social command:
        // a missing INSTAGRAM_* credential should only affect reports
        // for the two audiences that need it, not module loading for
        // every report type.
        const socialMetrics = require("../metrics/social");
        return await socialMetrics.collectInstagram(days, REPORT_SOCIAL_POST_LIMIT);
    } catch (error) {
        logger.warn("Failed to collect Instagram metrics for report, omitting social section", error.message);
        return null;
    }
}

/**
 * Report Generator
 *
 * Orchestrates: S3-backed memory (pull from PostHog only if missing)
 * -> deterministic scoring -> AI report generation, for a specific
 * group + period type. This is the shared core used by both the
 * scheduler (automatic weekly/monthly posts) and the bot's on-demand
 * commands (/latest, /weekly, /monthly, /quarterly).
 *
 * Instagram data is deliberately fetched here (live, per call) rather
 * than folded into collectAll()'s cached PostHog snapshot: that
 * snapshot is intentionally shared across every audience for a group
 * (see reportMemory.js), so gating it there would mean whichever
 * audience happens to request a report first decides whether every
 * other audience's cached view includes Instagram data too. Fetching
 * it here, keyed off the actual requested reportType, keeps the
 * inclusion decision deterministic per report instead of accidental.
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

    const canonicalReportType = normalizeReportType(reportType);
    let metrics = current;

    if (SOCIAL_REPORT_TYPES.includes(canonicalReportType)) {
        const social = await collectSocialForReport(periodType);
        if (social) {
            metrics = { ...current, social };
        }
    }

    const healthScore = computeHealthScore(metrics);
    const confidenceScore = computeConfidenceScore(metrics);

    const reportText = await analysisService.generateReport(reportType, {
        metrics,
        comparison,
        healthScore,
        confidenceScore,
        periodType,
        expanded: Boolean(options.expanded),
    });

    logger.info("Group report generated", { groupName, reportType, periodType });

    return { reportText, healthScore, confidenceScore, current: metrics, comparison };
}

module.exports = { generateGroupReport, SOCIAL_REPORT_TYPES };
