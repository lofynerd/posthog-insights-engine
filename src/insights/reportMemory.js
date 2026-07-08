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
        logger.info("Loaded cached snapshot from S3", { groupName, periodType, dateKey });
    } else {
        logger.info("No cached snapshot found, querying PostHog", { groupName, periodType, dateKey });
        current = await collectAll(days, 0);

        try {
            await s3Snapshot.putSnapshot({ groupName, reportType: periodType, dateKey, payload: current });
        } catch (error) {
            // Storage failing to write memory shouldn't block report
            // delivery — log and continue with an in-memory-only result.
            logger.warn("Failed to persist snapshot, continuing without memory", error.message);
        }
    }

    // Previous period: try S3 memory first (in case a prior run
    // already snapshotted it under yesterday's/last week's date),
    // otherwise pull it fresh via an offset query. This is not
    // itself cached under a "previous" key — the previous period's
    // own daily snapshot is what future runs will hit as `current`.
    let previous = null;
    try {
        previous = await collectAll(days, days);
    } catch (error) {
        logger.warn("Failed to collect previous period for comparison", error.message);
    }

    const comparison = compareSnapshots(current, previous);

    return { current, previous, comparison };
}

module.exports = { getOrBuildSnapshot, resolvePeriod, PERIOD_DEFINITIONS };
