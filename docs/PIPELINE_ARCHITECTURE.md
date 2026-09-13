# Pipeline Architecture

## Overview

PostHog Insights Engine has two distinct execution paths for generating and delivering reports:

1. **Legacy Pipeline** (`src/pipeline.js`) - Simple, stateless, single-chat
2. **Bot Pipeline** (`src/bot.js` + `src/insights/reportGenerator.js`) - Full-featured, multi-group, memory-backed

Both are **intentionally maintained** and serve different deployment scenarios.

---

## Legacy Pipeline (src/pipeline.js)

### Status
✅ **MAINTAINED** - Actively supported, not deprecated

### Purpose
Simple one-shot execution for single-chat deployments without multi-group requirements.

### Architecture
```
PostHog Query → Metrics Collection → Health/Confidence Scoring → AI Report → Telegram Delivery
```

### Key Characteristics
- **Stateless**: No S3 memory, no historical snapshots
- **Single chat**: Reports to one Telegram chat per execution
- **Direct comparison**: Uses PostHog offset queries for period-over-period comparison
- **Simple deployment**: Can run as Lambda function, cron job, or manual invocation
- **No dependencies**: Doesn't require group registry or bot infrastructure

### Use Cases
1. Simple scheduled jobs (e.g., single weekly report to founders)
2. Testing/debugging without bot setup
3. Environments where S3 is unavailable
4. One-off report generation scripts

### Limitations
- No S3-backed memory (re-queries PostHog every time)
- No historical snapshot reuse
- Single audience per execution
- No bot commands (/latest, /weekly, etc.)
- No multi-group support

### Usage
```bash
# Direct execution
node src/pipeline.js

# Programmatic
const { runPipeline } = require('./src/index.js');
await runPipeline({ audience: 'founder', chatId: 'CHAT_ID' });
```

### Configuration Required
- `POSTHOG_API_KEY`
- `POSTHOG_PROJECT_ID`
- `AI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

---

## Bot Pipeline (src/bot.js + reportGenerator.js)

### Status
✅ **ACTIVE** - Primary production deployment

### Purpose
Full-featured multi-group reporting with memory, commands, and scheduled delivery.

### Architecture
```
Telegram Bot (Long Polling)
    ↓
Bot Commands (/latest, /weekly, /monthly, /quarterly)
    ↓
Report Generator
    ↓
S3 Memory Layer (Historical Snapshots)
    ↓
Metrics Collection (if not cached)
    ↓
Comparison (uses stored snapshots)
    ↓
Health/Confidence Scoring
    ↓
AI Report
    ↓
Telegram Delivery (chart + caption or full text)
```

### Key Characteristics
- **Multi-group**: Supports multiple Telegram groups with different report types
- **S3 memory**: Caches daily snapshots, reuses historical data for comparisons
- **Bot commands**: Interactive `/latest`, `/weekly`, `/monthly`, `/quarterly`, `/details`, etc.
- **Scheduled reports**: Automatic weekly, monthly, quarterly delivery
- **Audience-specific**: Board, Marketing, PR, Development report types
- **Chart export**: Real PostHog chart images with AI captions
- **Instagram integration**: Folded into marketing/PR reports
- **Influencer tracking**: Campaign ROI analysis (board-only)

### Use Cases
1. Production multi-team deployments
2. Organizations with multiple stakeholder groups
3. Scenarios requiring historical memory
4. Interactive report exploration
5. Scheduled automatic reporting

### Features
- Group registry (S3-backed)
- Historical snapshot comparison
- Compact chart+caption summaries
- Full text reports via `/details`
- Cross-audience viewing (`/board`, `/marketing`, etc.)
- Instagram performance tracking
- Influencer campaign ROI

### Usage
```bash
# Start bot (long-polling)
node src/bot.js

# Or programmatic
const { createBot } = require('./src/index.js');
const bot = createBot();
bot.launch();
```

### Configuration Required
All legacy pipeline config plus:
- `AWS_BUCKET_NAME`
- `AWS_S3_KEY_PREFIX`
- `AWS_REGION`
- `ADMIN_TELEGRAM_USER_ID`
- (Optional) `INSTAGRAM_*` credentials
- (Optional) `TOMASI_API_*` credentials

---

## Choosing Between Pipelines

### Use Legacy Pipeline If:
- ✅ Single chat/audience deployment
- ✅ No need for historical memory
- ✅ Simple cron/Lambda execution
- ✅ S3 not available or desired
- ✅ Testing/development

### Use Bot Pipeline If:
- ✅ Multiple teams/audiences
- ✅ Need historical comparisons
- ✅ Want interactive commands
- ✅ Scheduled automatic reports
- ✅ Production multi-group deployment
- ✅ Instagram/influencer tracking

---

## Shared Components

Both pipelines use the same underlying systems:

### Metrics Layer
- `src/metrics/` - Acquisition, conversion, engagement, geography, social
- **User-based calculations**: Conversion = unique purchasers / unique visitors
- **Distinct audience growth**: Measures reach expansion, not activity volume

### Comparison Layer
- `src/comparison/compare.js` - Health score, confidence score, percentage changes
- **Deterministic scoring**: Never calculated by AI

### AI Layer
- `src/ai/analysis.service.js` - Report generation with semantic structure
- **FACT/OBSERVATION/POSSIBLE EXPLANATION/RECOMMENDATION** distinction
- **Anti-fabrication rules**: Never invents data or states uncertain causes as fact

### Query Layer
- `src/queries/` - HogQL query definitions
- Date range handling, offset windows

---

## Migration Path

### From Legacy to Bot
If starting with legacy pipeline and need to add multi-group support:

1. Set up S3 bucket and configure `AWS_*` credentials
2. Register groups using bot's `/register` command
3. Deploy bot infrastructure (ECS/long-polling)
4. Switch from direct `pipeline.js` execution to bot scheduler

**No code changes required** - both use the same metrics/AI layers.

### From Bot to Legacy
If simplifying deployment:

1. Remove S3 dependencies
2. Switch to direct `pipeline.js` execution
3. Configure `TELEGRAM_CHAT_ID` for target chat
4. Set up cron/Lambda for scheduling

---

## Testing

### Legacy Pipeline Tests
```bash
# Pipeline execution is tested via collector/metrics tests
npm test -- tests/acquisition.test.js
npm test -- tests/conversion.metrics.test.js
```

### Bot Pipeline Tests
```bash
# Bot commands, scheduler, memory
npm test -- tests/bot.test.js
npm test -- tests/scheduler.test.js
npm test -- tests/reportMemory.test.js
npm test -- tests/reportGenerator.test.js
```

---

## Maintenance Status

| Component | Legacy Pipeline | Bot Pipeline |
|-----------|----------------|--------------|
| Metrics corrections | ✅ Applied | ✅ Applied |
| Semantic AI structure | ✅ Applied | ✅ Applied |
| Quarterly scheduling | ❌ N/A | ✅ Applied |
| Historical snapshots | ❌ Not used | ✅ Fixed |
| Active development | ⚠️ Maintenance only | ✅ Primary focus |

---

## Decision: Why Keep Both?

The legacy pipeline is **intentionally maintained** because:

1. **Simplicity**: Some deployments don't need bot complexity
2. **Stateless environments**: Works where S3 isn't available
3. **Testing**: Easier to test metrics/AI without bot infrastructure
4. **Backwards compatibility**: Existing single-chat deployments remain supported
5. **Low cost**: Minimal maintenance burden (shares all core logic)

Both pipelines are **production-ready** and **fully supported**.
