# Tomasi AI — Board Guide

For the leadership/board Telegram group. Focused on revenue, growth, business health, and ROI on marketing spend — no technical detail.

## Reports

| Command | Period | Length |
|---|---|---|
| `/latest` | Today | ≤600 words |
| `/weekly` | Last 7 days | ≤600 words |
| `/monthly` | Last 30 days | ≤600 words |
| `/quarterly` | Last 90 days | ≤600 words |

Each sends a real PostHog chart (whichever metric moved most that period) plus a short, reasoned caption — not a wall of text. Reports are cached per day, so re-running the same command twice in a day is instant.

Board reports cover: revenue, growth, business health, major risks/opportunities, financial impact, strategic recommendations. They never include infrastructure/AWS or other technical implementation detail.

## Going deeper

- `/details` — full expanded text breakdown of your last report
- `/recommend` — ranked priorities only
- `/funnel` — conversion funnel breakdown only
- `/ask "<question>"` — ask anything about Tomasi's analytics (off-topic questions are rejected)

## Cross-audience visibility (admin only)

Board members can peek at other teams' weekly view of the same data:

- `/marketing`, `/pr`, `/dev` — pull that audience's weekly report into this chat

These are restricted to a single admin Telegram user, regardless of which group runs them.

## Influencer & campaign management (board-only, writes to production)

This is the only command family that changes production — it creates a real, working Stripe discount code.

- `/influencer add <name> <discount%> [platform] [agreedFee]` — creates a discount code + tracking link to hand to the influencer
- `/influencer list` — see all codes created
- `/influencer update <slug> <platform|-> <agreedFee|-> — set or fix platform/cost after the fact (use `-` to leave a field unchanged)
- `/influencer disable <slug>` — deactivates the code at checkout immediately; history is kept so `/campaign` still reports on it
- `/campaign <slug> [days]` — reach, orders, revenue, and ROI for one collaboration

**ROI needs both `platform` and `agreedFee` set.** If either is missing, `/campaign` shows ROI as `N/A` — by design, a missing/zero cost can't produce a real ROI number, only a misleading one. Fix it anytime with `/influencer update`.

## Social

- `/social [days]` — Instagram reach, accounts engaged, followers, top post (default: last 30 days). Board can pull this on demand even though Instagram isn't auto-folded into board's own weekly/monthly/quarterly reports.

## Utility

- `/test` — checks PostHog, AI, and Telegram connectivity for this group
- `/help` — full in-chat walkthrough (board-specific commands shown automatically)
