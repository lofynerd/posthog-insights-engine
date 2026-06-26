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

### Notifications

* Slack
* Telegram

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
