# PostHog Insights Engine

> AI-powered analytics reporting and insight generation for PostHog.

---

# 1. Vision

PostHog Insights Engine is a modular analytics platform designed to transform raw PostHog analytics into actionable business intelligence.

The platform automatically:

- Collects analytics from PostHog
- Organizes data into business domains
- Stores historical snapshots
- Detects trends and anomalies
- Generates AI-powered reports
- Delivers audience-specific summaries
- Sends notifications through multiple channels

The goal is to remove the need for manual dashboard analysis while ensuring every insight is backed by measurable data.

---

# 2. Design Philosophy

The project follows one fundamental principle:

> Analytics first. AI second.

AI should never replace analytics.

Instead:

Raw Data
→ Structured Analytics
→ Evidence
→ AI Interpretation
→ Human Decision

Every AI-generated insight must be supported by real metrics.

Hallucinated conclusions are unacceptable.

---

# 3. Core Principles

## Single Responsibility

Every module has exactly one responsibility.

Examples:

- Services communicate with APIs.
- Queries contain HogQL only.
- Metrics contain business logic.
- AI generates reports.
- Notifications deliver reports.

Responsibilities never overlap.

---

## Separation of Concerns

The project is intentionally layered.

Presentation never accesses PostHog directly.

AI never queries PostHog.

Notifications never calculate metrics.

Historical comparison never calls AI.

---

## Configuration over Hardcoding

Company-specific values must never appear inside business logic.

Configuration belongs in the config directory.

Examples:

- Company Name
- Timezone
- Currency
- Report Schedule

---

## Testability

Every module should be independently testable.

Business logic must never depend directly on external services.

---

# 4. High-Level Architecture

EventBridge Scheduler
        │
        ▼
Analytics Engine
        │
        ▼
Snapshot Engine
        │
        ▼
Comparison Engine
        │
        ▼
AI Report Engine
        │
        ▼
Notification Engine

---

# 5. Data Flow

PostHog

↓

Service Layer

↓

Query Layer

↓

Metrics Layer

↓

Snapshot Storage

↓

Historical Comparison

↓

AI Report Generation

↓

Slack / Telegram / Email / Discord

---

# 6. Project Structure

src/

config/
Application configuration

services/
External API communication

queries/
Reusable HogQL queries

metrics/
Business analytics logic

explorer/
Developer tools for schema discovery

storage/
Historical snapshot persistence

comparison/
Historical trend calculation

ai/
Prompt generation and AI reports

notifications/
Slack, Telegram, Email, Discord

scheduler/
Scheduled report execution

utils/
Shared helpers

tests/
Unit and integration tests

---

# 7. Module Responsibilities

## Services

Responsible for:

- Authentication
- HTTP Requests
- Retry Logic
- Rate Limits

Never:

- Calculate metrics
- Generate reports
- Store snapshots

---

## Queries

Responsible for:

- HogQL only

Never:

- Import services
- Perform business logic

---

## Metrics

Responsible for:

- Business calculations
- Aggregation
- Structured analytics output

Never:

- Execute HTTP requests directly
- Generate AI prompts

---

## Snapshot Engine

Responsible for:

- Historical storage
- Versioning
- Retrieval

Never:

- Analyze data

---

## Comparison Engine

Responsible for:

- Trend detection
- Percentage changes
- Period comparisons

Never:

- Query PostHog directly

---

## AI Engine

Responsible for:

- Executive reports
- Marketing reports
- PR reports
- Developer reports

AI never accesses raw analytics APIs.

It only receives structured analytics objects.

---

## Notification Engine

Responsible for:

- Slack
- Telegram
- Email
- Discord

No analytics logic belongs here.

---

# 8. Report Audiences

Founder

Business KPIs
Growth
Revenue

Marketing

Traffic
SEO
Acquisition

PR

Brand Visibility
Audience Growth
Campaign Opportunities

Developer

Browsers
Devices
Performance
Errors

---

# 9. Historical Strategy

Every scheduled execution creates a snapshot.

Snapshots are immutable.

Snapshots are compared against:

- Previous Day
- Previous Week
- Previous Month
- Rolling 12 Weeks

---

# 10. AI Philosophy

The AI acts as a:

Senior Ecommerce Growth Analyst

Responsibilities:

- Explain trends
- Highlight opportunities
- Detect anomalies
- Suggest actions

AI must never fabricate evidence.

Confidence scores are calculated by the application, not by AI.

---

# 11. Deployment

Production deployment target:

AWS Lambda
AWS EventBridge
AWS Secrets Manager
CloudWatch
DynamoDB

Development uses:

Node.js
JavaScript
dotenv

---

# 12. Long-Term Goal

The objective is to build a production-quality PostHog reporting platform suitable for real business use while maintaining clean architecture, modularity, and high testability.