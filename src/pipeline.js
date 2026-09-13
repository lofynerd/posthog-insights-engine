const crypto = require("crypto");
const config = require("./config");
const { collectAll } = require("./insights/collector");
const { computeHealthScore, computeConfidenceScore } = require("./comparison/compare");
const analysisService = require("./ai/analysis.service");
const telegramService = require("./notifications/telegram.service");
const { isValidReportType } = require("./ai/reportTypes");
const logger = require("./utils/logger");

/**
 * Legacy single-chat pipeline.
 *
 * STATUS: MAINTAINED - This pipeline remains functional and is intentionally
 * preserved as a simpler alternative to the full bot infrastructure.
 *
 * USE CASES:
 * - Simple one-shot scheduled jobs (cron/Lambda) with no group registry
 * - Single-chat deployments that don't need multi-group support
 * - Stateless execution environments
 * - Testing/debugging without bot infrastructure
 *
 * IMPORTANT: This pipeline does NOT use S3-backed memory or historical
 * snapshots. Each execution queries PostHog directly with no caching.
 * For production multi-group deployments with memory and comparison,
 * use src/bot.js + src/insights/reportGenerator.js instead.
 *
 * Orchestrates the full flow for the original single-group setup:
 * 1. Collect PostHog insights (metrics layer)
 * 2. Compute deterministic health/confidence scores
 * 3. Send to AI for report generation
 * 4. Forward the AI report to Telegram
 *
 * METRICS: This pipeline uses the same corrected metrics as the bot:
 * - User-based conversion rate (unique purchasers / unique visitors)
 * - Distinct audience growth (not daily activity volume)
 * - Historical comparison via offset queries (not S3 snapshots)
 */
async function run(options = {}) {
    const { audience = "founder", chatId } = options;

    if (!isValidReportType(audience)) {
        throw new Error(`Invalid audience/report type: "${audience}"`);
    }

    // Fail fast: verify all required secrets/config are present before
    // making a single outbound call. Avoids partial side effects
    // (e.g. querying PostHog, then failing on a missing Telegram token
    // after the AI call already spent tokens).
    config.assertPipelineReady();

    // Correlation id ties together the log lines for a single run
    // without exposing any secret material, useful when scaling to
    // concurrent/scheduled executions.
    const runId = crypto.randomUUID();

    logger.info("Pipeline started", { runId, audience });

    try {
        // Step 1: Collect all PostHog metrics
        const metrics = await collectAll(30);
        logger.info("Metrics collected", {
            runId,
            acquisition: metrics.acquisition,
        });

        // Step 2: Deterministic scoring (never computed by the AI)
        const healthScore = computeHealthScore(metrics);
        const confidenceScore = computeConfidenceScore(metrics);

        // Step 3: AI report generation
        const report = await analysisService.generateReport(audience, {
            metrics,
            comparison: null,
            healthScore,
            confidenceScore,
        });
        logger.info("AI report generated", {
            runId,
            reportLength: report.length,
        });

        // Step 4: Send to Telegram
        const header = `📊 *PostHog Insights Report*\n📅 ${new Date().toLocaleDateString("en-GB")}\n👤 Audience: ${audience}\n${"─".repeat(30)}\n\n`;
        const fullMessage = header + report;

        const result = await telegramService.sendMessage(fullMessage, chatId);
        logger.info("Report delivered to Telegram", { runId });

        return {
            runId,
            metrics,
            report,
            healthScore,
            confidenceScore,
            delivery: result,
        };
    } catch (error) {
        // Re-throw with the run id attached so operators can correlate
        // a failure with the exact log lines for that execution,
        // without ever attaching raw provider error bodies here (those
        // are already logged, redacted, by each service).
        logger.error("Pipeline run failed", { runId, error: error.message });
        throw error;
    }
}

// Allow direct execution: node src/pipeline.js
if (require.main === module) {
    run()
        .then(() => {
            logger.info("Pipeline completed successfully");
            process.exit(0);
        })
        .catch((error) => {
            logger.error("Pipeline failed", error.message);
            process.exit(1);
        });
}

module.exports = { run };
