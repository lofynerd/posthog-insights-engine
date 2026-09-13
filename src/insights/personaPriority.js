/**
 * Persona Priority
 * 
 * Role-specific metric prioritization for evidence-based reporting.
 * Different audiences care about different metrics - this module determines
 * which facts and observations should be emphasized for each report type.
 * 
 * The same underlying data may appear in multiple reports, but the analytical
 * focus and recommendation emphasis differs by audience.
 */

/**
 * Metric importance weights by persona.
 * Higher weight = more relevant to this audience.
 * Scale: 0 (irrelevant) to 10 (critical).
 */
const PERSONA_PRIORITIES = {
    board: {
        // Board/founder cares about business health, revenue, growth, strategic risks
        revenue: 10,
        conversionRate: 9,
        orderCount: 9,
        avgOrderValue: 8,
        distinctAudienceGrowthPct: 9,
        healthScore: 10,
        confidenceScore: 7,
        uniqueVisitors: 7,
        returningVisitorRate: 6,
        bounceRate: 6,
        rageClicks: 7,
        // Less interested in technical details
        webVitals: 3,
        deviceBreakdown: 3,
        browserBreakdown: 2,
    },
    marketing: {
        // Marketing cares about acquisition, campaigns, conversion, traffic quality
        uniqueVisitors: 10,
        distinctAudienceGrowthPct: 9,
        conversionRate: 10,
        bounceRate: 8,
        topChannels: 9,
        topUtmSources: 9,
        topLandingPages: 8,
        returningVisitorRate: 7,
        revenue: 8,
        orderCount: 8,
        avgOrderValue: 7,
        // Moderate interest in technical
        rageClicks: 6,
        webVitals: 5,
        deviceBreakdown: 6,
        // Not focused on infrastructure
        healthScore: 6,
        confidenceScore: 5,
    },
    pr: {
        // PR cares about audience reach, brand visibility, content performance, referrals
        distinctAudienceGrowthPct: 10,
        uniqueVisitors: 9,
        referralSources: 10,
        topContent: 9,
        topCountries: 8,
        topLandingPages: 7,
        returningVisitorRate: 7,
        // Less interested in conversion funnel
        conversionRate: 5,
        revenue: 4,
        orderCount: 4,
        bounceRate: 6,
        // Not focused on technical or health
        webVitals: 2,
        rageClicks: 4,
        healthScore: 5,
        confidenceScore: 4,
        deviceBreakdown: 4,
    },
    development: {
        // Development cares about performance, errors, technical quality, UX friction
        webVitals: 10,
        rageClicks: 10,
        bounceRate: 9,
        deviceBreakdown: 9,
        browserBreakdown: 9,
        osBreakdown: 8,
        screenSizeBreakdown: 7,
        avgPageDurationSeconds: 8,
        topExitPages: 9,
        // Moderate interest in traffic volume
        uniqueVisitors: 6,
        pageviews: 6,
        // Not focused on marketing or revenue
        conversionRate: 5,
        revenue: 3,
        topUtmSources: 2,
        topChannels: 3,
        healthScore: 6,
        confidenceScore: 5,
    },
};

/**
 * Get metric priority weight for a persona.
 * 
 * @param {string} persona - board|marketing|pr|development
 * @param {string} metricKey - Metric identifier
 * @returns {number} Priority weight 0-10
 */
function getMetricPriority(persona, metricKey) {
    const priorities = PERSONA_PRIORITIES[persona];
    if (!priorities) {
        return 5; // default neutral priority
    }
    return priorities[metricKey] ?? 5;
}

/**
 * Determine which metrics are most relevant for a persona.
 * Returns metric keys sorted by priority (highest first).
 * 
 * @param {string} persona - board|marketing|pr|development
 * @param {object} availableMetrics - Metrics object to filter
 * @returns {Array<{key: string, priority: number}>} Sorted metric priorities
 */
function prioritizeMetrics(persona, availableMetrics) {
    const priorities = PERSONA_PRIORITIES[persona];
    if (!priorities) {
        return [];
    }
    
    // Extract all metric keys from the nested structure
    const metricKeys = new Set();
    
    Object.keys(availableMetrics).forEach((domain) => {
        if (typeof availableMetrics[domain] === 'object' && availableMetrics[domain] !== null) {
            Object.keys(availableMetrics[domain]).forEach((key) => {
                metricKeys.add(key);
            });
        }
    });
    
    // Map to priorities and sort
    const prioritized = Array.from(metricKeys)
        .map((key) => ({
            key,
            priority: priorities[key] ?? 5,
        }))
        .sort((a, b) => b.priority - a.priority);
    
    return prioritized;
}

/**
 * Build persona-specific analytical guidance for the AI prompt.
 * This helps the AI understand which aspects to emphasize.
 * 
 * @param {string} persona - board|marketing|pr|development
 * @returns {string} Guidance text for AI prompt
 */
function buildPersonaGuidance(persona) {
    const guidance = {
        board: `PERSONA FOCUS: Board/Executive
You are addressing business leaders who need to make strategic decisions.
PRIORITIZE:
- Revenue, conversion, and growth metrics
- Business health and major risks/opportunities
- Strategic recommendations with financial impact
- Clear, actionable priorities

DEPRIORITIZE:
- Technical implementation details
- Infrastructure/AWS concerns
- Granular device/browser breakdowns (unless business-critical)

INSIGHTS SHOULD:
- Connect metrics to business outcomes
- Quantify financial impact where possible
- Recommend strategic actions, not tactical fixes
- Flag existential risks clearly`,

        marketing: `PERSONA FOCUS: Marketing
You are addressing marketers who need to optimize acquisition and conversion.
PRIORITIZE:
- Traffic acquisition (channels, campaigns, sources)
- Conversion funnel performance
- Landing page effectiveness
- Audience growth and engagement
- Campaign ROI where measurable

DEPRIORITIZE:
- Infrastructure/AWS concerns
- Deep technical performance metrics (unless affecting conversion)

INSIGHTS SHOULD:
- Identify high-performing and underperforming channels
- Recommend campaign optimizations
- Suggest A/B tests and experiments
- Connect traffic changes to conversion outcomes`,

        pr: `PERSONA FOCUS: PR/Communications
You are addressing PR professionals who need to grow brand visibility and reach.
PRIORITIZE:
- Audience reach and growth (distinct people reached, not just pageviews)
- Referral sources and media mentions
- Geographic expansion and emerging markets
- Content performance and engagement
- Brand awareness indicators

DEPRIORITIZE:
- Conversion funnel and revenue (unless PR campaign had revenue goal)
- Technical performance metrics
- Infrastructure concerns

INSIGHTS SHOULD:
- Measure reach expansion (new markets, new audiences)
- Identify successful content and referral opportunities
- Recommend PR-relevant actions (outreach, content strategy, partnerships)
- Focus on "who's talking about us" not "who's buying from us"`,

        development: `PERSONA FOCUS: Development/Engineering
You are addressing developers who need to improve technical quality and UX.
PRIORITIZE:
- Technical performance (web vitals, load times)
- UX friction indicators (rage clicks, bounce rate, exit pages)
- Device/browser/OS compatibility issues
- User experience quality across platforms

DEPRIORITIZE:
- Marketing campaigns and UTM sources
- PR reach and media mentions
- Business strategy (unless technical work has strategic impact)

INSIGHTS SHOULD:
- Identify technical issues affecting user experience
- Recommend performance optimizations
- Flag device-specific or browser-specific problems
- Suggest UX improvements backed by data (not speculation)
- Connect technical metrics to user behavior (e.g., "slow LCP may contribute to high bounce rate")`,
    };
    
    return guidance[persona] || guidance.board;
}

/**
 * Filter observations to those most relevant for a persona.
 * 
 * @param {Array} observations - All observations from evidence layer
 * @param {string} persona - board|marketing|pr|development
 * @returns {Array} Filtered observations
 */
function filterObservationsForPersona(observations, persona) {
    // Always include critical observations that any persona should know about
    const alwaysInclude = observations.filter((obs) => 
        obs.type === "CHECKOUT_WITHOUT_PURCHASE" ||
        obs.type === "NO_BASELINE"
    );
    
    // Board sees everything
    if (persona === "board") {
        return observations;
    }
    
    // Persona-specific filtering
    const personaRelevant = observations.filter((obs) => {
        // Skip critical observations (already handled above)
        if (obs.type === "CHECKOUT_WITHOUT_PURCHASE" || obs.type === "NO_BASELINE") {
            return false;
        }
        
        if (persona === "pr") {
            // PR cares about audience growth and acquisition, not conversion funnel
            return obs.metric === "geography" || 
                   obs.metric === "acquisition" &&obs.type === "VISITOR_COMPOSITION";
        }
        
        if (persona === "development") {
            // Development cares about engagement/technical issues, not acquisition composition
            return obs.metric === "engagement";
        }
        
        if (persona === "marketing") {
            // Marketing cares about acquisition, conversion, and geography
            return obs.metric === "acquisition" ||
                   obs.metric === "conversion" ||
                   obs.metric === "geography";
        }
        
        return false;
    });
    
    // Combine and deduplicate
    return [...alwaysInclude, ...personaRelevant];
}

module.exports = {
    PERSONA_PRIORITIES,
    getMetricPriority,
    prioritizeMetrics,
    buildPersonaGuidance,
    filterObservationsForPersona,
};
