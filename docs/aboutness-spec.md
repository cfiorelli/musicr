# Aboutness V1 — Implementation Spec

_Written before code. Governs all implementation decisions._

## Goal

Surface rich, structured "aboutness" metadata for each song — a compact profile describing its essence (mood, themes, energy, sensory feel) — and use it as a second embedding axis during retrieval, so that a prompt like "something for a rainy night drive" can match not just on title/tags but on experiential character.

## Non-goals (V1)

- No lyrics ingestion or LLM calls (purely deterministic, offline)
- No user-facing editor for aboutness
- No automatic migration on startup
- No second embedding model (reuse same 384-dim Xenova model)
- Redis is never required for correctness

## Flow

```
[Offline backfill script]
  songs (title/artist/album/year/tags/popularity)
    → derive aboutness_json (structured fields)
    → render aboutness_text (≤500 chars)
    → embed aboutness_text via Xenova/all-MiniLM-L6-v2 → vector(384)
    → upsert → song_aboutness table

[Runtime, ABOUTNESS_ENABLED=true]
  user prompt → embed → query vector
    ↓
  parallel KNN:
    (A) songs.embedding_vector  ← title/artist/tags meta
    (B) song_aboutness.aboutness_vector ← experiential character
    ↓
  union candidate songIds
  rerank: score = META_WEIGHT * sim_meta + ABOUTNESS_WEIGHT * sim_about
  return top K
```

## Data & API changes

### New table: `song_aboutness`

| Column | Type | Notes |
|---|---|---|
| songId | uuid PK FK→songs.id | one-to-one |
| aboutnessText | text | ≤500 chars, enforced in code |
| aboutnessJson | jsonb | structured profile |
| aboutnessVector | vector(384) | cosine HNSW |
| aboutnessVersion | int | 1 for V1 |
| embeddingModel | text | "Xenova/all-MiniLM-L6-v2" |
| generatedAt | timestamptz | |

### aboutnessJson schema

```ts
{
  mode: "instrumental" | "lyrics" | "unknown"
  mood: string[]        // 3–8 moods
  sensory: string[]     // 2–5 short phrases
  setting: string       // ≤120 chars
  energy: { level: 0-100, motion: string }
  arc: { start: string, peak: string, end: string } // each ≤60 chars
  themes: string[]      // 3–8 themes
  confidence: "low" | "medium" | "high"
  source: "experience-only" | "metadata-derived" | "lyrics-provided-by-user"
}
```

### New env flags

| Var | Default | Purpose |
|---|---|---|
| ABOUTNESS_ENABLED | false | Enable union+rerank path |
| ABOUTNESS_TOPN | 100 | KNN candidates per leg |
| ABOUTNESS_WEIGHT | 0.7 | Weight for aboutness sim |
| META_WEIGHT | 0.3 | Weight for meta sim |

### API response extensions (when ABOUTNESS_ENABLED)

`/api/map` and WS song result include:

```json
{
  "distMeta": 0.32,
  "distAbout": 0.18,
  "aboutScore": 0.74,
  "aboutness": {
    "themes": ["nostalgia","solitude"],
    "mood": ["melancholy","reflective"],
    "setting": "Late night, empty streets",
    "oneLiner": "A quiet ache for something just out of reach."
  }
}
```

## Failure modes

| Mode | Behavior |
|---|---|
| aboutness KNN query fails | Fall back to meta-only ranking |
| song_aboutness row missing | sim_about=0; song still eligible via meta leg |
| ABOUTNESS_ENABLED=false | existing code path unchanged |
| Backfill interrupted | Safe to re-run; skips rows where version=1 exists |
| Migration not applied | ABOUTNESS_ENABLED must stay false until migration runs |

## Acceptance criteria

- [ ] `song_aboutness` table + HNSW index created via migration
- [ ] Backfill script processes top 10k songs, logs ETA, is idempotent
- [ ] With ABOUTNESS_ENABLED=false: no change to existing behavior
- [ ] With ABOUTNESS_ENABLED=true: match results include aboutness fields
- [ ] UI "why?" panel shows themes + mood chips when aboutness data present
- [ ] All existing tests still pass
- [ ] Migration applied explicitly (not on startup)
