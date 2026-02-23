# Aboutness V2 — Pilot Optimization Spec

_Created: 2026-02-20_

## Goal

Implement and validate two targeted optimizations before continuing the 114k-song backfill:

1. **Shorter text output** — change per-field hard cap from 500 → 100 chars, target 50–90 chars; store clean text without `[confidence: ...]` tag suffix
2. **Batched OpenAI calls** — send 10 songs per API request as JSON instead of 2 calls per song; reduces RPD usage 10× (5,000 → 100,000 songs/day capacity)

Run a 100-song pilot to validate quality and cost before switching the main backfill.

## Non-Goals

- No schema changes (no new columns, no `ALTER TABLE`, no `prisma migrate`)
- No changes to existing `song_aboutness` rows (version=2 rows already written stay as-is)
- No re-embedding already-generated rows
- No changes to ChatInterface display logic (tag-strip already exists there)
- No changes to the main `aboutness-v2-backfill.ts` script in this task (pilot script is separate)
- No evaluation of retrieval/matching quality

## Current State (before this patch)

| Property | Current value | Problem |
|----------|--------------|---------|
| MAX_CHARS | 500 | Consistently hit; 95.6% of emotions rows at 499c |
| max_tokens | 200 | ~800 char capacity → model reliably overruns 500c |
| Stored text | Includes `[confidence: low]` suffix | Tag is display-only noise, wastes DB space, wastes embedding dimensions |
| Calls/song | 2 parallel (emotions + moments) | 2 RPD units per song → 5,000 songs/day ceiling |
| Throughput | 0.3 songs/s (RPD-bound) | Full backfill ~21.5 days |
| Cost/song | $0.000246 | Projected $28.16 for 114k songs |

## Optimization Flow (new path)

```
For each batch of 10 songs:
  1 OpenAI call with:
    - model: gpt-4o-mini
    - System prompt: JSON output schema (emotions + moments per song_id)
    - User message: list of {song_id, title, artist}
    - max_tokens: 600  (10 songs × ~60 tokens each)
    - temperature: 0.7

  Parse JSON response → array of { song_id, emotions, moments, emotions_confidence, moments_confidence }
  For each song in response:
    - Strip confidence tag from stored text (confidence stored in separate column)
    - Validate: text 20–100 chars, confidence tag present
    - Embed emotions_text, moments_text
    - Upsert song_aboutness

  Fallback: any song failing JSON parse → individual 1-song call (current single path)
  Retry: 429 → 15s wait, retry once; 429 again → 30s wait, retry once more
```

## API / Data Changes

None. The `song_aboutness` table schema is unchanged:
- `emotions_text TEXT` — will now store clean text (max ~100c, no tag suffix) for new rows
- `emotions_confidence TEXT` — unchanged (still 'low'/'medium'/'high')
- `moments_text TEXT` — same as emotions_text
- `moments_confidence TEXT` — unchanged

Existing rows already have the tag in their text field. That's fine — old rows are not touched.

ChatInterface.tsx already strips `[confidence: ...]` for display — no UI change needed.

## Failure Modes

| Failure | Handling |
|---------|----------|
| JSON parse error (entire batch) | Fall back to individual 1-song calls for all 10 songs |
| Individual song missing from JSON | Fall back to individual 1-song call for that song |
| 429 Rate limit | Exponential backoff: 15s then 30s; log retry count |
| Invalid text (out of range / missing tag) | Retry individual call once; if still invalid, force minimal valid response |
| Embedding failure | Log error, skip song (don't upsert partial data) |
| Network timeout | Propagate as error, song counted as failed |

## Pilot Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Songs | 100 | Statistically meaningful, cheap to run |
| Batch size | 10 songs/call | Target batch size for production |
| Skips existing | Yes (V2 rows) | Safe: won't overwrite already-generated data |
| Concurrency | 1 batch at a time | Pilot: simple sequential to observe clearly |
| Output | `tmp/aboutness-v2-pilot-audit.md` + `tmp/aboutness-v2-pilot-sample.json` | |

## Acceptance Criteria

| Criterion | Pass threshold |
|-----------|---------------|
| Pilot completes without fatal error | Required |
| Batch success rate (no fallback needed) | ≥ 70% of batches parse cleanly |
| Per-song fallback rate | ≤ 20% of songs |
| Average emotions text length | 50–100 chars |
| Average moments text length | 50–100 chars |
| Zero truncation artifacts (`…` mid-text) | Required |
| Confidence tags NOT present in stored text | Required |
| Projected cost/song (from token counts) | ≤ $0.000120 (−50% vs current) |
| Projected RPD capacity | ≥ 20,000 songs/day |

## Optimization Evaluation Criteria

An optimization passes if it:
- Reduces cost or time by ≥ 20%
- Does NOT require schema changes
- Does NOT require re-embedding already-generated rows
- Pilot acceptance criteria all pass
