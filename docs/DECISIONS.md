# Architecture Decision Records (ADR)

> This document records important architectural and technical decisions made during the development of PostHog Insights Engine.

---

# ADR-001

## Title

Project Scope

## Status

Accepted

## Decision

The project will focus exclusively on PostHog as its analytics provider.

## Rationale

The initial goal is to build a production-quality reporting engine for Tomasi Design.

Supporting additional analytics providers would introduce unnecessary complexity during Version 1.0.

Future integrations may be added after the platform reaches maturity.

---

# ADR-002

## Title

Programming Language

## Status

Accepted

## Decision

JavaScript will be used instead of TypeScript.

## Rationale

* Existing team expertise
* Faster development
* Reduced complexity
* Better alignment with the current technology stack

---

# ADR-003

## Title

Project Architecture

## Status

Accepted

## Decision

The application will follow a layered architecture.

Service Layer

↓

Query Layer

↓

Metrics Layer

↓

Storage Layer

↓

Comparison Layer

↓

AI Layer

↓

Notification Layer

## Rationale

Separating responsibilities improves maintainability, testing, and long-term scalability.

---

# ADR-004

## Title

Historical Storage

## Status

Accepted

## Decision

Historical analytics snapshots will be stored in DynamoDB.

## Rationale

* AWS-native
* Serverless
* Scalable
* Cost-effective
* Suitable for immutable snapshot storage

---

# ADR-005

## Title

AI Provider

## Status

Accepted

## Decision

OpenAI will be used as the initial AI provider.

The architecture should remain flexible enough to support future providers.

## Rationale

OpenAI provides high-quality reasoning while allowing future abstraction if needed.

---

# ADR-006

## Title

AI Philosophy

## Status

Accepted

## Decision

AI will never access PostHog directly.

AI receives only structured analytics objects.

## Rationale

This prevents hallucinations and keeps analytics deterministic.

---

# ADR-007

## Title

Audience-Specific Reports

## Status

Accepted

## Decision

The platform will generate separate reports for:

* Founder
* Marketing
* PR
* Developer

## Rationale

Different stakeholders require different levels of detail and terminology.

---

# ADR-008

## Title

Deployment Platform

## Status

Accepted

## Decision

Production deployments will target AWS.

Services include:

* Lambda
* EventBridge
* Secrets Manager
* CloudWatch

## Rationale

AWS aligns with existing team expertise and project requirements.

---

# ADR-009

## Title

Testing Framework

## Status

Accepted

## Decision

Jest will be the standard testing framework.

## Rationale

Widely adopted, easy to integrate with JavaScript, and well suited for unit and integration testing.

---

# ADR-010

## Title

Engineering Workflow

## Status

Accepted

## Decision

Every feature follows this workflow:

Architecture

↓

Implementation

↓

Review

↓

Testing

↓

Merge

## Rationale

This ensures consistency, quality, and maintainability throughout the project.

---

# ADR-011

## Title

Documentation-First Development

## Status

Accepted

## Decision

Documentation must be completed before production implementation.

## Rationale

Clear architecture reduces rework and improves collaboration between developers and AI coding assistants.

---

# ADR-012

## Title

Version 1.0 Scope

## Status

Accepted

## Decision

Version 1.0 includes:

* Analytics Engine
* Snapshot Engine
* Comparison Engine
* AI Report Engine
* Slack Notifications
* Telegram Notifications
* AWS Deployment

Email, Discord, WhatsApp, and future enhancements are explicitly outside Version 1.0.

## Rationale

Keeping Version 1.0 focused increases the likelihood of delivering a stable production release.
