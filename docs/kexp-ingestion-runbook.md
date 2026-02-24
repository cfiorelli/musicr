# KEXP Ingestion Runbook

_Last updated: 2026-02-24_

## Script location

```
apps/api/scripts/ingestion/kexp-ingest.ts
```

Run from `apps/api/`:

```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts [flags]
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Fetch pages, log what would happen, **no DB writes** |
| `--limit=N` | Stop after N track plays processed |
| `--page-limit=N` | Stop after N API pages fetched |
| `--incremental` | Resume from last checkpoint cursor (most recent stored airdate) |
| `--start-date=ISO` | Fetch plays from this date onward (e.g. `2025-01-01`) |
| `--end-date=ISO` | Fetch plays up to this date |

---

## Common operations

### 1. Validate (safe — no writes)

```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --dry-run --limit=100
```

### 2. Small validation write (first time / after outage)

```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --limit=200
```

### 3. Incremental sync (new plays since last run)

```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --incremental
```

Checkpoint: the most recent airdate seen is stored in `ingestion_checkpoints`
(source='kexp'). `--incremental` stops fetching when it reaches plays older
than the cursor.

### 4. Page-limited backfill (safe cap)

```bash
pnpm tsx scripts/ingestion/kexp-ingest.ts --page-limit=100
```

Each page = 200 API results ≈ ~50–100 track plays depending on airbreak ratio.
`--page-limit=100` = ~5,000–10,000 track plays maximum.

### 5. Post-ingest embedding backfill (for new songs)

New songs from KEXP are inserted with `embedding_version=0` (no embedding).
After any ingest run that inserts new songs, queue the embedding backfill:

```bash
pnpm tsx scripts/ingestion/embedding-backfill.ts --limit=5000
```

---

## Checkpoint behavior

The checkpoint cursor is the ISO timestamp of the most recent airdate processed.
It is saved to `ingestion_checkpoints` after **every page**, so interruptions
are safe — re-running `--incremental` will continue from where it left off.

To inspect:
```sql
SELECT * FROM ingestion_checkpoints WHERE source = 'kexp';
```

To reset (start from scratch):
```sql
DELETE FROM ingestion_checkpoints WHERE source = 'kexp';
```

---

## Summary log fields

```
Pages fetched:            — API pages fetched this run
Total plays seen:         — All plays (track + airbreak) on fetched pages
Track plays:              — play_type='trackplay' only
Provenance rows inserted: — New rows in external_plays
Songs matched existing:   — KEXP plays linked to existing catalog songs
New songs inserted:       — Net new songs added to songs table
Skipped (no title/artist):— Plays skipped due to missing required fields
Duplicates skipped:       — Already in external_plays (idempotent)
Errors:                   — DB errors (play skipped and counted)
```

---

## DB tables used

| Table | Purpose |
|-------|---------|
| `external_plays` | Provenance: one row per KEXP play ingested |
| `ingestion_checkpoints` | Resumable cursor (source='kexp') |
| `songs` | New songs from KEXP inserted here |

---

## Operational cautions

- KEXP API is public and unauthenticated. Polite delay (250ms) between pages.
- Default ordering is `-airdate` (newest first). Incremental sync relies on this.
- Retries on 429 (1s / 2s / 4s backoff) and transient network errors (3 tries).
- Always run `--dry-run` before a large new backfill in production.
- `--page-limit=50` is a safe upper bound for a manual run (~2,500–5,000 plays).
