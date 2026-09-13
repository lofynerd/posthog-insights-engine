/**
 * Insight Eligibility
 * 
 * Deterministic checks to determine whether an insight should be generated
 * before spending tokens on AI. Prevents false alarms and exaggerated
 * conclusions when evidence is too weak.
 */

/**
 * Check if metrics have sufficient sample size for reliable insights.
 * 
 * @param {object} metrics - Current period metrics
 * @returns {object} { eligible: boolean, reason: string }
 */
function checkSampleSize(metrics) {
    const visitors = metrics.acquisition?.uniqueVisitors ?? 0;
    const sessions = metrics.engagement?.totalSessions ?? 0;
    const pageviews = metrics.acquisition?.pageviews ?? 0;
    
    // Minimum thresholds for meaningful analysis
    if (visitors < 5 && sessions < 5 && pageviews < 10) {
        return {
            eligible: false,
            reason: "Insufficient sample size for reliable insights (< 5 visitors, < 5 sessions, < 10 pageviews)",
        };
    }
    
    return { eligible: true, reason: null };
}

/**
 * Check if comparison is valid for insights that require baseline.
 * 
 * @param {object} comparison - Comparison result from compare.js
 * @returns {object} { eligible: boolean, reason: string }
 */
function checkComparisonAvailability(comparison) {
    if (!comparison || !comparison.hasBaseline) {
        return {
            eligible: false,
            reason: "No previous period data available for comparison",
        };
    }
    
    return { eligible: true, reason: null };
}

/**
 * Check if there are any material changes worth analyzing.
 * If nothing moved significantly, a report becomes less valuable.
 * 
 * @param {object} comparison - Comparison result from compare.js
 * @param {number} [threshold=5] - Minimum change percentage to consider material
 * @returns {object} { eligible: boolean, reason: string, materialChanges: array }
 */
function checkMaterialChanges(comparison, threshold = 5) {
    if (!comparison || !comparison.hasBaseline || !comparison.changes) {
        return {
            eligible: true, // If no comparison, we still generate a snapshot report
            reason: null,
            materialChanges: [],
        };
    }
    
    const changes = comparison.changes;
    const materialChanges = [];
    
    Object.keys(changes).forEach((key) => {
        const value = changes[key];
        if (value != null && Math.abs(value) >= threshold) {
            materialChanges.push({ metric: key, changePct: value });
        }
    });
    
    return {
        eligible: true, // Even with no material changes, we report "stable"
        reason: null,
        materialChanges,
    };
}

/**
 * Check if conversion funnel has valid data.
 * Prevents generating conversion insights when funnel tracking is broken.
 * 
 * @param {object} metrics - Current period metrics
 * @returns {object} { eligible: boolean, reason: string }
 */
function checkConversionFunnelValidity(metrics) {
    if (!metrics.conversion) {
        return { eligible: false, reason: "No conversion data available" };
    }
    
    const conv = metrics.conversion;
    const visitors = conv.uniqueVisitors ?? 0;
    const purchasers = conv.uniquePurchasers ?? 0;
    
    // If we have visitors but funnel metrics seem broken
    if (visitors > 0 && conv.uniqueProductViewers === undefined) {
        return {
            eligible: false,
            reason: "Conversion funnel tracking may be incomplete",
        };
    }
    
    // Conversion rate calculation validity
    if (visitors === 0 && purchasers > 0) {
        return {
            eligible: false,
            reason: "Invalid conversion data: purchasers exist but no visitors recorded",
        };
    }
    
    return { eligible: true, reason: null };
}

/**
 * Check if a specific observation should generate an insight.
 * 
 * @param {object} observation - Observation from evidence layer
 * @returns {object} { eligible: boolean, reason: string }
 */
function checkObservationEligibility(observation) {
    // Always eligible for critical issues
    if (observation.type === "CHECKOUT_WITHOUT_PURCHASE") {
        return { eligible: true, reason: null };
    }
    
    // Insufficient evidence observations should not generate speculative insights
    if (observation.evidenceStrength === "INSUFFICIENT") {
        return {
            eligible: false,
            reason: "Evidence strength is insufficient for reliable insight",
        };
    }
    
    // Plausible observations can generate hedged insights
    if (observation.evidenceStrength === "PLAUSIBLE") {
        return {
            eligible: true,
            reason: "Generate hedged insight - evidence is plausible but not strong",
        };
    }
    
    return { eligible: true, reason: null };
}

/**
 * Comprehensive eligibility check for report generation.
 * 
 * @param {object} metrics - Current period metrics
 * @param {object} comparison - Comparison result
 * @param {object} evidence - Evidence from evidence layer
 * @returns {object} { eligible: boolean, issues: array, warnings: array }
 */
function checkReportEligibility(metrics, comparison, evidence) {
    const issues = [];
    const warnings = [];
    
    // Check sample size
    const sampleCheck = checkSampleSize(metrics);
    if (!sampleCheck.eligible) {
        issues.push(sampleCheck.reason);
    }
    
    // Check conversion funnel validity
    const conversionCheck = checkConversionFunnelValidity(metrics);
    if (!conversionCheck.eligible) {
        warnings.push(conversionCheck.reason);
    }
    
    // Check for material changes
    const changesCheck = checkMaterialChanges(comparison);
    if (changesCheck.materialChanges.length === 0 && comparison?.hasBaseline) {
        warnings.push("No material changes detected - report will focus on stable metrics");
    }
    
    // Filter eligible observations
    let eligibleObservations = [];
    if (evidence && evidence.observations) {
        eligibleObservations = evidence.observations.filter((obs) => {
            const check = checkObservationEligibility(obs);
            if (!check.eligible && check.reason) {
                warnings.push(`Skipping ${obs.type}: ${check.reason}`);
            }
            return check.eligible;
        });
    }
    
    return {
        eligible: issues.length === 0,
        issues,
        warnings,
        eligibleObservations,
        materialChanges: changesCheck.materialChanges,
    };
}

module.exports = {
    checkSampleSize,
    checkComparisonAvailability,
    checkMaterialChanges,
    checkConversionFunnelValidity,
    checkObservationEligibility,
    checkReportEligibility,
};
