#!/usr/bin/env node
/**
 * One-time interactive setup script for Instagram Graph API access,
 * using the "Instagram API with Instagram Login" flow (Business
 * Login for Instagram) -- this is the correct flow for a standalone
 * Instagram app like "tomasi-app-IG" that is NOT the same app as a
 * Facebook app. It does not involve a Facebook Page or graph.facebook.com
 * at all; everything happens against instagram.com/api.instagram.com/
 * graph.instagram.com.
 *
 * (An earlier version of this script targeted the OTHER flow --
 * "Instagram API with Facebook Login" -- which uses a Facebook App ID
 * against graph.facebook.com. That only works if the Instagram app is
 * a product added to a Facebook-type Meta app. A standalone Instagram
 * app's ID is rejected by facebook.com's OAuth dialog with "Invalid
 * App ID", which is the error that prompted this rewrite.)
 *
 * What this script does, step by step:
 *   1. Prints an instagram.com OAuth URL for you to open and approve.
 *   2. You paste back the redirected URL (contains a short-lived code).
 *   3. Exchanges that code for a short-lived Instagram User access
 *      token AND the Instagram professional account ID directly (no
 *      separate Facebook Page lookup needed in this flow).
 *   4. Exchanges the short-lived token for a long-lived one (~60 days).
 *   5. Prints the exact .env values to save.
 *
 * Usage:
 *   node scripts/instagramAuth.js
 *
 * Requires INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET already set in
 * .env -- the "Instagram App ID" / "Instagram app secret" shown under
 * App Dashboard > Instagram > API setup with Instagram login > 3. Set
 * up Instagram business login > Business login settings (NOT the
 * Meta app's top-level App ID/Secret, which is a different pair for
 * this app type).
 */
const readline = require("readline");
const axios = require("axios");
require("dotenv").config();

const APP_ID = process.env.INSTAGRAM_APP_ID;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
// A registered OAuth redirect URI on the Instagram app's Business
// Login settings. For a one-time manual flow, Meta's own OAuth
// playground redirect works fine -- it just needs to be an EXACT
// match to one of the app's configured "OAuth redirect URIs".
const REDIRECT_URI = process.env.INSTAGRAM_OAUTH_REDIRECT_URI || "https://developers.facebook.com/tools/explorer/callback";

// New-style scope names (the old business_basic / business_manage_insights
// style names were deprecated January 27, 2025).
const REQUIRED_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];

function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
    }));
}

async function main() {
    if (!APP_ID || !APP_SECRET) {
        console.error(
            "Missing INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET in .env. Set these to the " +
                "'Instagram App ID' / 'Instagram app secret' from App Dashboard > Instagram > " +
                "API setup with Instagram login > Business login settings, then rerun."
        );
        process.exit(1);
    }

    const authUrl =
        `https://www.instagram.com/oauth/authorize?client_id=${APP_ID}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${REQUIRED_SCOPES.join(",")}` +
        `&response_type=code`;

    console.log("\nStep 1: Open this URL in a browser where you're logged in as the Tomasi Instagram Business account:\n");
    console.log(authUrl);
    console.log("\nApprove the permissions. You'll be redirected to a URL that starts with the redirect URI above and contains ?code=...\n");

    const redirectedUrl = await prompt("Step 2: Paste the FULL redirected URL here: ");

    let code;
    try {
        const url = new URL(redirectedUrl);
        code = url.searchParams.get("code");
        // Instagram appends a "#_" fragment to the redirect that isn't
        // part of the code itself -- URL parsing already strips the
        // fragment from searchParams, but strip defensively in case
        // someone pasted just the query string.
        if (code) code = code.replace(/#_$/, "");
    } catch {
        // Not a full URL -- maybe they pasted just the code itself.
        code = redirectedUrl.replace(/#_$/, "");
    }

    if (!code) {
        console.error("Could not find a 'code' parameter in what you pasted. Aborting.");
        process.exit(1);
    }

    console.log("\nStep 3: Exchanging authorization code for a short-lived access token + Instagram account ID...");
    let shortLivedToken;
    let businessAccountId;
    try {
        const params = new URLSearchParams();
        params.append("client_id", APP_ID);
        params.append("client_secret", APP_SECRET);
        params.append("grant_type", "authorization_code");
        params.append("redirect_uri", REDIRECT_URI);
        params.append("code", code);

        const tokenResponse = await axios.post("https://api.instagram.com/oauth/access_token", params);

        // This endpoint's response shape wraps the result in a "data"
        // array (unlike the Facebook Login flow's flat response).
        const result = Array.isArray(tokenResponse.data?.data) ? tokenResponse.data.data[0] : tokenResponse.data;

        shortLivedToken = result?.access_token;
        businessAccountId = result?.user_id;

        if (!shortLivedToken || !businessAccountId) {
            throw new Error(`Unexpected response shape: ${JSON.stringify(tokenResponse.data)}`);
        }
    } catch (error) {
        console.error("Failed to exchange code for token:", error.response?.data || error.message);
        process.exit(1);
    }

    console.log(`Instagram professional account ID: ${businessAccountId}`);
    console.log("Step 4: Exchanging short-lived token for a long-lived token (~60 days)...");
    let longLivedToken;
    try {
        const exchangeResponse = await axios.get("https://graph.instagram.com/access_token", {
            params: {
                grant_type: "ig_exchange_token",
                client_secret: APP_SECRET,
                access_token: shortLivedToken,
            },
        });
        longLivedToken = exchangeResponse.data.access_token;
        console.log(`Long-lived token obtained, expires in ~${Math.round((exchangeResponse.data.expires_in || 0) / 86400)} days.`);
    } catch (error) {
        console.error("Failed to exchange for long-lived token:", error.response?.data || error.message);
        process.exit(1);
    }

    console.log(`\nFound Instagram Business Account: ${businessAccountId}\n`);
    console.log("=".repeat(70));
    console.log("Add these to your .env (and to the ECS task definition's secrets):");
    console.log("=".repeat(70));
    console.log(`INSTAGRAM_BUSINESS_ACCOUNT_ID=${businessAccountId}`);
    console.log(`INSTAGRAM_ACCESS_TOKEN=${longLivedToken}`);
    console.log("=".repeat(70));
    console.log("\nThis token lasts ~60 days. The bot refreshes it automatically before");
    console.log("expiry as long as it keeps running -- but if the token ever fully");
    console.log("expires (e.g. the bot was down for 60+ days), you'll need to rerun");
    console.log("this script to get a fresh one.\n");
}

main().catch((error) => {
    console.error("Unexpected error:", error.message);
    process.exit(1);
});
