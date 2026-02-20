# Aboutness V2 — Emotions + Moments

_Spec written before code. Governs all implementation decisions._

## Goal

Replace the metadata-derived heuristic approach (V1) with LLM-generated, title+artist-only profiles split across two orthogonal axes:

1. **aboutnessEmotions** — What the song _feels like_: mood, energy, emotional arc, texture.
2. **aboutnessMoments** — When/where it _fits_: scene, activity, social context, time-of-day, setting.

Use both as retrieval signals so a query like "sketching alone at 1am" can match on moment-fit, while a query like "driving and hopeful" matches on emotional character.

## Non-goals (V2)

- No lyrics ingestion or external metadata in generation prompts.
- No album/year/tags/popularity in prompts.
- No local model fallback (OpenAI only, decided after A/B pilot).
- No automatic migration on startup.
- No second embedding model (reuse Xenova/all-MiniLM-L6-v2, 384-dim).
- No HNSW index on `moments_vector` yet (rerank on candidate set only).
- Redis not required for correctness.

## Flow

```
[Offline backfill — apps/api/scripts/ingestion/aboutness-v2-backfill.ts]
  songs (title + artist only)
    → generateEmotionsAboutness(title, artist)  [OpenAI, gpt-4o-mini]
    → generateMomentsAboutness(title, artist)   [OpenAI, gpt-4o-mini]
    → validate + retry if: bad confidence tag | >500 chars | starts with "Confidence:"
    → embed emotions_text via Xenova/all-MiniLM-L6-v2 → emotions_vector (384)
    → embed moments_text via Xenova/all-MiniLM-L6-v2 → moments_vector (384)
    → UPSERT → song_aboutness (extended schema)

[Runtime, ABOUTNESS_V2_ENABLED=true]
  user prompt → embed → query_vector
    ↓
  parallel KNN:
    (A) songs.embedding_vector           ← title/artist/tags metadata
    (B) song_aboutness.emotions_vector   ← emotional character (HNSW indexed)
    ↓
  union candidate song_ids
  fetch moments_vector for candidates only
  rerank:
    score = META_WEIGHT * sim_meta + EMOTION_WEIGHT * sim_emotion + MOMENT_WEIGHT * sim_moment
  return top K
```

## Data + API changes

### Extended table: `song_aboutness`

New columns added to existing table (backward-compatible):

| Column | Type | Notes |
|---|---|---|
| `emotions_text` | `text` | ≤500 chars |
| `emotions_vector` | `vector(384)` | HNSW cosine index |
| `emotions_confidence` | `text` | `low` / `medium` / `high` |
| `moments_text` | `text` | ≤500 chars |
| `moments_vector` | `vector(384)` | stored, NOT indexed yet |
| `moments_confidence` | `text` | `low` / `medium` / `high` |
| `provider` | `text` | `openai` |
| `generation_model` | `text` | e.g. `gpt-4o-mini` |

Existing columns (`aboutness_text`, `aboutness_json`, `aboutness_vector`, `aboutness_version`, `embedding_model`, `generated_at`) are kept but marked legacy. New generation writes `generation_version = 2` and fills only the new columns.

New indexes:
- `idx_song_aboutness_emotions_hnsw` — HNSW cosine, m=16, ef_construction=64 on `emotions_vector`

### New env flags (API)

| Var | Default | Purpose |
|---|---|---|
| `ABOUTNESS_V2_ENABLED` | `false` | Enable 3-signal union+rerank |
| `ABOUTNESS_META_WEIGHT` | `0.2` | Weight for metadata similarity |
| `ABOUTNESS_EMOTION_WEIGHT` | `0.5` | Weight for emotions similarity |
| `ABOUTNESS_MOMENT_WEIGHT` | `0.3` | Weight for moments similarity |
| `ABOUTNESS_TOPN_META` | `100` | KNN candidates from metadata |
| `ABOUTNESS_TOPN_EMOTION` | `100` | KNN candidates from emotions |
| `OPENAI_API_KEY` | required | For generation |
| `ABOUTNESS_OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model |

### API response extensions (when ABOUTNESS_V2_ENABLED)

```json
{
  "distMeta": 0.32,
  "distEmotion": 0.18,
  "distMoment": 0.25,
  "aboutScore": 0.74,
  "aboutness": {
    "emotions": "A slow burn of melancholy...",
    "emotions_confidence": "high",
    "moments": "Late night, driving alone on an empty highway...",
    "moments_confidence": "medium"
  }
}
```

## Output contract (both fields)

- 220–420 chars target, hard cap 500
- Plain English, 1 paragraph, no lists
- No lyric quotes, no factual claims unless clearly certain
- End with exactly: `[confidence: low]` | `[confidence: medium]` | `[confidence: high]`
- Confidence = how confident the model is the description is correct for that specific song

### Emotions prompt

> Describe what this song feels like to listen to — its mood, emotional arc, energy level, and texture. Focus on the internal emotional experience. Be vivid and specific. Avoid generic descriptors. Max 500 characters. End with [confidence: low/medium/high].

### Moments prompt

> Describe when and where this song fits — a specific scene, activity, time of day, or social setting. Prefer concrete scene cues over generic "ideal for…" phrases. For example: "sketching alone at 1am with one lamp on" rather than "good for late-night study." Max 500 characters. End with [confidence: low/medium/high].

## Failure modes

| Mode | Behavior |
|---|---|
| Aboutness row missing | sim_emotion=sim_moment=0; song still eligible via meta leg |
| emotions_vector missing | fall back to meta+moments rerank |
| ABOUTNESS_V2_ENABLED=false | existing code path unchanged |
| Backfill interrupted | safe to re-run; skips songs with existing version=2 row |
| OpenAI call fails | retry once, then log error + continue |
| Bad output (no confidence tag, >500 chars) | retry once; if still invalid, log + skip |

## Acceptance criteria

- [x] V1 metadata-derived rows purged from DB
- [ ] `song_aboutness` extended with emotions/moments columns + HNSW on emotions_vector
- [ ] OpenAI generator (`generator.ts`) with retry logic
- [ ] Backfill script: resumable, no OFFSET, logs ETA
- [ ] Sample review: 10-song file-only output, no DB writes
- [ ] With ABOUTNESS_V2_ENABLED=false: zero change to existing behavior
- [ ] With ABOUTNESS_V2_ENABLED=true: match results include aboutness fields, 3-signal scoring
- [ ] UI "Why" panel shows emotions + moments when data present
- [ ] All existing tests still pass
- [ ] Migration applied explicitly (not on startup)
