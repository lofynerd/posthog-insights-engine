#!/usr/bin/env node
/**
 * One-time script: creates the PostHog insights that had no existing
 * dashboard coverage for a report metric (per the manual audit --
 * see docs/DECISIONS.md or the conversation this was built from),
 * and assembles a new "Tomasi AI Report Coverage" dashboard combining
 * them with references to insights that already existed.
 *
 * IMPORTANT: this uses POST /dashboards/:id/copy_tile/ to add EXISTING
 * insights to the new dashboard, not PATCH insight { dashboards: [...] }.
 * That PATCH approach was tested and found to be DESTRUCTIVE -- it
 * REPLACES an insight's dashboard membership rather than appending,
 * silently removing it from every dashboard it was already on. Newly
 * created insights are safe to set `dashboards` on directly at
 * creation time (nothing to clobber yet).
 *
 * Run once: node scripts/createMissingInsights.js
 * Safe to re-run for the dashboard-assembly step, but re-running will
 * create duplicate NEW insights (no dedup check) -- delete the
 * previous run's new insights first if re-running after an error.
 */
const axios = require("axios");
require("dotenv").config();

const API_KEY = process.env.POSTHOG_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const HOST = process.env.POSTHOG_HOST || "https://us.posthog.com";

if (!API_KEY || !PROJECT_ID) {
    console.error("Missing POSTHOG_API_KEY / POSTHOG_PROJECT_ID in .env");
    process.exit(1);
}

const client = axios.create({
    baseURL: `${HOST}/api/projects/${PROJECT_ID}`,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
});

// Existing insights already covering report metrics (from the manual
// audit), referenced by { dashboardId, tileId } so copy_tile can pull
// each one onto the new dashboard non-destructively.
const EXISTING_TILES = [
    { dashboardId: 1479209, tileId: null, insightId: 8003829, label: "Website Unique Users (Total)" },
    { dashboardId: 1479209, tileId: null, insightId: 8003833, label: "Sessions Per User" },
    { dashboardId: 1430164, tileId: null, insightId: 8075433, label: "Returning vs New Users (Logins)" },
    { dashboardId: 1479207, tileId: null, insightId: 8003819, label: "How do users find my product?" },
    { dashboardId: 1479209, tileId: null, insightId: 8003835, label: "Top Website Pages (Overall)" },
    { dashboardId: 1491933, tileId: null, insightId: 10204160, label: "Revenue Over Time (server-verified)" },
    { dashboardId: 1491933, tileId: null, insightId: 10204180, label: "Orders Completed (server-verified)" },
    { dashboardId: 1491933, tileId: null, insightId: 10204181, label: "Average Order Value" },
    { dashboardId: 1491933, tileId: null, insightId: 10204190, label: "Full Purchase Funnel (server-verified)" },
    { dashboardId: 1479207, tileId: null, insightId: 8003818, label: "What devices do users access my product with?" },
    { dashboardId: 1479207, tileId: null, insightId: 8003821, label: "Where are my users located?" },
    { dashboardId: 1491933, tileId: null, insightId: 10204192, label: "Average Engagement Time per Page" },
    { dashboardId: 1430164, tileId: null, insightId: 7733457, label: "Growth accounting" },
    { dashboardId: 1491933, tileId: null, insightId: 8075425, label: "Products Added to Cart" },
    { dashboardId: 1479207, tileId: null, insightId: 8003820, label: "What browsers do users prefer?" },
    { dashboardId: 1479207, tileId: null, insightId: 8003814, label: "What screen size do users have?" },
    { dashboardId: 1479207, tileId: null, insightId: 8003817, label: "Where are my users experiencing frustration?" },
];

// New insights to create -- HogQL-backed, each query pre-validated
// against live data via POST /query/ before this script was written.
const NEW_INSIGHTS = [
    {
        name: "Bounce Rate Trend (30d)",
        description: "Daily bounce rate: % of sessions with exactly one pageview. Powers the bounceRate metric in Marketing/PR/Dev reports.",
        sql: `
SELECT
    day,
    round(countIf(pageviews_in_session = 1) * 100.0 / count(), 1) AS bounce_rate_pct
FROM (
    SELECT
        properties.$session_id AS session_id,
        toDate(min(timestamp)) AS day,
        count() AS pageviews_in_session
    FROM events
    WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 30 DAY
        AND properties.$session_id IS NOT NULL
    GROUP BY session_id
)
GROUP BY day
ORDER BY day ASC
`,
    },
    {
        name: "Conversion Rate by Traffic Source (30d)",
        description: "Visits vs. confirmed orders (order_completed) per referring domain. Powers the conversionBySource metric -- ties acquisition channels directly to revenue.",
        sql: `
SELECT
    coalesce(properties.$referring_domain, '(direct)') AS source,
    countIf(event = '$pageview') AS visits,
    countIf(event = 'order_completed') AS conversions,
    round(countIf(event = 'order_completed') * 100.0 / countIf(event = '$pageview'), 2) AS conversion_rate_pct
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
    AND event IN ('$pageview', 'order_completed')
GROUP BY source
ORDER BY visits DESC
LIMIT 10
`,
    },
    {
        name: "Core Web Vitals Trend (30d)",
        description: "Daily average LCP (Largest Contentful Paint, ms). Powers the webVitals metric in Development reports -- lower is better.",
        sql: `
SELECT
    toDate(timestamp) AS day,
    round(avg(toFloat(properties.$web_vitals_LCP_value)), 0) AS avg_lcp_ms
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
    AND event = '$web_vitals'
GROUP BY day
ORDER BY day ASC
`,
    },
    {
        name: "Operating System Breakdown (30d)",
        description: "Visits by operating system. Powers the osBreakdown metric -- the one device-segmentation dimension not already covered by an existing dashboard tile.",
        sql: `
SELECT
    coalesce(properties.$os, 'Unknown') AS os,
    count() AS visits
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
    AND event = '$pageview'
GROUP BY os
ORDER BY visits DESC
LIMIT 10
`,
    },
];

async function resolveTileIds() {
    const dashboardIds = [...new Set(EXISTING_TILES.map((t) => t.dashboardId))];
    const tilesByDashboard = new Map();

    for (const dashboardId of dashboardIds) {
        const response = await client.get(`/dashboards/${dashboardId}/`);
        tilesByDashboard.set(dashboardId, response.data.tiles);
    }

    for (const entry of EXISTING_TILES) {
        const tiles = tilesByDashboard.get(entry.dashboardId) || [];
        const match = tiles.find((t) => t.insight?.id === entry.insightId);
        if (!match) {
            console.warn(`Could not find tile for insight ${entry.insightId} (${entry.label}) on dashboard ${entry.dashboardId} -- skipping`);
            continue;
        }
        entry.tileId = match.id;
    }
}

async function createInsight({ name, description, sql }, dashboardId) {
    const response = await client.post("/insights/", {
        name,
        description,
        dashboards: [dashboardId],
        query: {
            kind: "DataVisualizationNode",
            source: { kind: "HogQLQuery", query: sql },
        },
        saved: true,
    });
    console.log(`Created insight "${name}" -> id ${response.data.id}`);
    return response.data.id;
}

async function main() {
    console.log("Creating coverage dashboard...\n");
    const dashboardResponse = await client.post("/dashboards/", {
        name: "Tomasi AI Report Coverage",
        description:
            "One dashboard covering every metric used in Tomasi AI's Telegram reports (weekly/monthly/quarterly). " +
            "Auto-generated by scripts/createMissingInsights.js -- combines existing dashboard tiles (copied, not moved -- " +
            "originals remain on their source dashboards) with newly created insights (bounce rate, conversion-by-source, " +
            "web vitals, OS breakdown) that had no prior coverage.",
    });
    const dashboardId = dashboardResponse.data.id;
    console.log(`Created dashboard "Tomasi AI Report Coverage" -> id ${dashboardId}`);

    console.log("\nResolving existing tile IDs...\n");
    await resolveTileIds();

    console.log("\nCopying existing tiles onto the new dashboard...\n");
    for (const entry of EXISTING_TILES) {
        if (!entry.tileId) continue;
        try {
            await client.post(`/dashboards/${dashboardId}/copy_tile/`, {
                fromDashboardId: entry.dashboardId,
                tileId: entry.tileId,
            });
            console.log(`Copied "${entry.label}" from dashboard ${entry.dashboardId}`);
        } catch (error) {
            console.warn(`Failed to copy tile for "${entry.label}":`, error.response?.data || error.message);
        }
    }

    console.log("\nCreating new insights (with no prior coverage)...\n");
    const newInsightIds = [];
    for (const insight of NEW_INSIGHTS) {
        const id = await createInsight(insight, dashboardId);
        newInsightIds.push(id);
    }

    console.log("\nDone.");
    console.log(`Dashboard: ${HOST}/project/${PROJECT_ID}/dashboard/${dashboardId}`);
    console.log(`New insight IDs: ${newInsightIds.join(", ")}`);
}

main().catch((error) => {
    console.error("Failed:", error.response?.data || error.message);
    process.exit(1);
});
