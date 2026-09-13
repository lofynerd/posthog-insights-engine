const { collectAll } = require("./collector");
const s3Snapshot = require("../storage/s3Snapshot.service");
const { compareSnapshots } = require("../comparison/compare");
const logger = require("../utils/logger");

/**
 * Report Memory
 *
 * Gives the AI "memory" across report runs:
 * 1. Check S3 for an existing snapshot for the requested period.
 * 2. If missing, pull fresh data from PostHog and store it.
 * 3. Also fetch (or compute) the previous period's snapshot so the
 *    report can compare current vs. previous and show real deltas
 *    instead of a single point-in-time reading.
 *
 * Snapshots are keyed by group name + report period type (daily,
 * weekly, monthly, quarterly), never by report audience — the same
 * underlying metrics snapshot is reused across founder/marketing/
 * PR/developer reports for a given group, since they all describe
 * the same analytics window. Only the AI prompt differs per audience.
 */

const PERIOD_DEFINITIONS = {
    latest: { days: 1, label: "Today" },
    weekly: { days: 7, label: "This week" },
    monthly: { days: 30, label: "This month" },
    quarterly: { days: 90, label: "This quarter" },
};

function resolvePeriod(periodType) {
    const definition = PERIOD_DEFINITIONS[periodType];
    if (!definition) {
        throw new Error(
            `Invalid period "${periodType}". Allowed: ${Object.keys(PERIOD_DEFINITIONS).join(", ")}`
        );
    }
    return definition;
}

function todayDateKey() {
    return new Date().toISOString().split("T")[0];
}

/**
 * Calculate the date key for the previous period snapshot.
 * For a given current date and period length, this determines what
 * date key would have been used when that previous period was "current".
 * 
 * @param {string} currentDateKey - ISO date string (YYYY-MM-DD)
 * @param {number} days - Period length in days
 * @returns {string} ISO date string for previous period's snapshot
 */
function calculatePreviousDateKey(currentDateKey, days) {
    const current = new Date(currentDateKey);
    // Move back by the period length to get the date when the previous
    // period would have been stored as "current"
    const previous = new Date(current);
    previous.setDate(previous.getDate() - days);
    return previous.toISOString().split("T")[0];
}

/**
 * Get (or build) the current-period snapshot for a group, using S3
 * as a cache keyed by calendar date so re-running the same report
 * on the same day doesn't re-query PostHog unnecessarily.
 *
 * @param {string} groupName - Sanitized group identifier (see groupRegistry.js).
 * @param {string} periodType - One of "latest", "weekly", "monthly", "quarterly".
 * @returns {Promise<{current: object, previous: object|null, comparison: object}>}
 */
async function getOrBuildSnapshot(groupName, periodType) {
    const { days } = resolvePeriod(periodType);
    const dateKey = todayDateKey();

    let current = await s3Snapshot.getSnapshot({ groupName, reportType: periodType, dateKey });

    if (current) {
        logger.info("Loaded cached current snapshot from S3", { groupName, periodType, dateKey });
    } else {
        logger.info("No cached snapshot found, querying PostHog for current period", { groupName, periodType, dateKey });
        current = await collectAll(days, 0);

        try {
            await s3Snapshot.putSnapshot({ groupName, reportType: periodType, dateKey, payload: current });
            logger.info("Stored current snapshot to S3", { groupName, periodType, dateKey });
        } catch (error) {
            // Storage failing to write memory shouldn't block report
            // delivery — log and continue with an in-memory-only result.
            logger.warn("Failed to persist snapshot, continuing without memory", error.message);
        }
    }

    // Previous period: Try to use the historical snapshot from S3 first.
    // This implements true immutable snapshot-based comparison.
    let previous = null;
    const previousDateKey = calculatePreviousDateKey(dateKey, days);
    
    try {
        previous = await s3Snapshot.getSnapshot({ 
            groupName, 
            reportType: periodType, 
            dateKey: previousDateKey 
        });
        
        if (previous) {
            logger.info("Loaded previous period from historical snapshot", { 
                groupName, 
                periodType, 
                previousDateKey 
            });
        } else {
            // Historical snapshot doesn't exist - fall back to live query
            // This happens for the first few reports before history builds up
            logger.info("No historical snapshot found, querying PostHog for previous period", {
                groupName,
                periodType,
                previousDateKey,
            });
            previous = await collectAll(days, days);
        }
    } catch (error) {
        logger.warn("Failed to collect previous period for comparison", error.message);
    }

    const comparison = compareSnapshots(current, previous);

    return { current, previous, comparison };
}

module.exports = { getOrBuildSnapshot, resolvePeriod, PERIOD_DEFINITIONS };
