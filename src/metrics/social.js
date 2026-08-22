const logger = require("../utils/logger");

/**
 * Collect Instagram performance metrics: account-level reach/accounts
 * engaged/follower count, plus per-post engagement for recent media,
 * ranked by total_interactions so the "biggest win" post is obvious.
 *
 * Lazily requires instagram.service so a missing Instagram
 * credential only breaks Instagram-specific commands, not the whole
 * bot or every other report.
 *
 * @param {number} [days=30] - Lookback window for account insights.
 * @param {number} [postLimit=10] - How many recent posts to fetch engagement for.
 * @returns {Promise<object>} Structured Instagram metrics.
 */
async function collectInstagram(days = 30, postLimit = 10) {
    const instagram = require("../services/instagram.service").getInstance();

    const [accountInsights, recentMedia] = await Promise.all([
        instagram.getAccountInsights("day", days),
        instagram.listRecentMedia(postLimit),
    ]);

    // Fetch per-post insights in parallel, but tolerate individual
    // failures (e.g. a very new post with "not enough viewers") --
    // one thin post shouldn't take down the whole report.
    const postsWithInsights = await Promise.all(
        recentMedia.map(async (post) => {
            try {
                const insights = await instagram.getMediaInsights(post.id);
                return { ...post, insights };
            } catch (error) {
                logger.warn("Failed to fetch insights for one Instagram post", { id: post.id, error: error.message });
                return { ...post, insights: {} };
            }
        })
    );

    const rankedPosts = [...postsWithInsights].sort(
        (a, b) => (b.insights.total_interactions ?? 0) - (a.insights.total_interactions ?? 0)
    );

    const topPost = rankedPosts[0] || null;

    return {
        reach: accountInsights.reach ?? null,
        accountsEngaged: accountInsights.accounts_engaged ?? null,
        followerCount: accountInsights.follower_count ?? null,
        postsAnalyzed: postsWithInsights.length,
        topPost: topPost
            ? {
                  id: topPost.id,
                  caption: (topPost.caption || "").slice(0, 100),
                  permalink: topPost.permalink,
                  mediaType: topPost.media_type,
                  timestamp: topPost.timestamp,
                  likes: topPost.insights.likes ?? topPost.like_count ?? null,
                  comments: topPost.insights.comments ?? topPost.comments_count ?? null,
                  reach: topPost.insights.reach ?? null,
                  saved: topPost.insights.saved ?? null,
                  shares: topPost.insights.shares ?? null,
                  totalInteractions: topPost.insights.total_interactions ?? null,
              }
            : null,
        recentPosts: rankedPosts.slice(0, 5).map((post) => ({
            id: post.id,
            caption: (post.caption || "").slice(0, 60),
            mediaType: post.media_type,
            timestamp: post.timestamp,
            totalInteractions: post.insights.total_interactions ?? null,
            reach: post.insights.reach ?? null,
        })),
    };
}

module.exports = { collectInstagram };
