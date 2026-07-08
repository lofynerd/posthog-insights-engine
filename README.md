# PostHog Insights Engine

> AI-powered analytics reporting and insight generation for PostHog.

## Overview

PostHog Insights Engine is a modular analytics platform that transforms raw PostHog analytics into actionable business insights.

Instead of manually reviewing dashboards, the platform automatically:

* Collects analytics from PostHog
* Organizes metrics into business domains
* Stores historical snapshots
* Detects trends and anomalies
* Generates AI-powered reports
* Delivers audience-specific summaries

---

## Features

### Analytics Engine

* Acquisition Metrics
* Engagement Metrics
* Geography Metrics
* Conversion Metrics

### Historical Analytics

* Daily Snapshots
* Weekly Comparisons
* Monthly Comparisons
* Trend Detection

### AI Reporting

* Founder Reports
* Marketing Reports
* PR Reports
* Developer Reports

### Multi-Group Telegram Bot

The bot (`src/bot.js`) can be added to multiple Telegram groups at once, each
registered as one of 4 report types:

* 👑 Founder / CEO
* 📈 Marketing
* 📢 PR
* 💻 Developer

Each group gets its own AI-generated report tailored to that audience, backed
by S3-stored snapshots ("memory") so repeated requests on the same day reuse
already-fetched PostHog data instead of re-querying.

Commands available in every registered group:

* `/register <type> [name]` — one-time setup, assigns a report type to the group
* `/test` — sanity-checks PostHog, AI, and Telegram connectivity, lists available commands
* `/latest` — today's snapshot
* `/weekly` — last 7 days
* `/monthly` — last 30 days
* `/quarterly` — last 90 days
* `/ask <question>` — free-form Q&A, restricted to the brand's own analytics
  (a relevance guard blocks off-topic questions before they reach the AI, to
  protect API credits from misuse)

Weekly and monthly reports are also posted automatically via a scheduler
(`src/scheduler/scheduledReports.js`).

### Other Notifications

* Slack (planned)

Future

* Email
* Discord
* WhatsApp

---

## Technology Stack

Backend

* Node.js
* JavaScript

Analytics

* PostHog
* HogQL

Cloud

* AWS Lambda
* EventBridge
* DynamoDB
* Secrets Manager
* CloudWatch

Testing

* Jest

AI

* OpenAI

---

## Project Structure

Production code is organized by responsibility:

* `src/config` - centralized application configuration
* `src/services` - external API communication
* `src/queries` - reusable HogQL queries
* `src/metrics` - business analytics logic
* `src/explorer` - development-only PostHog discovery utilities
* `src/storage` - historical snapshot persistence
* `src/comparison` - historical trend calculation
* `src/ai` - prompt generation and AI reports
* `src/notifications` - report delivery channels
* `src/scheduler` - scheduled report execution
* `src/utils` - shared helpers
* `tests` - Jest test suites

See `docs/ARCHITECTURE.md` for the full architecture.

---

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in the required credentials.

3. Run tests:

```bash
npm test
```

Explorer scripts in `src/explorer` are for development and schema discovery only. They are not imported by production modules.

---

## Development Status

Current Version

v0.1.0

Current Phase

Foundation cleanup complete; analytics engine implementation begins next.

---

## Documentation

* docs/ARCHITECTURE.md
* docs/ENGINEERING_GUIDE.md
* docs/ROADMAP.md
* docs/DECISIONS.md

---

## License

Private project.

Open-source readiness is maintained throughout development.
