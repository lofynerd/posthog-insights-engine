# Tomasi AI — Development Guide

For the development Telegram group. Focused on infrastructure, API, errors, deployments, cloud, performance, security, CloudWatch, database, latency, and cost — marketing is never discussed here.

## Reports

| Command | Period | Length |
|---|---|---|
| `/latest` | Today | ≤350 words |
| `/weekly` | Last 7 days | ≤500 words |
| `/monthly` | Last 30 days | ≤700 words |
| `/quarterly` | Last 90 days | ≤700 words |

Each sends a real PostHog chart (whichever metric moved most that period, e.g. Core Web Vitals, sessions per user) plus a short, reasoned AI caption — not a wall of text. Reports are cached per day, so re-running the same command twice in a day is instant.

Instagram/social data is not folded into dev reports (marketing and PR only).

## Going deeper

- `/details` — full expanded text breakdown of your last report
- `/recommend` — ranked priorities only
- `/funnel` — conversion funnel breakdown only
- `/ask "<question>"` — ask anything about Tomasi's analytics (off-topic questions are rejected)

## Social

- `/social [days]` — Instagram reach, accounts engaged, follower count, and top-performing post (default: last 30 days), available on request even though it's not auto-included in dev's own reports.

## What you can't do here

Influencer discount code creation and campaign ROI (`/influencer`, `/campaign`) are board-only, since they write real Stripe discount codes to production. Board-only data (revenue, business health) also isn't visible from this group — cross-audience commands like `/board` are restricted to a single admin Telegram user, regardless of which group runs them.

## Utility

- `/test` — checks PostHog, AI, and Telegram connectivity for this group
- `/help` — full in-chat walkthrough
