# Aboutness

"Aboutness" is a structured profile of a song's experiential character — split across two axes:

1. **Emotions** — what the song *feels like* (mood, energy, arc, texture)
2. **Moments** — when/where it *fits* (scene, activity, social context, time of day)

Both are used as retrieval signals alongside the existing metadata embedding, enabling matches like "sketching alone at 1am with one lamp on" to surface songs that fit that moment, not just songs tagged as "ambient."

## Why title+artist-only generation was chosen

**A/B pilot (Feb 2026)** compared OpenAI and a local Ollama model (qwen2.5:1.5b) on 10 songs. OpenAI produced more consistent, well-formatted output with proper confidence calibration. Local model sometimes failed to follow the format contract and produced shorter responses.

**Decision:** OpenAI is the sole provider. No album/year/tags/lyrics in the generation prompt — just `title` and `artist`. This keeps the prompt minimal and avoids confounding retrieval quality with tag quality.

## Schema

**Table:** `song_aboutness` (one row per song)

| Column | Type | Notes |
|---|---|---|
| `song_id` | `uuid PK FK→songs.id` | One-to-one with songs |
| `emotions_text` | `text` | ≤500 chars; embedded → `emotions_vector` |
| `emotions_vector` | `vector(384)` | HNSW cosine index |
| `emotions_confidence` | `text` | `low` / `medium` / `high` |
| `moments_text` | `text` | ≤500 chars; embedded → `moments_vector` |
| `moments_vector` | `vector(384)` | stored, NOT indexed (rerank on candidate set) |
| `moments_confidence` | `text` | `low` / `medium` / `high` |
| `provider` | `text` | `openai` |
| `generation_model` | `text` | e.g. `gpt-4o-mini` |
| `aboutness_version` | `int` | `2` for V2 rows |
| `generated_at` | `timestamptz` | When generated |

**Legacy columns** (`aboutness_text`, `aboutness_json`, `aboutness_vector`, `embedding_model`) are kept for schema compatibility but no longer written by V2 generation.

**Indexes:**
- `idx_song_aboutness_emotions_hnsw` — HNSW cosine, m=16, ef_construction=64 on `emotions_vector`
- `idx_song_aboutness_version` — btree on `aboutness_version`

## V2 generation (OpenAI, offline backfill)

V2 derives all fields from `title` + `artist` only via OpenAI gpt-4o-mini. The embedding uses the same `Xenova/all-MiniLM-L6-v2` model as the runtime query path (model mismatch = invisible songs).

### Emotions prompt

Describes what the song feels like: mood, emotional arc, energy, sonic texture.
Output: 220–420 chars target, 1 paragraph, ends with `[confidence: low|medium|high]`.

### Moments prompt

Describes when/where the song fits: specific scene, activity, time, social setting.
Prefers concrete cues ("sketching alone at 1am") over generic phrases ("ideal for late-night study").
Output: 220–420 chars target, 1 paragraph, ends with `[confidence: low|medium|high]`.

### Output contract (both fields)
- Hard cap 500 chars
- Plain English, 1 paragraph, no lists, no lyric quotes
- No invented facts unless clearly certain
- Confidence = how certain the model is for *this specific song*

## Sample review script

Run before full backfill to review quality:

```bash
DATABASE_URL=<url> OPENAI_API_KEY=<key> \
  pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-sample-review.ts

# Deterministic (same 10 songs every run):
  pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-sample-review.ts --deterministic
```

Outputs: `tmp/aboutness-v2-sample-review.md` and `.json`. No DB writes.

## Backfill script

```bash
# Dry run (no API calls, no DB writes)
DATABASE_URL=<url> OPENAI_API_KEY=<key> \
  pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-backfill.ts --dry-run

# Live: first 50 songs (test run)
DATABASE_URL=<url> OPENAI_API_KEY=<key> \
  pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-backfill.ts \
  --limit=50 --batchSize=10 --concurrency=3

# Full backfill
DATABASE_URL=<url> OPENAI_API_KEY=<key> \
  pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-backfill.ts \
  --batchSize=10 --concurrency=3

# Target specific songs (for testing)
  pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-backfill.ts \
  --ids=<uuid1>,<uuid2>
```

Script resumes automatically (skips songs with existing version=2 row).

## 3-signal retrieval

When `ABOUTNESS_V2_ENABLED=true`, matching uses:

1. **Metadata** (`songs.embedding_vector`) — title/artist/tags
2. **Emotions** (`song_aboutness.emotions_vector`) — what it feels like
3. **Moments** (`song_aboutness.moments_vector`) — when/where it fits

```
user query → embed → query_vector
  ↓
  KNN(meta, topN=100)     ← indexed
  KNN(emotions, topN=100) ← indexed
  ↓
  union candidate song_ids
  fetch moments_vector for candidates only (no full-table scan)
  ↓
  score = META_WEIGHT*sim_meta + EMOTION_WEIGHT*sim_emotion + MOMENT_WEIGHT*sim_moment
  return top K
```

## Env flags

| Variable | Default | Description |
|---|---|---|
| `ABOUTNESS_V2_ENABLED` | `false` | Enable 3-signal union+rerank |
| `ABOUTNESS_META_WEIGHT` | `0.2` | Weight for metadata similarity |
| `ABOUTNESS_EMOTION_WEIGHT` | `0.5` | Weight for emotions similarity |
| `ABOUTNESS_MOMENT_WEIGHT` | `0.3` | Weight for moments similarity |
| `ABOUTNESS_TOPN_META` | `100` | KNN candidates from metadata |
| `ABOUTNESS_TOPN_EMOTION` | `100` | KNN candidates from emotions |
| `OPENAI_API_KEY` | required | For backfill generation only |
| `ABOUTNESS_OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model for generation |

Restart API after changing flags (read at module load time).

## Rollout steps

1. Apply migration (already done): `pnpm exec prisma migrate deploy`
2. Run sample review: review `tmp/aboutness-v2-sample-review.md`
3. Run small backfill: `--limit=50` and verify rows/vectors in DB
4. Run full backfill with desired coverage
5. Redeploy API + web
6. Set `ABOUTNESS_V2_ENABLED=true` in Railway Variables → redeploy

## Rollback

Set `ABOUTNESS_V2_ENABLED=false` and redeploy. No data changes needed — the table stays, retrieval falls back to metadata-only path.

## UI

When `ABOUTNESS_V2_ENABLED=true` and a song has V2 aboutness data, the "why?" panel shows:
- **Feels like** section (violet) — emotions text with confidence
- **Fits when** section (green) — moments text with confidence
- Debug scores (meta/emotion/moment) when `?debug=1`

The "why?" button appears whenever `msg.similarity !== undefined`.
