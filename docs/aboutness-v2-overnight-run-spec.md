# Aboutness V2 — Overnight Run Spec

_Created: 2026-02-21_

## Goal

Run the Aboutness V2 backfill overnight, monitor quality/coverage at regular
intervals, and conditionally enable V2 in production if and when the coverage
threshold (≥50%) is met.

## Non-Goals

- No schema changes, no migrations, no Prisma schema edits
- No deletion or regeneration of existing V2 rows
- No enablement of ABOUTNESS_V2_ENABLED until activation gate passes
- No changes to product code (search, matching, UI)

## Flow

```
1. Precheck: git state, env vars, Railway CLI, prod API health
2. Ensure exactly one backfill nohup process running (batchSize=10 concurrency=1)
3. Monitor loop every 15 min:
   a. Snapshot backfill progress (last 5 progress lines)
   b. DB coverage query (total / V2 rows / %)
   c. Quality check on latest 500 rows (lengths, tag leaks, truncation)
   d. Error indicators from log (429s, fallbacks, failures)
   e. Append timestamped snapshot to overnight-monitor.md
4. Milestone audits at: 10k, 50k, 100k V2 rows
   - Sample 100 rows, check quality, include 10 sample rows
5. Activation gate check (every cycle, act when ALL pass):
   - Coverage >= 50% of non-placeholder songs
   - 0 rows > 100c in latest 1000
   - 0 confidence tag leaks in latest 1000
   - No active error spike
   - API health ok:true
6. If gate met: baseline A/B check → enable ABOUTNESS_V2_ENABLED → verify → re-run prompts
7. Final report written whether activated or not
```

## Current State (at overnight run start)

| Item | Value |
|------|-------|
| Total non-placeholder songs | 114,336 |
| V2 rows | ~4,427 |
| Coverage | ~3.87% |
| Backfill rate | ~0.67 songs/s |
| 50% threshold | ~57,168 rows |
| ETA to 50% | ~22 hours |
| Activation expected? | NO (overnight ~8-10h = ~24% max) |

## Failure Modes

| Failure | Handling |
|---------|----------|
| Backfill process dies | Monitor detects, relaunches with same flags |
| 429 spike (>10 in window) | Log warning; backfill's withRateLimitRetry handles internally |
| Quality regression (tag leak) | Log ALERT; leave V2 disabled; escalate in final report |
| DB connection failure | Log error; retry next cycle |
| Railway CLI failure | Log error; skip activation; record in final report |

## Acceptance Criteria for Activation

| Criterion | Threshold |
|-----------|-----------|
| Coverage | ≥ 50% non-placeholder songs |
| Max emotions_text length | ≤ 100c (0 violations in latest 1000) |
| Max moments_text length | ≤ 100c (0 violations in latest 1000) |
| Confidence tag in stored text | 0 occurrences in latest 1000 |
| API health | ok:true |
| Backfill stable | Running or completed, no error spike |
