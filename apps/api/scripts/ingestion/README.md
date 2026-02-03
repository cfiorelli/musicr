# Song Catalog Ingestion Pipeline

Automated pipeline for expanding the song catalog from legal metadata sources (MusicBrainz) with OpenAI embeddings.

## Quick Start

```bash
# Set environment
export DATABASE_URL="postgresql://..."
export OPENAI_API_KEY="sk-proj-..."

# Import 2000 songs + generate embeddings
./ingest.sh full --target=2000

# Verify results
./ingest.sh verify
```

## Commands

```bash
./ingest.sh dry-run              # Test without changes
./ingest.sh import --target=2000 # Import songs only
./ingest.sh embed --limit=500    # Generate embeddings only
./ingest.sh full --target=2000   # Import + embed + verify
./ingest.sh verify               # Run verification queries
```

## Files

- **ingest.sh** - Main CLI wrapper
- **musicbrainz-importer.ts** - MusicBrainz API client
- **embedding-backfill.ts** - OpenAI embedding generator
- **artist-seeds.json** - Seed list of 30 popular artists

## Features

✅ **Deduplication:** ISRC (preferred) or MBID
✅ **Rate Limiting:** 1 req/sec for MusicBrainz, 50/min for OpenAI
✅ **Dry Run Mode:** Test before committing
✅ **Batched Processing:** 50 songs at a time for embeddings
✅ **Resumable:** Safe to re-run, skips existing songs
✅ **Cost Tracking:** Displays estimated OpenAI costs

## Documentation

See [RUNBOOK-INGEST.md](../../../../RUNBOOK-INGEST.md) for complete instructions.

## Cost & Time

**For 2,000 songs:**
- Import: ~35-45 minutes (MusicBrainz rate limit)
- Embeddings: ~40-50 minutes (OpenAI rate limit)
- Cost: ~$0.04 (OpenAI embeddings)
- Total: ~80-100 minutes

## Schema Changes

Migration: `20260203080653_add_ingestion_fields`

New fields:
- `isrc` - International Standard Recording Code (unique)
- `album` - Album name
- `source` - Data source (manual, musicbrainz, etc.)
- `source_url` - Link to source record

## Verification

After ingestion, verify:

1. **Count:** `SELECT COUNT(*) FROM songs;` → ~2040
2. **Coverage:** All songs have `embedding_vector`
3. **Duplicates:** None (or very few)
4. **Similarity:** Test query returns relevant results

## Troubleshooting

- **503 errors:** MusicBrainz rate limit, auto-retries
- **All skipped:** Songs already exist (expected on re-run)
- **Missing embeddings:** Run `./ingest.sh embed`
- **ISRC duplicates:** Expected, deduplication working correctly

## Expanding Beyond 2k

```bash
# Import 5k songs
./ingest.sh full --target=5000

# Add more artists to artist-seeds.json
```

## Support

Questions? See [RUNBOOK-INGEST.md](../../../../RUNBOOK-INGEST.md) or check logs for detailed errors.
