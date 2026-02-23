# Aboutness V2 — Rollout Wireup Spec

_Created: 2026-02-20_

## Goal

Wire the full resumable backfill script (`aboutness-v2-backfill.ts`) to use the
pilot-proven batched generator (`generateAboutnessBatch`) instead of the old
two-call-per-song pattern, then run the full 114k-song backfill safely.

## Non-Goals

- No schema changes, no `ALTER TABLE`, no `prisma migrate`
- No Prisma schema changes
- No deletion or regeneration of existing V2 rows (~7,400 old-style rows)
- No enabling `ABOUTNESS_V2_ENABLED` (deferred until ≥50% coverage)
- No changes to `generator.ts` — pilot already patched that file
- No changes to search/matching service

## Current Code State (Phase 1 findings)

| File | Path | Current State |
|------|------|--------------|
| Batched generator | `apps/api/src/services/aboutness/generator.ts` | **New** — `generateAboutnessBatch()` export, pilot-proven |
| Full backfill script | `apps/api/scripts/ingestion/aboutness-v2-backfill.ts` | **Old** — still calls `generateEmotionsAboutness` + `generateMomentsAboutness` per song (2 OpenAI calls/song) |
| Pilot script | `apps/api/scripts/ingestion/aboutness-v2-pilot.ts` | Pilot-only, not used for production |

The full backfill must be patched to import and call `generateAboutnessBatch`
with `batchSize=10` songs per OpenAI request.

## Flow (after patch)

```
for each DB page of batchSize songs (cursor-based, skip existing V2 rows):

  1. Call generateAboutnessBatch([{song_id, title, artist}, ...])
     → 1 OpenAI request per batchSize songs (both emotions + moments in JSON)

  2. For each song in response:
     a. embedText(emotions_text) → emotions_vector
     b. embedText(moments_text)  → moments_vector
     c. upsertRow(...)

  Fallback: if batch JSON parse fails → per-song individual calls (old path)
  Retry: 429 → 15s/30s backoff (already in generator.ts withRateLimitRetry)
```

Resumability: unchanged — cursor on `song_id`, skips rows with existing V2 row.

## Data/API Changes

None. `song_aboutness` schema unchanged. New rows stored with:
- `emotions_text`: clean text, ≤100c, no confidence tag suffix
- `moments_text`: same
- `emotions_confidence` / `moments_confidence`: 'low'|'medium'|'high'

## Failure Modes

| Failure | Handling |
|---------|----------|
| Batch JSON parse error | Fall back to per-song individual calls for that batch |
| 429 rate limit | `withRateLimitRetry` in generator: 15s then 30s wait |
| Per-song generation error | Log + count as error; skip upsert; continue |
| DB upsert error | Log + count as error; continue |
| Embedding failure | Log + count as error; skip upsert |

## Acceptance Criteria

| Criterion | Pass threshold |
|-----------|---------------|
| Smoke run (50 songs) completes | Required |
| `char_length(emotions_text) <= 100` for new rows | 100% |
| `char_length(moments_text) <= 100` for new rows | 100% |
| No `[confidence:` in `emotions_text` | 100% |
| No `[confidence:` in `moments_text` | 100% |
| Batch path used (not per-song) in smoke run | Confirmed in logs |
| Full backfill running with valid PID + log | Required |
