# KEXP Ingestion Pipeline — Spec

_Created: 2026-02-23_

## 1. Goal

Ingest KEXP public play history (track plays) into the Musicr song catalog, with
idempotency, provenance tracking, and a resumable checkpoint mechanism. Produces
new song candidates for downstream embedding and aboutness enrichment.

## 2. Non-Goals

- No real-time/live streaming of KEXP plays (batch-only for now)
- No audio/artwork storage
- No automatic aboutness or embedding generation on ingest (scripts must be run separately; candidates are logged)
- No modification of existing good song data (insert-only on matched songs, no overwrite)
- No UI changes

## 3. Flow

```
scripts/ingestion/kexp-ingest.ts
  --dry-run        Fetch pages, log what would happen, no DB writes
  --limit=N        Stop after N track plays processed (validation mode)
  --incremental    Fetch from most recent stored airdate forward
  --page-limit=N   Stop after N API pages (backfill cap)
  --start-date     Fetch plays from this date (ISO)
  --end-date       Fetch plays until this date (ISO)

For each API page:
  GET https://api.kexp.org/v2/plays/?limit=200&ordering=-airdate[&before=<cursor>]
  → filter play_type === 'trackplay'
  → skip rows with empty artist or song fields
  → for each valid track play:
      1. Check ExternalPlay uniqueness (source='kexp', source_play_id=play.id)
         → skip if exists (idempotent)
      2. Attempt song match:
         a. By MBID (recording_id) → exact Song.mbid match
         b. By normalized title+artist → Song WHERE lower(title)=norm AND lower(artist)=norm
      3. If new song needed:
         → INSERT minimal song row (title, artist, album, year, source='kexp')
         → do NOT overwrite existing mbid/isrc/source on conflict
      4. INSERT ExternalPlay row (source, source_play_id, title, artist, album,
         airdate, mbid, year, song_id)
  → save checkpoint after each page (last airdate processed)

Final summary log:
  fetched | track plays | provenance inserted | songs matched existing |
  new songs inserted | skipped (no artist/title) | duplicates skipped | errors
```

## 4. Data + API Changes

### New Prisma model: ExternalPlay

```
source          String  -- "kexp"
sourcePlayId    String  -- KEXP play id (as string)
title           String
artist          String
album           String?
airdate         DateTime?
mbid            String?          -- recording_id from KEXP
year            Int?
songId          String?          -- FK → Song (nullable; null if no match)
createdAt       DateTime @default(now())

UNIQUE: (source, sourcePlayId)
INDEX: source, songId
```

### New Prisma model: IngestionCheckpoint

```
source      String @id     -- "kexp"
cursor      String?         -- last airdate or pagination marker
metadata    Json?           -- optional extra state (page count, last run, etc.)
updatedAt   DateTime @updatedAt
```

### Song insert behavior

- INSERT with `ON CONFLICT DO NOTHING` on title+artist (case-normalized lookup first)
- Never overwrite `mbid`, `isrc`, `source`, `album`, `year` on an existing row with
  non-null values
- New songs get `source = 'kexp'`, `isPlaceholder = false`
- Songs inserted without embeddings need a follow-up embedding backfill run (logged)

### API used

| Field | KEXP API field | Notes |
|-------|----------------|-------|
| `source_play_id` | `id` | KEXP's unique play ID |
| `title` | `song` | Track title |
| `artist` | `artist` | Artist name(s) |
| `album` | `album` | Album/release name |
| `airdate` | `airdate` | ISO datetime |
| `mbid` | `recording_id` | MusicBrainz recording ID (may be null) |
| `year` | `release_date` | Year integer (may be null or string "YYYY") |
| filter | `play_type === 'trackplay'` | Skip airbreaks |

## 5. Failure Modes

| Failure | Handling |
|---------|----------|
| API rate limit / 429 | Exponential backoff (1s, 2s, 4s) up to 3 retries |
| Network error on page fetch | Retry up to 3 times then abort with error log |
| DB write error on ExternalPlay | Log + skip, continue |
| DB write error on Song insert | Log + skip, continue |
| Empty API response | Treat as end of data, save checkpoint |
| Missing artist or song field | Skip play (counted as skipped_invalid) |
| Duplicate source_play_id | Unique constraint → skip (idempotent) |
| Script interrupted mid-run | Resume from checkpoint cursor on next run |

## 6. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | `--dry-run` fetches and logs without any DB writes |
| 2 | `--limit=100` stops after 100 track plays processed |
| 3 | Re-running with same date range does not create duplicate ExternalPlay rows |
| 4 | KEXP plays with empty `song` or `artist` are counted as skipped, not errored |
| 5 | Songs matched via MBID are linked correctly in `external_plays.song_id` |
| 6 | Songs matched via normalized title+artist are linked correctly |
| 7 | New songs inserted from KEXP do not overwrite existing song fields with null |
| 8 | Checkpoint cursor is saved after each API page |
| 9 | `--incremental` resumes from last stored checkpoint cursor |
| 10 | Final summary log includes all 8 counters (fetched, track plays, provenance inserted, matched, new songs, skipped, duplicates, errors) |
| 11 | New song candidates without embeddings are logged for follow-up backfill |
| 12 | Script handles KEXP API pagination via `next` URL field |

## 7. Runbook

### Dry-run (safe validation):
```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --dry-run --limit=100
```

### Small write run (validation batch):
```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --limit=500
```

### Incremental sync (latest plays only):
```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --incremental
```

### Backfill (page-limited, safe cap):
```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --page-limit=50
```

### Post-ingest embedding backfill (for new songs without embeddings):
```bash
pnpm tsx scripts/ingestion/embedding-backfill.ts --limit=5000
```
