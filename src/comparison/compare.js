/**
 * Comparison Engine
 *
 * Pure functions that compare two metric snapshots (current vs.
 * previous period) and produce percentage changes, a business health
 * score, and a confidence score.
 *
 * Rule (docs/ARCHITECTURE.md): comparison never calls AI and never
 * queries PostHog directly — it only operates on already-collected,
 * structured metric objects.
 */

function safePercentChange(current, previous) {
    if (typeof current !== "number" || typeof previous !== "number") {
        return null;
    }
    if (previous === 0) {
        return current === 0 ? 0 : null; // undefined growth from a zero baseline
    }
    return Number((((current - previous) / previous) * 100).toFixed(1));
}

/**
 * Compare two full metrics snapshots (as produced by
 * src/insights/collector.js) and return a structured diff.
 *
 * @param {object} current - Current period metrics.
 * @param {object|null} previous - Previous period metrics, or null if unavailable.
 * @returns {object} Comparison result.
 */
function compareSnapshots(current, previous) {
    if (!previous) {
        return {
            hasBaseline: false,
            changes: {},
        };
    }

    const changes = {
        uniqueVisitorsChangePct: safePercentChange(
            current.acquisition?.uniqueVisitors,
            previous.acquisition?.uniqueVisitors
        ),
        pageviewsChangePct: safePercentChange(
            current.acquisition?.pageviews,
            previous.acquisition?.pageviews
        ),
        conversionRateChangePct: safePercentChange(
            current.conversion?.conversionRate,
            previous.conversion?.conversionRate
        ),
        bounceRateChangePct: safePercentChange(
            current.engagement?.bounceRate,
            previous.engagement?.bounceRate
        ),
        audienceGrowthTrendChangePct: safePercentChange(
            current.geography?.audienceGrowthTrendPct,
            previous.geography?.audienceGrowthTrendPct
        ),
    };

    return {
        hasBaseline: true,
        previousCollectedAt: previous.collectedAt,
        changes,
    };
}

/**
 * Business health score (0-100), calculated deterministically from
 * measured metrics — never by the AI — per the architecture
 * principle that confidence/scoring is app logic, not AI output.
 *
 * This is a simple weighted heuristic intended as a directional
 * signal for the Founder report, not a precise KPI.
 */
function computeHealthScore(metrics) {
    let score = 50; // neutral baseline
    const notes = [];

    const conversionRate = metrics.conversion?.conversionRate;
    if (typeof conversionRate === "number") {
        if (conversionRate >= 0.02) {
            score += 15;
        } else if (conversionRate >= 0.005) {
            score += 5;
        } else {
            score -= 10;
            notes.push("Conversion rate is low");
        }
    }

    const bounceRate = metrics.engagement?.bounceRate;
    if (typeof bounceRate === "number") {
        if (bounceRate <= 0.3) {
            score += 10;
        } else if (bounceRate <= 0.5) {
            score += 0;
        } else {
            score -= 10;
            notes.push("Bounce rate is high");
        }
    }

    const growthTrend = metrics.geography?.audienceGrowthTrendPct;
    if (typeof growthTrend === "number") {
        if (growthTrend > 10) {
            score += 15;
        } else if (growthTrend > 0) {
            score += 5;
        } else if (growthTrend < -10) {
            score -= 15;
            notes.push("Audience growth is declining");
        }
    }

    const rageClicks = metrics.engagement?.rageClicks;
    if (typeof rageClicks === "number" && rageClicks > 10) {
        score -= 5;
        notes.push("Elevated rage clicks detected");
    }

    return {
        score: Math.max(0, Math.min(100, Math.round(score))),
        notes,
    };
}

/**
 * Confidence score (0-100) reflecting how much data backs the
 * report — calculated by the app from data volume, never by the AI,
 * per the architecture principle that confidence is measurable, not
 * a model's self-assessment.
 */
function computeConfidenceScore(metrics) {
    const pageviews = metrics.acquisition?.pageviews ?? 0;
    const visitors = metrics.acquisition?.uniqueVisitors ?? 0;
    const sessions = metrics.engagement?.totalSessions ?? 0;

    let score = 0;
    if (pageviews >= 1000) score += 40;
    else if (pageviews >= 200) score += 25;
    else if (pageviews >= 50) score += 10;

    if (visitors >= 100) score += 30;
    else if (visitors >= 30) score += 15;
    else if (visitors >= 5) score += 5;

    if (sessions >= 100) score += 30;
    else if (sessions >= 30) score += 15;
    else if (sessions >= 5) score += 5;

    return Math.max(0, Math.min(100, score));
}

module.exports = {
    safePercentChange,
    compareSnapshots,
    computeHealthScore,
    computeConfidenceScore,
};
