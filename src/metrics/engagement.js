const posthog = require("../services/posthog.service");
const queries = require("../queries/engagement.queries");

function rows(result) {
    return result.results || [];
}

/**
 * Collect device, browser, OS, screen size, geography, and technical
 * quality (web vitals, rage clicks, bounce signal) for a report window.
 *
 * @param {number} days - Lookback window in days.
 * @param {number} [offsetDays=0] - Shift the window into the past.
 * @returns {Promise<object>} Structured engagement/technical metrics.
 */
async function collect(days, offsetDays = 0) {
    const [
        deviceResult,
        browserResult,
        osResult,
        screenResult,
        geoResult,
        vitalsResult,
        rageResult,
        bounceResult,
    ] = await Promise.all([
        posthog.runHogQL(queries.deviceBreakdown(days, offsetDays)),
        posthog.runHogQL(queries.browserBreakdown(days, 10, offsetDays)),
        posthog.runHogQL(queries.osBreakdown(days, 10, offsetDays)),
        posthog.runHogQL(queries.screenSizeBreakdown(days, 10, offsetDays)),
        posthog.runHogQL(queries.geographyBreakdown(days, 10, offsetDays)),
        posthog.runHogQL(queries.averageWebVitals(days, offsetDays)),
        posthog.runHogQL(queries.rageClickCount(days, offsetDays)),
        posthog.runHogQL(queries.bounceSignal(days, offsetDays)),
    ]);

    const vitalsRow = rows(vitalsResult)[0] || [];
    const bounceRow = rows(bounceResult)[0] || [0, 0];
    const [singlePageSessions, totalSessions] = bounceRow;

    return {
        deviceBreakdown: rows(deviceResult).map(([device, visits]) => ({ device, visits })),
        browserBreakdown: rows(browserResult).map(([browser, visits]) => ({ browser, visits })),
        osBreakdown: rows(osResult).map(([os, visits]) => ({ os, visits })),
        screenSizeBreakdown: rows(screenResult).map(([resolution, visits]) => ({ resolution, visits })),
        geographyBreakdown: rows(geoResult).map(([country, visitors]) => ({ country, visitors })),
        webVitals: {
            avgLcpMs: vitalsRow[0] ?? null,
            avgFcpMs: vitalsRow[1] ?? null,
            avgCls: vitalsRow[2] ?? null,
            avgInpMs: vitalsRow[3] ?? null,
        },
        rageClicks: rows(rageResult)[0]?.[0] ?? 0,
        bounceRate:
            totalSessions > 0 ? Number((singlePageSessions / totalSessions).toFixed(4)) : null,
        totalSessions: totalSessions ?? 0,
    };
}

module.exports = { collect };
