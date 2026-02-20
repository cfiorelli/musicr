# Aboutness

"Aboutness" is a structured profile of a song's experiential character — its mood, themes, energy, sensory feel, and narrative arc — stored separately from the song's title/artist metadata and used as a second embedding axis during retrieval.

## Why it exists

The title/artist/tags embedding captures *what* a song is labelled as. Aboutness captures *what it feels like* — so a prompt like "something for a rainy night drive" can match on experiential character, not just words.

## Schema

**Table:** `song_aboutness`

| Column | Type | Notes |
|---|---|---|
| `song_id` | `uuid PK FK→songs.id` | One-to-one with songs |
| `aboutness_text` | `text` | ≤500 chars; embedded to produce vector |
| `aboutness_json` | `jsonb` | Structured profile (see below) |
| `aboutness_vector` | `vector(384)` | HNSW cosine index |
| `aboutness_version` | `int` | 1 for V1 |
| `embedding_model` | `text` | `"Xenova/all-MiniLM-L6-v2"` |
| `generated_at` | `timestamptz` | When generated |

**`aboutness_json` fields:**

```ts
{
  mode: "instrumental" | "lyrics" | "unknown"
  mood: string[]        // 3–8 descriptors
  sensory: string[]     // 2–5 short phrases
  setting: string       // ≤120 chars
  energy: { level: number (0–100), motion: string }
  arc: { start: string, peak: string, end: string }  // each ≤60 chars
  themes: string[]      // 3–8 themes
  confidence: "low" | "medium" | "high"
  source: "experience-only" | "metadata-derived" | "lyrics-provided-by-user"
}
```

**Indexes:**
- `idx_song_aboutness_hnsw` — HNSW cosine, m=16, ef_construction=64
- `idx_song_aboutness_version` — btree on `aboutness_version`

## V1 generation (deterministic, offline)

V1 derives all fields from existing song metadata (title / artist / album / year / tags / popularity). No LLM, no external APIs, no lyrics. The embedding uses the **same** `Xenova/all-MiniLM-L6-v2` model as the runtime query path (dimension mismatch = invisible songs — learned the hard way).

## Running the backfill

Apply the migration first (see Deploy section), then:

```bash
# Dry run (no DB writes)
pnpm -C apps/api exec tsx scripts/ingestion/aboutness-backfill.ts \
  --dry-run --onlyTopN=100

# Live: top 10k songs by popularity, batch size 32
pnpm -C apps/api exec tsx scripts/ingestion/aboutness-backfill.ts \
  --onlyTopN=10000 --batchSize=32

# Resume: script skips songs with existing version=1 row automatically
# Re-running is safe.

# Custom limit
pnpm -C apps/api exec tsx scripts/ingestion/aboutness-backfill.ts \
  --onlyTopN=10000 --limit=500 --batchSize=32
```

Progress is logged every batch:
```
{"progress":"1024/10000 (10.2%)","rate":"12.4 songs/s","eta":"725s remaining"}
```

## Enabling aboutness retrieval

Set environment variables on the API service (Railway → Variables tab):

| Variable | Default | Description |
|---|---|---|
| `ABOUTNESS_ENABLED` | `false` | Enable union+rerank path |
| `ABOUTNESS_TOPN` | `100` | KNN candidates per leg |
| `ABOUTNESS_WEIGHT` | `0.7` | Weight for aboutness similarity |
| `META_WEIGHT` | `0.3` | Weight for meta similarity |

Restart the API after changing. The flag is read at module load time.

**Turn on:** `ABOUTNESS_ENABLED=true`
**Turn off:** `ABOUTNESS_ENABLED=false` (or remove the variable)

## Tuning weights

Combined score: `score = META_WEIGHT × sim_meta + ABOUTNESS_WEIGHT × sim_about`

- Increase `ABOUTNESS_WEIGHT` → more influence from experiential character
- Increase `META_WEIGHT` → more influence from title/artist/tags metadata
- Weights don't need to sum to 1 (just a linear combination)

If aboutness data is missing for a song, `sim_about = 0` (song is still eligible via meta leg).

Start conservative: `META_WEIGHT=0.5, ABOUTNESS_WEIGHT=0.5`. Increase `ABOUTNESS_WEIGHT` if matches feel too literal.

Reduce `ABOUTNESS_TOPN` (e.g., 60) to improve latency if you see regression.

## Deploy plan

1. Apply migration **once** (do not add to startup):
   ```bash
   # In Railway API service shell, or as a one-off job:
   pnpm -C apps/api prisma migrate deploy
   ```

2. Redeploy API + web (migration is backward-compatible — new table, no column changes)

3. Run backfill from your machine or Railway one-off:
   ```bash
   DATABASE_URL=<prod_url> pnpm -C apps/api exec tsx \
     scripts/ingestion/aboutness-backfill.ts --onlyTopN=10000
   ```

4. Verify:
   - `GET /health` → still returns `ok`
   - Send a chat message → match returns and UI renders

5. Enable: set `ABOUTNESS_ENABLED=true` in Railway Variables → redeploy

## Rollback

Set `ABOUTNESS_ENABLED=false` and redeploy. No data changes needed — the table stays, retrieval just uses the meta-only path.

To drop the table (if needed):
```sql
DROP TABLE IF EXISTS song_aboutness;
```

## UI

When `ABOUTNESS_ENABLED=true` and a song has aboutness data, the "why?" panel shows:
- Mood chips (violet, max 6)
- Theme chips (green, max 6)
- One-liner describing the experiential character
- Debug scores (distMeta / distAbout) when `?debug=1`

The "why?" button appears whenever `reasoning` OR `aboutness` is present on a message.
