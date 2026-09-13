/**
 * Evidence Builder
 *
 * Transforms raw metrics and comparisons into structured analytical evidence
 * with clear separation between:
 * - FACTS: Directly measured or calculated values
 * - OBSERVATIONS: Deterministic patterns derived from facts
 * - CONTEXT: Reporting period metadata and supporting information
 *
 * This abstraction ensures AI receives evidence with clear semantic boundaries,
 * making it easier to enforce the FACT/OBSERVATION/POSSIBLE EXPLANATION/
 * RECOMMENDATION structure in generated insights.
 */

/**
 * Format a percentage value for human consumption.
 * Converts 0.6476 → "64.76%", handles null/undefined gracefully.
 * 
 * @param {number|null|undefined} value - Decimal representation (0.6476)
 * @param {number} [decimals=2] - Number of decimal places
 * @returns {string|null} Formatted percentage or null
 */
function formatPercentage(value, decimals = 2) {
    if (value == null || typeof value !== "number") {
        return null;
    }
    return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a number with thousands separators.
 * 1234567 → "1,234,567"
 * 
 * @param {number|null|undefined} value
 * @returns {string|null}
 */
function formatNumber(value) {
    if (value == null || typeof value !== "number") {
        return null;
    }
    return value.toLocaleString("en-US");
}

/**
 * Format currency value.
 * 1234.56 → "$1,234.56"
 * 
 * @param {number|null|undefined} value
 * @returns {string|null}
 */
function formatCurrency(value) {
    if (value == null || typeof value !== "number") {
        return null;
    }
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Determine if a change percentage is material enough to warrant attention.
 * 
 * @param {number|null} changePct - Percentage change
 * @param {number} [threshold=5] - Minimum absolute change to be considered material
 * @returns {boolean}
 */
function isMaterialChange(changePct, threshold = 5) {
    return changePct != null && Math.abs(changePct) >= threshold;
}

/**
 * Assess evidence strength for a metric comparison.
 * 
 * @param {object} options
 * @param {number} options.currentValue - Current period value
 * @param {number|null} options.previousValue - Previous period value (null if no baseline)
 * @param {number} options.sampleSize - Total observations (e.g., sessions, visitors)
 * @param {boolean} options.hasComparison - Whether comparison data exists
 * @returns {"SUPPORTED"|"PLAUSIBLE"|"INSUFFICIENT"} Evidence strength
 */
function assessEvidenceStrength({ currentValue, previousValue, sampleSize, hasComparison }) {
    // No comparison data = insufficient evidence for comparison insights
    if (!hasComparison || previousValue == null) {
        return "INSUFFICIENT";
    }
    
    // Strong evidence: meaningful change with good sample size
    if (sampleSize >= 30 && currentValue != null && previousValue != null) {
        return "SUPPORTED";
    }
    
    // Weak sample size or missing values = plausible at best
    if (sampleSize < 30 || currentValue == null) {
        return "PLAUSIBLE";
    }
    
    return "SUPPORTED";
}

/**
 * Build structured facts from raw metrics.
 * Facts are directly measured or calculated values with human-readable formatting.
 * 
 * @param {object} metrics - Current period metrics from collector.js
 * @param {object} context - Period context
 * @returns {object} Structured facts with formatted values
 */
function buildFacts(metrics, context) {
    const facts = {
        period: {
            type: context.periodType,
            label: context.periodLabel,
            startDate: context.startDate,
            endDate: context.endDate,
        },
        acquisition: {},
        conversion: {},
        engagement: {},
        geography: {},
    };
    
    // Acquisition facts
    if (metrics.acquisition) {
        const acq = metrics.acquisition;
        facts.acquisition = {
            uniqueVisitors: {
                value: acq.uniqueVisitors ?? 0,
                formatted: formatNumber(acq.uniqueVisitors),
                label: "Unique Visitors",
            },
            pageviews: {
                value: acq.pageviews ?? 0,
                formatted: formatNumber(acq.pageviews),
                label: "Pageviews",
            },
            sessions: {
                value: acq.sessions ?? 0,
                formatted: formatNumber(acq.sessions),
                label: "Sessions",
            },
            returningVisitors: {
                value: acq.returningVisitors ?? 0,
                formatted: formatNumber(acq.returningVisitors),
                label: "Returning Visitors",
            },
            returningVisitorRate: {
                value: acq.returningVisitorRate,
                formatted: formatPercentage(acq.returningVisitorRate),
                label: "Returning Visitor Rate",
            },
        };
    }
    
    // Conversion facts
    if (metrics.conversion) {
        const conv = metrics.conversion;
        facts.conversion = {
            uniqueVisitors: {
                value: conv.uniqueVisitors ?? 0,
                formatted: formatNumber(conv.uniqueVisitors),
                label: "Unique Visitors (Funnel)",
            },
            uniquePurchasers: {
                value: conv.uniquePurchasers ?? 0,
                formatted: formatNumber(conv.uniquePurchasers),
                label: "Unique Purchasers",
            },
            conversionRate: {
                value: conv.conversionRate,
                formatted: formatPercentage(conv.conversionRate),
                label: "Conversion Rate",
                definition: "Unique purchasers / Unique visitors",
            },
            revenue: {
                value: conv.revenue,
                formatted: formatCurrency(conv.revenue),
                label: "Total Revenue",
            },
            orderCount: {
                value: conv.orderCount ?? 0,
                formatted: formatNumber(conv.orderCount),
                label: "Orders Completed",
            },
            avgOrderValue: {
                value: conv.avgOrderValue,
                formatted: formatCurrency(conv.avgOrderValue),
                label: "Average Order Value",
            },
            checkoutInitiated: {
                value: conv.checkoutInitiated ?? 0,
                formatted: formatNumber(conv.checkoutInitiated),
                label: "Checkout Initiations",
            },
            uniqueCheckoutUsers: {
                value: conv.uniqueCheckoutUsers ?? 0,
                formatted: formatNumber(conv.uniqueCheckoutUsers),
                label: "Unique Users Who Initiated Checkout",
            },
        };
    }
    
    // Engagement facts
    if (metrics.engagement) {
        const eng = metrics.engagement;
        facts.engagement = {
            bounceRate: {
                value: eng.bounceRate,
                formatted: formatPercentage(eng.bounceRate),
                label: "Bounce Rate",
            },
            totalSessions: {
                value: eng.totalSessions ?? 0,
                formatted: formatNumber(eng.totalSessions),
                label: "Total Sessions",
            },
            rageClicks: {
                value: eng.rageClicks ?? 0,
                formatted: formatNumber(eng.rageClicks),
                label: "Rage Clicks",
            },
            avgPageDurationSeconds: {
                value: eng.avgPageDurationSeconds,
                formatted: eng.avgPageDurationSeconds != null 
                    ? `${Math.round(eng.avgPageDurationSeconds)}s`
                    : null,
                label: "Average Page Duration",
            },
        };
    }
    
    // Geography/audience facts
    if (metrics.geography) {
        const geo = metrics.geography;
        facts.geography = {
            distinctAudienceGrowthPct: {
                value: geo.distinctAudienceGrowthPct,
                formatted: geo.distinctAudienceGrowthPct != null 
                    ? `${geo.distinctAudienceGrowthPct > 0 ? "+" : ""}${geo.distinctAudienceGrowthPct}%`
                    : null,
                label: "Distinct Audience Growth",
                definition: "Growth in unique people reached (not daily activity volume)",
            },
            firstHalfAudience: {
                value: geo.firstHalfDistinctAudience ?? 0,
                formatted: formatNumber(geo.firstHalfDistinctAudience),
                label: "First Half Distinct Audience",
            },
            secondHalfAudience: {
                value: geo.secondHalfDistinctAudience ?? 0,
                formatted: formatNumber(geo.secondHalfDistinctAudience),
                label: "Second Half Distinct Audience",
            },
        };
    }
    
    return facts;
}

/**
 * Build structured observations from facts and comparisons.
 * Observations are deterministic patterns derived from facts.
 * 
 * @param {object} facts - Structured facts from buildFacts()
 * @param {object} comparison - Comparison result from compare.js
 * @param {object} metrics - Raw metrics for cross-referencing
 * @returns {object} Structured observations
 */
function buildObservations(facts, comparison, metrics) {
    const observations = [];
    
    if (!comparison || !comparison.hasBaseline) {
        observations.push({
            type: "NO_BASELINE",
            text: "No previous period data available for comparison",
            evidenceStrength: "INSUFFICIENT",
        });
        return observations;
    }
    
    const changes = comparison.changes || {};
    
    // Conversion funnel observation
    if (metrics.conversion && facts.conversion) {
        const conv = metrics.conversion;
        const checkoutUsers = conv.uniqueCheckoutUsers ?? 0;
        const purchasers = conv.uniquePurchasers ?? 0;
        
        if (checkoutUsers > 0 && purchasers === 0) {
            observations.push({
                type: "CHECKOUT_WITHOUT_PURCHASE",
                text: `${checkoutUsers} users initiated checkout and 0 users completed an order during the period`,
                evidenceStrength: "SUPPORTED",
                metric: "conversion",
                facts: {
                    checkoutUsers,
                    purchasers,
                },
            });
        }
    }
    
    // Unique visitor vs returning visitor observation
    if (metrics.acquisition && facts.acquisition) {
        const acq = metrics.acquisition;
        const unique = acq.uniqueVisitors ?? 0;
        const returning = acq.returningVisitors ?? 0;
        const newVisitorCount = unique - returning;
        
        if (unique > 0) {
            observations.push({
                type: "VISITOR_COMPOSITION",
                text: `${returning} returning visitors and ${newVisitorCount} visitors appeared for the first time this period (total: ${unique} unique visitors)`,
                evidenceStrength: "SUPPORTED",
                metric: "acquisition",
                facts: {
                    uniqueVisitors: unique,
                    returningVisitors: returning,
                    newVisitors: newVisitorCount,
                },
            });
        }
    }
    
    // Material change observations
    if (changes.conversionRateChangePct != null && isMaterialChange(changes.conversionRateChangePct)) {
        const direction = changes.conversionRateChangePct > 0 ? "increased" : "decreased";
        observations.push({
            type: "CONVERSION_RATE_CHANGE",
            text: `Conversion rate ${direction} ${Math.abs(changes.conversionRateChangePct).toFixed(1)}% versus the previous period`,
            evidenceStrength: assessEvidenceStrength({
                currentValue: metrics.conversion?.conversionRate,
                previousValue: 1, // placeholder, real previous value not passed here
                sampleSize: metrics.conversion?.uniqueVisitors ?? 0,
                hasComparison: true,
            }),
            metric: "conversion",
            changePct: changes.conversionRateChangePct,
        });
    }
    
    if (changes.bounceRateChangePct != null && isMaterialChange(changes.bounceRateChangePct)) {
        const direction = changes.bounceRateChangePct > 0 ? "increased" : "decreased";
        observations.push({
            type: "BOUNCE_RATE_CHANGE",
            text: `Bounce rate ${direction} ${Math.abs(changes.bounceRateChangePct).toFixed(1)}% versus the previous period`,
            evidenceStrength: assessEvidenceStrength({
                currentValue: metrics.engagement?.bounceRate,
                previousValue: 1,
                sampleSize: metrics.engagement?.totalSessions ?? 0,
                hasComparison: true,
            }),
            metric: "engagement",
            changePct: changes.bounceRateChangePct,
        });
    }
    
    if (changes.distinctAudienceGrowthChangePct != null && isMaterialChange(changes.distinctAudienceGrowthChangePct)) {
        const direction = changes.distinctAudienceGrowthChangePct > 0 ? "increased" : "decreased";
        observations.push({
            type: "AUDIENCE_GROWTH_CHANGE",
            text: `Distinct audience growth ${direction} ${Math.abs(changes.distinctAudienceGrowthChangePct).toFixed(1)}% versus the previous period`,
            evidenceStrength: assessEvidenceStrength({
                currentValue: metrics.geography?.distinctAudienceGrowthPct,
                previousValue: 1,
                sampleSize: metrics.geography?.secondHalfDistinctAudience ?? 0,
                hasComparison: true,
            }),
            metric: "geography",
            changePct: changes.distinctAudienceGrowthChangePct,
        });
    }
    
    return observations;
}

/**
 * Build complete analytical evidence payload from raw metrics and comparison.
 * 
 * @param {object} metrics - Current period metrics from collector.js
 * @param {object} previous - Previous period metrics (for comparison)
 * @param {object} comparison - Comparison result from compare.js
 * @param {object} periodContext - Period metadata
 * @returns {object} Complete evidence payload
 */
function buildEvidence(metrics, previous, comparison, periodContext) {
    const facts = buildFacts(metrics, periodContext);
    const observations = buildObservations(facts, comparison, metrics);
    
    return {
        context: {
            reportType: periodContext.reportType,
            periodType: periodContext.periodType,
            periodLabel: periodContext.periodLabel,
            currentPeriod: {
                startDate: periodContext.startDate,
                endDate: periodContext.endDate,
            },
            previousPeriod: comparison?.hasBaseline ? {
                startDate: periodContext.previousStartDate,
                endDate: periodContext.previousEndDate,
            } : null,
            collectedAt: metrics.collectedAt,
        },
        facts,
        observations,
        // Raw metrics still included for AI to cross-reference (but structured evidence is primary)
        rawMetrics: metrics,
        rawComparison: comparison,
    };
}

module.exports = {
    buildEvidence,
    buildFacts,
    buildObservations,
    formatPercentage,
    formatNumber,
    formatCurrency,
    isMaterialChange,
    assessEvidenceStrength,
};
