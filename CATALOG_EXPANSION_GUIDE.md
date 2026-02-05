# Catalog Expansion Guide

Complete guide for expanding Musicr's song library with REAL metadata-only tracks from MusicBrainz.

## Overview

This pipeline fetches, imports, and embeds 50k+ real songs from MusicBrainz using a repeatable, scalable process.

**Hard Rules:**
- ✅ Only REAL songs with provenance (MBID required)
- ❌ NO synthetic/placeholder songs (e.g., "Blue Song", "Red Track")
- ✅ Placeholder detection applied at import time
- ✅ All imports set `is_placeholder=false`
- ✅ Same embedding model as runtime (`text-embedding-3-small`, 384 dims)

---

## Quick Start (50k Songs)

```bash
cd apps/api

# Step 1: Fetch 50k songs from MusicBrainz (takes ~14 hours with rate limits)
pnpm catalog:mb:fetch --target=50000

# Step 2: Import to database (with placeholder detection)
pnpm catalog:mb:import

# Step 3: Generate embeddings (takes ~16 hours, costs ~$1)
pnpm catalog:embed

# Step 4: Verify results
pnpm catalog:stats
pnpm catalog:safety
```

---

## Phase Breakdown

### Phase 0: Cleanup ✅ COMPLETE

**Objective:** Remove/disable fabricated catalog generators

**Status:** Already done
- `scripts/generate-5k-songs.ts` — DEPRECATED, disabled with warnings
- `generateVariations()` function returns empty array
- Outputs to `docs/archive/` only (never production)

**Verification:**
```bash
grep -r "generateVariations" apps/api/scripts/generate-5k-songs.ts
# Should show: returns empty array
```

---

### Phase 1: MusicBrainz Ingestion

#### 1.1 Fetch Songs (Genre-Based)

**Script:** `scripts/ingestion/musicbrainz-genre-fetcher.ts`

**Strategy:**
- Query MusicBrainz by broad genres/tags (rock, pop, hip hop, etc.)
- Target: 50,000 unique tracks
- Output: JSONL file (`musicbrainz-50k.jsonl`)

**Run:**
```bash
cd apps/api

# Fetch 50k songs (resumable)
pnpm catalog:mb:fetch --target=50000

# Output: apps/api/scripts/ingestion/musicbrainz-50k.jsonl
# Checkpoint: apps/api/scripts/ingestion/musicbrainz-50k.checkpoint.json
```

**Features:**
- ✅ Resumable (checkpoint file tracks progress)
- ✅ Rate limiting (1 req/sec, respects MusicBrainz limits)
- ✅ Deduplication by MBID
- ✅ Retries on 503/429 errors
- ✅ Progress logging every 100 songs

**Output Format (JSONL):**
```json
{"title":"Bohemian Rhapsody","artist":"Queen","album":"A Night at the Opera","year":1975,"tags":["rock","classic rock","progressive rock"],"mbid":"b1a9c0e9-d987-4042-ae91-78d6a3267d69","isrc":"GBUM71029604","source":"musicbrainz","sourceUrl":"https://musicbrainz.org/recording/b1a9c0e9..."}
```

**Time Estimate:**
- 50,000 songs @ 1 req/sec = ~14 hours
- Can pause and resume anytime

**Genres Queried:**
```
rock, pop, hip hop, electronic, jazz, metal, indie, punk,
country, r&b, folk, classical, reggae, soul, blues,
alternative, dance, funk, disco, house, techno, dubstep,
ska, grunge
```

#### 1.2 Import Songs (Bulk Importer)

**Script:** `scripts/ingestion/musicbrainz-bulk-importer.ts`

**Run:**
```bash
cd apps/api

# Import from JSONL (with placeholder detection)
pnpm catalog:mb:import

# Dry run first (recommended)
pnpm catalog:mb:import -- --dry-run

# Custom input file
pnpm catalog:mb:import -- path/to/custom.jsonl
```

**Features:**
- ✅ Placeholder detection (rejects fake songs)
- ✅ Quarantines rejected songs to `*.quarantine.txt`
- ✅ Sets `is_placeholder=false` for all imports
- ✅ Deduplication by ISRC (preferred) or MBID
- ✅ Idempotent (safe to re-run)
- ✅ Progress logging every 100 songs

**Quarantine Output:**
```
Blue Song — Test Artist | Reason: Simple type suffix: "Blue Song"
Golden Track — Fake Band | Reason: Adjective+Type pattern: "Golden Track"
```

**Expected Results:**
```
Total:         50000
Imported:      49850  (new songs)
Skipped:       100    (already exist)
Placeholders:  50     (REJECTED)
Errors:        0
```

---

### Phase 2: Embedding Backfill

**Script:** `scripts/ingestion/embedding-backfill.ts` (already exists)

**Run:**
```bash
cd apps/api

# Generate embeddings for all songs missing embedding_vector
pnpm catalog:embed

# Dry run
pnpm catalog:embed -- --dry-run

# Limit to 1000 songs
pnpm catalog:embed -- --limit=1000

# Custom batch size
pnpm catalog:embed -- --batch=100
```

**Process:**
1. Find songs where `embedding_vector IS NULL` AND `is_placeholder = false`
2. Generate text: `"{title} — {artist} ({year}) tags:{tags}"`
3. Call OpenAI API: `text-embedding-3-small` (384 dimensions)
4. Store in `embedding_vector` column (native pgvector)
5. Rate limit: 50 requests/min (~1200ms between requests)

**Time & Cost (50k songs):**
- Time: ~16-18 hours (rate limited)
- Cost: ~$1.00 USD (50,000 × $0.00002)

**Progress Output:**
```
progress: 5000/50000
percent: 10.0%
processed: 5000
errors: 0
estimatedCost: $0.1000
```

**Verification:**
```sql
SELECT COUNT(*) FROM songs WHERE embedding_vector IS NULL AND is_placeholder = false;
-- Should be 0 or very low
```

---

### Phase 3: Verification

#### 3.1 Catalog Statistics

**Run:**
```bash
pnpm catalog:stats
```

**Output:**
```
==========================================================
CATALOG STATISTICS
==========================================================

Total Songs: 50497

Breakdown by Source:
  musicbrainz    : 50000
  manual         : 497

Placeholder Status:
  Real songs     : 50497
  Placeholders   : 0

Embedding Coverage (Real Songs Only):
  With embedding    : 50497
  Missing embedding : 0
  Coverage: 100.0%

Recent Songs (Sample):
  Bohemian Rhapsody — Queen (1975) [musicbrainz]
    MBID: b1a9c0e9-d987-4042-ae91-78d6a3267d69
  ...

Test Similarity Query:
  Results:
    Happy — Pharrell Williams (similarity: 82.3%)
    Good Life — Kanye West (similarity: 78.1%)
    ...
```

#### 3.2 Safety Check

**Run:**
```bash
pnpm catalog:safety
```

**What it checks:**
- Database: All songs in `songs` table
- Catalog file: `data/songs_seed.csv`

**Rules Applied:**
1. Exact matches: "Found Song", "True Track", etc.
2. Pattern: `(Adjective) (Type)` (e.g., "Blue Song")
3. Simple type suffix: "X Song", "Y Track"
4. Numbered placeholders: "Red Track 2"
5. Trivial phrases matching title+artist

**Exit Codes:**
- `0` = PASS (no placeholders)
- `1` = FAIL (placeholders found)

**Use in CI:**
```bash
# In GitHub Actions / pre-deploy
pnpm catalog:safety || exit 1
```

---

## Phase 4: Sample Queries

### Embedding Similarity Query

```sql
-- Find songs similar to a message
WITH message_embedding AS (
  SELECT embedding_vector
  FROM (VALUES ('[0.1, 0.2, ...]'::vector)) AS t(embedding_vector)
)
SELECT
  title,
  artist,
  1 - (embedding_vector <=> (SELECT embedding_vector FROM message_embedding)) AS similarity
FROM songs
WHERE embedding_vector IS NOT NULL
  AND is_placeholder = false
ORDER BY embedding_vector <=> (SELECT embedding_vector FROM message_embedding)
LIMIT 10;
```

### Count by Source

```sql
SELECT source, COUNT(*) as count
FROM songs
WHERE is_placeholder = false
GROUP BY source
ORDER BY count DESC;
```

### Missing Embeddings

```sql
SELECT COUNT(*)
FROM songs
WHERE embedding_vector IS NULL
  AND is_placeholder = false;
```

---

## Scaling Beyond 50k

### To 100k Songs

```bash
# Fetch 100k
pnpm catalog:mb:fetch -- --target=100000

# Import
pnpm catalog:mb:import

# Embed (will take ~32 hours, ~$2)
pnpm catalog:embed
```

### To 500k Songs

Same process, but:
- Time: ~4-5 days for fetching
- Embedding cost: ~$10
- Consider batching imports and embeddings

### Custom Sources

**Add Spotify (future):**
1. Create `spotify-fetcher.ts` (similar to MB fetcher)
2. Output JSONL with `source="spotify"`, `spotifyTrackId` required
3. Import via same bulk importer
4. Embed via same backfill script

---

## Troubleshooting

### "503 Service Unavailable" from MusicBrainz

**Cause:** Rate limit hit
**Fix:** Auto-retries with 5 second backoff

### "All songs skipped during import"

**Cause:** Songs already exist (MBID/ISRC dedup working)
**Fix:** This is normal on re-runs. To import new songs, fetch more from MB.

### "Embedding backfill stuck at X%"

**Cause:** Rate limiting or API errors
**Fix:**
- Check logs for specific errors
- Re-run (it will resume from where it left off)
- Reduce batch size: `pnpm catalog:embed -- --batch=25`

### "Placeholder songs detected"

**Cause:** Bad data in source JSONL
**Fix:**
- Check `*.quarantine.txt` for rejected songs
- If legitimate, update `placeholder-detector.ts` rules
- Re-import

### "Database connection timeout during embed"

**Cause:** Long-running process
**Fix:**
- Use `--limit=1000` and run in batches
- Increase `healthcheckTimeout` in Railway config

---

## File Reference

### New Scripts

```
apps/api/scripts/ingestion/
  musicbrainz-genre-fetcher.ts    # Fetches 50k from MB by genre
  musicbrainz-bulk-importer.ts    # Imports JSONL with placeholder detection

apps/api/scripts/
  catalog-safety-check.ts         # Verifies no placeholders in DB/files
  catalog-stats.ts                # Shows DB state and metrics
```

### Modified Files

```
apps/api/package.json               # Added new pnpm commands
apps/api/scripts/generate-5k-songs.ts  # DEPRECATED (generateVariations disabled)
```

### Output Files (Generated)

```
apps/api/scripts/ingestion/
  musicbrainz-50k.jsonl           # Fetched songs (JSONL)
  musicbrainz-50k.checkpoint.json # Resume checkpoint
  musicbrainz-50k.quarantine.txt  # Rejected placeholder songs
```

---

## pnpm Commands Reference

```bash
# Fetching
pnpm catalog:mb:fetch              # Fetch 50k songs from MusicBrainz
pnpm catalog:mb:fetch -- --target=100000  # Custom target

# Importing
pnpm catalog:mb:import             # Import from JSONL
pnpm catalog:mb:import -- --dry-run  # Test without changes
pnpm catalog:mb:import -- custom.jsonl  # Custom input file

# Embedding
pnpm catalog:embed                 # Generate all missing embeddings
pnpm catalog:embed -- --limit=1000   # Limit to 1000 songs
pnpm catalog:embed -- --dry-run      # Test without API calls

# Verification
pnpm catalog:stats                 # Show database statistics
pnpm catalog:safety                # Check for placeholder songs (CI-ready)

# Legacy (still works)
pnpm catalog:validate              # Validate data/songs_seed.csv
pnpm catalog:clean                 # Clean contaminated catalog
```

---

## Best Practices

### 1. Always Dry Run First

```bash
pnpm catalog:mb:import -- --dry-run
pnpm catalog:embed -- --dry-run --limit=10
```

### 2. Monitor Progress

Fetcher and importer log progress every 100 songs. Watch for:
- Rejected placeholders (should be rare)
- API errors (should auto-retry)
- Deduplication rate (20-30% is normal)

### 3. Checkpoint Files

Fetcher creates `.checkpoint.json` — keep this file to resume interrupted fetches.

### 4. Run Safety Check Before Deploy

```bash
pnpm catalog:safety  # Must exit 0
```

### 5. Verify Embedding Coverage

```bash
pnpm catalog:stats
# Check: "Coverage: 100.0%" or close to it
```

---

## Cost & Time Summary

**50k Songs Pipeline:**

| Phase | Time | Cost |
|-------|------|------|
| Fetch | ~14 hours | $0 |
| Import | ~10 minutes | $0 |
| Embed | ~16 hours | ~$1 |
| **Total** | **~30 hours** | **~$1** |

**100k Songs:**
- Time: ~60 hours
- Cost: ~$2

**500k Songs:**
- Time: ~10-12 days
- Cost: ~$10

---

## Architecture Notes

### Why Genre-Based vs Artist-Based?

- **Artist-based** (old): Limited to ~2000 songs with 30 hand-picked artists
- **Genre-based** (new): Scalable to millions, no manual curation

### Why JSONL vs CSV?

- Handles complex fields (tags, nested data)
- One record per line (easy to stream)
- No escaping issues

### Why Not Store Lyrics?

- Legal compliance
- Embeddings are metadata-only
- Song matching is semantic (vibes, not lyrics)

---

## Future Enhancements

1. **Spotify Integration**
   - Add `spotify-fetcher.ts`
   - Fetch from Spotify Web API
   - Require `spotifyTrackId` for dedup

2. **Last.fm Tags**
   - Enrich tags from Last.fm API
   - Improve semantic matching

3. **Incremental Updates**
   - Daily cron job to fetch new releases
   - Keep catalog fresh

4. **Multi-Language Support**
   - Fetch recordings in multiple languages
   - Broader coverage

---

## Support

**Issues?**
- Check logs for detailed errors
- Verify environment variables (`DATABASE_URL`, `OPENAI_API_KEY`)
- Run dry-run mode to test changes
- Check Railway logs if deploying

**Questions?**
See existing documentation:
- [RUNBOOK.md](RUNBOOK.md)
- [DEPLOY_MIGRATIONS.md](apps/api/DEPLOY_MIGRATIONS.md)
- [scripts/ingestion/README.md](apps/api/scripts/ingestion/README.md)

---

**Last Updated:** 2026-02-05
**Version:** 1.0
**Status:** Production-Ready
