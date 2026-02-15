#!/bin/bash
# Ingestion Pipeline CLI
# Imports metadata from MusicBrainz and generates embeddings

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

function print_usage() {
  echo "Usage: $0 [command] [options]"
  echo ""
  echo "Commands:"
  echo "  dry-run             Run import in dry-run mode (no database changes)"
  echo "  import [--target=N] Import songs from MusicBrainz artist seeds (default: 2000)"
  echo "  fetch [--target=N]  Fetch songs by genre to JSONL (default: 100000)"
  echo "  bulk-import --in=F  Import from JSONL with diversity caps + rollback"
  echo "  embed [--limit=N]   Generate embeddings for missing songs"
  echo "  expand [--target=N] Full pipeline: fetch + bulk-import + embed + verify"
  echo "  full [--target=N]   Legacy: artist-seed import + embed pipeline"
  echo "  verify              Run verification queries"
  echo ""
  echo "Options:"
  echo "  --target=N          Target number of songs to fetch/import"
  echo "  --limit=N           Limit embeddings to process"
  echo "  --batch=N           Batch size for embeddings (default: 50)"
  echo "  --in=FILE           Input JSONL file for bulk-import"
  echo ""
  echo "Examples:"
  echo "  $0 fetch --target=100000              # Fetch 100k songs to JSONL"
  echo "  $0 bulk-import --in=./data/mb.jsonl   # Import JSONL with diversity caps"
  echo "  $0 expand --target=100000             # Full pipeline: fetch+import+embed"
  echo "  $0 embed                              # Embed all missing vectors"
  echo "  $0 verify                             # Run verification queries"
}

function check_env() {
  if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not set${NC}"
    exit 1
  fi

  if [ "$1" != "verify" ] && [ "$1" != "dry-run" ] && [ "$1" != "fetch" ] && [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}Warning: OPENAI_API_KEY not set (required for embeddings)${NC}"
  fi
}

function run_dry_run() {
  echo -e "${GREEN}=== DRY RUN ===${NC}"
  cd "$API_DIR"
  pnpm tsx scripts/ingestion/musicbrainz-importer.ts --dry-run --target=50
}

function run_import() {
  local target="${1:-2000}"
  echo -e "${GREEN}=== IMPORTING SONGS (target: $target) ===${NC}"
  cd "$API_DIR"
  pnpm tsx scripts/ingestion/musicbrainz-importer.ts --target="$target"
}

function run_fetch() {
  local target="${1:-100000}"
  local outfile="${2:-$API_DIR/data/musicbrainz/musicbrainz_100k.jsonl}"
  echo -e "${GREEN}=== FETCHING SONGS BY GENRE (target: $target) ===${NC}"
  echo -e "Output: $outfile"
  cd "$API_DIR"
  pnpm tsx scripts/ingestion/musicbrainz-genre-fetcher.ts --target="$target" --out="$outfile"
}

function run_bulk_import() {
  local infile="$1"
  local dryrun_flag="${2:-}"
  echo -e "${GREEN}=== BULK IMPORT (diversity caps active) ===${NC}"
  echo -e "Input: $infile"
  cd "$API_DIR"
  pnpm tsx scripts/ingestion/musicbrainz-bulk-importer.ts --in="$infile" $dryrun_flag
}

function run_embed() {
  local limit="$1"
  local batch="${2:-50}"

  if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}Error: OPENAI_API_KEY required for embedding generation${NC}"
    exit 1
  fi

  echo -e "${GREEN}=== GENERATING EMBEDDINGS ===${NC}"
  cd "$API_DIR"

  if [ -n "$limit" ]; then
    pnpm tsx scripts/ingestion/embedding-backfill.ts --limit="$limit" --batch="$batch"
  else
    pnpm tsx scripts/ingestion/embedding-backfill.ts --batch="$batch"
  fi
}

function run_verify() {
  echo -e "${GREEN}=== VERIFICATION QUERIES ===${NC}"

  psql "$DATABASE_URL" << 'EOF'
\echo '=== 1. Total Song Count ==='
SELECT COUNT(*) as total_songs,
       COUNT(*) FILTER (WHERE is_placeholder = false) as non_placeholder
FROM songs;

\echo ''
\echo '=== 2. Songs by Source ==='
SELECT
  source,
  COUNT(*) as count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) as percent
FROM songs
GROUP BY source
ORDER BY count DESC;

\echo ''
\echo '=== 3. Embedding Coverage ==='
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL) as has_vector,
  COUNT(*) FILTER (WHERE embedding_vector IS NULL) as missing_vector,
  ROUND(100.0 * COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL) / COUNT(*), 1) as coverage_percent
FROM songs;

\echo ''
\echo '=== 4. Top 20 Artists by Count ==='
SELECT artist, COUNT(*) as cnt
FROM songs GROUP BY artist ORDER BY cnt DESC LIMIT 20;

\echo ''
\echo '=== 5. Top 20 (Artist, Album) by Count ==='
SELECT artist, album, COUNT(*) as cnt
FROM songs WHERE album IS NOT NULL
GROUP BY artist, album ORDER BY cnt DESC LIMIT 20;

\echo ''
\echo '=== 6. Year Decade Distribution ==='
SELECT
  CASE
    WHEN year IS NULL THEN 'Unknown'
    ELSE (FLOOR(year / 10) * 10)::text || 's'
  END as decade,
  COUNT(*) as cnt
FROM songs
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== 7. Tag Distribution (Top 30) ==='
SELECT tag, COUNT(*) as cnt
FROM songs, UNNEST(tags) AS tag
GROUP BY tag ORDER BY cnt DESC LIMIT 30;

\echo ''
\echo '=== 8. Duplicate Check (Title + Artist) ==='
SELECT title, artist, COUNT(*) as duplicate_count
FROM songs GROUP BY title, artist
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC LIMIT 10;

\echo ''
\echo '=== 9. ISRC/MBID Coverage ==='
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE isrc IS NOT NULL) as has_isrc,
  COUNT(*) FILTER (WHERE mbid IS NOT NULL) as has_mbid,
  ROUND(100.0 * COUNT(*) FILTER (WHERE isrc IS NOT NULL) / COUNT(*), 1) as isrc_percent,
  ROUND(100.0 * COUNT(*) FILTER (WHERE mbid IS NOT NULL) / COUNT(*), 1) as mbid_percent
FROM songs;

\echo ''
\echo '=== 10. DB Size ==='
SELECT pg_size_pretty(pg_database_size(current_database())) as db_size,
       pg_database_size(current_database()) as db_bytes,
       pg_size_pretty(pg_total_relation_size('songs')) as songs_table_size;

\echo ''
\echo '=== 11. Import Batches ==='
SELECT import_batch_id, COUNT(*) as cnt, MIN("createdAt") as first_at, MAX("createdAt") as last_at
FROM songs WHERE import_batch_id IS NOT NULL
GROUP BY import_batch_id ORDER BY first_at DESC LIMIT 10;

\echo ''
\echo '=== Verification Complete ==='
EOF
}

# Parse command
COMMAND="${1:-}"
shift || true

# Check environment
check_env "$COMMAND"

# Execute command
case "$COMMAND" in
  dry-run)
    run_dry_run
    ;;

  import)
    TARGET="2000"
    for arg in "$@"; do
      case $arg in
        --target=*)
          TARGET="${arg#*=}"
          ;;
      esac
    done
    run_import "$TARGET"
    ;;

  fetch)
    TARGET="100000"
    OUTFILE=""
    for arg in "$@"; do
      case $arg in
        --target=*)
          TARGET="${arg#*=}"
          ;;
        --out=*)
          OUTFILE="${arg#*=}"
          ;;
      esac
    done
    run_fetch "$TARGET" "$OUTFILE"
    ;;

  bulk-import)
    INFILE=""
    DRYRUN=""
    for arg in "$@"; do
      case $arg in
        --in=*)
          INFILE="${arg#*=}"
          ;;
        --dry-run)
          DRYRUN="--dry-run"
          ;;
      esac
    done
    if [ -z "$INFILE" ]; then
      echo -e "${RED}Error: --in=FILE required for bulk-import${NC}"
      exit 1
    fi
    run_bulk_import "$INFILE" "$DRYRUN"
    ;;

  embed)
    LIMIT=""
    BATCH="50"
    for arg in "$@"; do
      case $arg in
        --limit=*)
          LIMIT="${arg#*=}"
          ;;
        --batch=*)
          BATCH="${arg#*=}"
          ;;
      esac
    done
    run_embed "$LIMIT" "$BATCH"
    ;;

  expand)
    TARGET="100000"
    for arg in "$@"; do
      case $arg in
        --target=*)
          TARGET="${arg#*=}"
          ;;
      esac
    done

    OUTFILE="$API_DIR/data/musicbrainz/musicbrainz_${TARGET}.jsonl"

    echo -e "${GREEN}=== EXPAND PIPELINE (Fetch + Bulk Import + Embed + Verify) ===${NC}"
    echo -e "Target: $TARGET songs from MusicBrainz"
    echo -e "Output: $OUTFILE"
    echo ""

    run_fetch "$TARGET" "$OUTFILE"
    echo ""
    run_bulk_import "$OUTFILE"
    echo ""
    run_embed
    echo ""
    run_verify
    ;;

  full)
    TARGET="2000"
    for arg in "$@"; do
      case $arg in
        --target=*)
          TARGET="${arg#*=}"
          ;;
      esac
    done

    echo -e "${GREEN}=== FULL PIPELINE (Import + Embed) ===${NC}"
    run_import "$TARGET"
    echo ""
    run_embed
    echo ""
    run_verify
    ;;

  verify)
    run_verify
    ;;

  *)
    print_usage
    exit 1
    ;;
esac

echo -e "${GREEN}✓ Done${NC}"
