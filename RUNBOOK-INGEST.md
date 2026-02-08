## Catalog Expansion Runbook

**Goal:** Expand song catalog from ~193 to 2,000+ songs using MusicBrainz metadata with embeddings.

---

## Prerequisites

```bash
# Environment variables
export DATABASE_URL="postgresql://postgres:PASSWORD@host:port/railway?sslmode=disable"
export OPENAI_API_KEY="your-openai-api-key"

# Navigate to API directory
cd /home/hpz240/musicr/apps/api
```

---

## Step 1: Apply Database Migration

Add fields for ingestion tracking (ISRC, album, source, sourceUrl):

```bash
# Apply migration
pnpm prisma migrate deploy

# Verify schema
psql "$DATABASE_URL" -c "\d songs"
```

**Expected output:**
- `isrc` column: `character varying(12)`, unique index
- `album` column: `text`
- `source` column: `text`, default 'manual'
- `source_url` column: `text`

---

## Step 2: Test with Dry Run

Preview import without making changes:

```bash
./scripts/ingestion/ingest.sh dry-run
```

**Expected output:**
```
[DRY RUN] Would import song: "Shape of You" by Ed Sheeran
...
Imported: 50
Mode:     DRY RUN
```

---

## Step 3: Import Songs from MusicBrainz

Import 2,000 songs (takes ~30-40 minutes due to rate limiting):

```bash
# Import 2000 songs
./scripts/ingestion/ingest.sh import --target=2000

# Or import fewer for testing
./scripts/ingestion/ingest.sh import --target=500
```

**What happens:**
1. Queries MusicBrainz API for 30 popular artists
2. Fetches up to 100 recordings per artist
3. Deduplicates by ISRC (preferred) or MBID
4. Rate limits: 1 request/second (respectful to MusicBrainz)
5. Stores: title, artist, album, year, tags, ISRC, MBID, source URL

**Expected output:**
```
Processing artist: Taylor Swift
Fetched recordings: 87
Import progress: imported=450, skipped=123, errors=2, target=2000
...
IMPORT SUMMARY
Imported: 1847
Skipped:  153
Errors:   0
```

**Time estimate:**
- 2000 songs: ~35-45 minutes (due to 1 req/sec rate limit)
- 500 songs: ~10-15 minutes

---

## Step 4: Generate Embeddings

Generate OpenAI embeddings for all songs missing `embedding_vector`:

```bash
# Embed all missing (recommended)
./scripts/ingestion/ingest.sh embed

# Or limit to first N songs
./scripts/ingestion/ingest.sh embed --limit=500

# Custom batch size (default: 50)
./scripts/ingestion/ingest.sh embed --batch=100
```

**What happens:**
1. Finds all songs with `embedding_vector IS NULL`
2. Generates embedding text: `"{title} — {artist} | {album} | {tags}"`
3. Calls OpenAI API: `text-embedding-3-small` (1536 dimensions)
4. Stores in both `embedding_vector` (native) and `embedding` (JSONB)
5. Rate limits: ~50 requests/minute
6. Batched processing: 50 songs at a time

**Expected output:**
```
Found songs missing embeddings: 1847
Processing batch: 50 songs
Generated embedding: "Anti-Hero" by Taylor Swift
...
EMBEDDING BACKFILL SUMMARY
Total:     1847
Processed: 1847
Errors:    0
Cost:      $0.0369
```

**Cost estimate:**
- $0.00002 per embedding (OpenAI pricing for text-embedding-3-small)
- 2000 songs: ~$0.04
- 10,000 songs: ~$0.20

**Time estimate:**
- 2000 songs: ~40-50 minutes (rate limited to ~50/min)
- 500 songs: ~10-15 minutes

---

## Step 5: Run Full Pipeline (Import + Embed)

Run everything in one command:

```bash
./scripts/ingestion/ingest.sh full --target=2000
```

This executes:
1. Import from MusicBrainz (target: 2000)
2. Embed all missing vectors
3. Run verification queries

**Total time:** ~80-100 minutes for 2000 songs

---

## Step 6: Verification

Run comprehensive verification queries:

```bash
./scripts/ingestion/ingest.sh verify
```

**Expected outputs:**

### 1. Total Song Count
```
total_songs
-----------
      2040
```
Should be ~193 (original) + ~1847 (imported) = ~2040

### 2. Songs by Source
```
   source    | count | percent
-------------+-------+---------
 musicbrainz |  1847 |    90.4
 manual      |   193 |     9.6
```

### 3. Embedding Coverage
```
total | has_vector | missing_vector | coverage_percent
------+------------+----------------+------------------
 2040 |       2040 |              0 |            100.0
```
Should show 100% coverage after embedding step.

### 4. Duplicate Check
```
       title       |    artist    | duplicate_count
-------------------+--------------+-----------------
(0 rows)
```
Should show no duplicates (or very few) due to ISRC/MBID deduplication.

### 5. ISRC/MBID Coverage
```
total | has_isrc | has_mbid | isrc_percent | mbid_percent
------+----------+----------+--------------+--------------
 2040 |     1523 |     2040 |         74.7 |        100.0
```
- MBID: ~100% (MusicBrainz always provides recording ID)
- ISRC: ~60-80% (not all recordings have ISRCs)

### 6. Recently Imported (Last 10)
```
                  id                  |      title       |    artist     |       album        |   source    |     isrc     |        mbid
--------------------------------------+------------------+---------------+--------------------+-------------+--------------+--------------------------------------
 a1b2c3d4-...                         | Anti-Hero        | Taylor Swift  | Midnights          | musicbrainz | USUG12201234 | e8f9a0b1-...
 ...
```

### 7. Sample Similarity Query
```
       title        |      artist       |        album         | similarity
--------------------+-------------------+----------------------+------------
 Shake It Off       | Taylor Swift      | 1989                 |      0.847
 Love Story         | Taylor Swift      | Fearless             |      0.823
 You Belong With Me | Taylor Swift      | Fearless             |      0.816
 ...
```

---

## Troubleshooting

### Import Issues

**Problem:** `MusicBrainz API error: 503`
```
Solution: Rate limit hit. Script auto-retries after 5 seconds.
```

**Problem:** `Imported: 0, Skipped: 1500`
```
Reason: Songs already exist (ISRC/MBID match).
Solution: This is expected on re-runs. Use --target higher or clear duplicates.
```

**Problem:** `Failed to fetch recordings for artist`
```
Reason: Invalid artist MBID or network issue.
Solution: Check artist-seeds.json for valid MBIDs. Test connection:
  curl "https://musicbrainz.org/ws/2/recording?artist=b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d&limit=1&fmt=json"
```

### Embedding Issues

**Problem:** `OPENAI_API_KEY environment variable is required`
```
Solution: Set the environment variable:
  export OPENAI_API_KEY="your-openai-api-key"
```

**Problem:** `Failed to generate embedding: rate limit`
```
Solution: Script includes automatic rate limiting (1.2s between requests).
If persistent, reduce batch size:
  ./scripts/ingestion/ingest.sh embed --batch=25
```

**Problem:** `Error: different vector dimensions 1536 and X`
```
Reason: Mismatch between embedding dimensions.
Solution: Verify OpenAI model is text-embedding-3-small (1536 dims).
```

### Database Issues

**Problem:** `P2002: Unique constraint failed on field: isrc`
```
Reason: Duplicate ISRC detected.
Solution: This is expected behavior. Song will be skipped (counted as 'skipped').
```

**Problem:** `Connection timeout`
```
Solution: Check DATABASE_URL is correct and Railway DB is accessible:
  psql "$DATABASE_URL" -c "SELECT version();"
```

---

## Re-running the Pipeline

The pipeline is **safe to re-run**:

```bash
# Re-run import (will skip existing songs)
./scripts/ingestion/ingest.sh import --target=2000

# Re-run embeddings (will only process missing)
./scripts/ingestion/ingest.sh embed
```

**Deduplication logic:**
1. ISRC match → skip (existing song)
2. MBID match → skip (existing song)
3. No match → insert new song

**Embedding logic:**
- Only processes songs where `embedding_vector IS NULL`
- Safe to run multiple times

---

## Expanding Beyond 2,000 Songs

### Option 1: Increase Target

```bash
# Import 5,000 songs
./scripts/ingestion/ingest.sh full --target=5000

# Cost estimate: ~$0.10
# Time estimate: ~3-4 hours
```

### Option 2: Add More Artists

Edit `scripts/ingestion/artist-seeds.json`:

```json
{
  "artists": [
    {
      "name": "Kendrick Lamar",
      "mbid": "381086ea-f511-4aba-bdf9-71c753dc5077",
      "maxTracks": 100
    }
  ]
}
```

Then re-run import.

### Option 3: Use Different MusicBrainz Queries

Modify `musicbrainz-importer.ts` to query:
- By genre/tag
- By release date range
- By label
- By popularity metrics

---

## Maintenance

### Check for Songs Needing Embeddings

```sql
SELECT COUNT(*) FROM songs WHERE embedding_vector IS NULL;
```

### Regenerate Embeddings for Updated Metadata

```sql
-- Clear embeddings for songs updated in last day
UPDATE songs
SET embedding_vector = NULL,
    embedding = NULL
WHERE updated_at > NOW() - INTERVAL '1 day';

-- Then re-run
./scripts/ingestion/ingest.sh embed
```

### Monitor Embedding Costs

```sql
-- Count embeddings generated per day
SELECT
  DATE(created_at) as date,
  COUNT(*) as songs,
  ROUND(COUNT(*) * 0.00002, 4) as cost_usd
FROM songs
WHERE source = 'musicbrainz'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

---

## Summary Commands

```bash
# 1. Apply migration
pnpm prisma migrate deploy

# 2. Test dry run
./scripts/ingestion/ingest.sh dry-run

# 3. Import + embed 2000 songs
./scripts/ingestion/ingest.sh full --target=2000

# 4. Verify results
./scripts/ingestion/ingest.sh verify

# 5. Query in app
# Open web app, search: "happy upbeat song"
# Should return relevant results from expanded catalog
```

---

## Performance Notes

**HNSW Index Usage:**
- With 2000+ songs, PostgreSQL will start using the HNSW index
- Similarity queries should be <50ms (vs 100-500ms with seq scan)
- Verify with EXPLAIN ANALYZE:

```sql
EXPLAIN ANALYZE
SELECT title, artist,
  embedding_vector <=> '[0.1,0.2,...]'::vector(1536) as distance
FROM songs
WHERE embedding_vector IS NOT NULL
ORDER BY embedding_vector <=> '[0.1,0.2,...]'::vector(1536)
LIMIT 10;

-- Should show: "Index Scan using idx_songs_embedding_hnsw"
```

**At Different Scales:**
- 2,000 songs: HNSW starts being beneficial (~2-3x faster)
- 10,000 songs: HNSW is ~10x faster
- 100,000+ songs: HNSW is ~50-100x faster

---

## Next Steps

After successful ingestion:

1. **Test Semantic Search**: Try queries in the web app
2. **Monitor Performance**: Check query times in Railway logs
3. **Expand Further**: Import 5k, 10k, or more songs
4. **Add More Sources**: Consider Spotify API for audio features (requires OAuth)
5. **Improve Embeddings**: Experiment with metadata combinations for better semantic matching

---

## File Reference

**Scripts:**
- `apps/api/scripts/ingestion/ingest.sh` - Main CLI tool
- `apps/api/scripts/ingestion/musicbrainz-importer.ts` - MusicBrainz API client
- `apps/api/scripts/ingestion/embedding-backfill.ts` - OpenAI embedding generator
- `apps/api/scripts/ingestion/artist-seeds.json` - Artist seed list (30 popular artists)

**Migration:**
- `apps/api/prisma/migrations/20260203080653_add_ingestion_fields/migration.sql`

**Schema:**
- `apps/api/prisma/schema.prisma` - Updated with isrc, album, source, sourceUrl fields
