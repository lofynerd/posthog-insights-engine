# Engineering Guide

> Development standards and engineering practices for PostHog Insights Engine.

---

# Purpose

This document defines the engineering standards that every contributor, including AI coding assistants, must follow.

Following these standards ensures the project remains maintainable, testable, and scalable.

Architecture decisions are documented in `ARCHITECTURE.md`.

This guide focuses on implementation.

---

# Development Philosophy

Always optimize for:

- Readability
- Maintainability
- Simplicity
- Testability

Never optimize for writing the fewest lines of code.

Future readability is more valuable than short code.

---

# JavaScript Standard

The project uses JavaScript.

TypeScript is intentionally not used.

Reason:

- Faster iteration
- Existing team expertise
- Lower complexity

---

# Project Structure

Every file has one responsibility.

Example:

services/
External communication only.

queries/
HogQL only.

metrics/
Business logic only.

ai/
Prompt generation only.

notifications/
Message delivery only.

---

# Services

Services communicate with external systems.

Examples:

PostHog

OpenAI

Slack

Telegram

AWS

Services never perform business calculations.

---

# Queries

Every HogQL query belongs inside the queries directory.

Rules:

No business logic.

No HTTP requests.

No duplicated queries.

One query per file.

---

# Metrics

Metrics represent business concepts.

Examples:

Acquisition

Engagement

Conversion

Geography

Rules:

Metrics never contain raw HTTP requests.

Metrics never contain HogQL.

Metrics only combine queries into structured analytics.

---

# Explorer

Explorer exists only for development.

Purpose:

Discover event schemas.

Inspect properties.

Prototype queries.

Explorer code should never be imported into production modules.

---

# AI

AI receives structured analytics only.

AI must never:

- Query PostHog
- Access DynamoDB
- Call notification services

Responsibilities:

Generate reports.

Explain trends.

Recommend actions.

Nothing else.

---

# Notifications

Notification modules only deliver messages.

No analytics.

No AI.

No business logic.

---

# Logging

Never use console.log in production code.

Use the project logger.

Logging levels:

INFO

WARN

ERROR

DEBUG

---

# Error Handling

Every service should fail gracefully.

Never expose raw Axios errors.

Wrap external errors with meaningful application messages.

---

# Testing

Testing framework:

Jest

Every business module requires tests.

Services should be mockable.

Metrics should be tested independently.

---

# Documentation

Every exported function requires JSDoc.

Complex logic requires inline comments.

Architecture changes require documentation updates.

---

# Git

Branch strategy:

main

develop

feature/*

fix/*

hotfix/*

---

# Commit Messages

Use Conventional Commits.

Examples:

feat:

fix:

docs:

refactor:

test:

chore:

---

# Pull Requests

Every PR should:

Compile successfully.

Pass tests.

Contain focused changes.

Update documentation when necessary.

---

# Code Reviews

Before merging ask:

Does this follow architecture?

Can this be simplified?

Can this be tested?

Does it duplicate existing logic?

Does it belong in this module?

---

# AI Coding Assistants

AI-generated code is never merged without review.

AI should:

Respect architecture.

Avoid duplication.

Write readable code.

Include tests.

Avoid unnecessary dependencies.

---

# Definition of Done

A feature is complete only when:

✅ Code implemented

✅ Tests passing

✅ Documentation updated

✅ Logging included

✅ Error handling complete

✅ Reviewed

✅ Ready for production