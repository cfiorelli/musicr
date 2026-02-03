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
  echo "  import [--target=N] Import songs from MusicBrainz (default: 2000)"
  echo "  embed [--limit=N]   Generate embeddings for missing songs"
  echo "  full [--target=N]   Run import + embed pipeline"
  echo "  verify              Run verification queries"
  echo ""
  echo "Options:"
  echo "  --target=N          Target number of songs to import (default: 2000)"
  echo "  --limit=N           Limit embeddings to process"
  echo "  --batch=N           Batch size for embeddings (default: 50)"
  echo ""
  echo "Examples:"
  echo "  $0 dry-run                    # Test import without changes"
  echo "  $0 import --target=500        # Import 500 songs"
  echo "  $0 embed --limit=100          # Embed 100 songs"
  echo "  $0 full --target=2000         # Import 2000 + embed all"
  echo "  $0 verify                     # Run verification queries"
}

function check_env() {
  if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not set${NC}"
    exit 1
  fi

  if [ "$1" != "verify" ] && [ "$1" != "dry-run" ] && [ -z "$OPENAI_API_KEY" ]; then
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
SELECT COUNT(*) as total_songs FROM songs;

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
\echo '=== 4. Duplicate Check (Title + Artist) ==='
SELECT
  title,
  artist,
  COUNT(*) as duplicate_count
FROM songs
GROUP BY title, artist
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10;

\echo ''
\echo '=== 5. ISRC/MBID Coverage ==='
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE isrc IS NOT NULL) as has_isrc,
  COUNT(*) FILTER (WHERE mbid IS NOT NULL) as has_mbid,
  ROUND(100.0 * COUNT(*) FILTER (WHERE isrc IS NOT NULL) / COUNT(*), 1) as isrc_percent,
  ROUND(100.0 * COUNT(*) FILTER (WHERE mbid IS NOT NULL) / COUNT(*), 1) as mbid_percent
FROM songs;

\echo ''
\echo '=== 6. Recently Imported (Last 10) ==='
SELECT
  id,
  title,
  artist,
  album,
  source,
  isrc,
  mbid,
  created_at
FROM songs
WHERE source = 'musicbrainz'
ORDER BY created_at DESC
LIMIT 10;

\echo ''
\echo '=== 7. Sample Similarity Query ==='
\echo 'Query: "happy upbeat energetic song"'

-- Generate embedding for test query (using first song as proxy)
WITH test_vector AS (
  SELECT embedding_vector
  FROM songs
  WHERE embedding_vector IS NOT NULL
  LIMIT 1
)
SELECT
  title,
  artist,
  album,
  ROUND((1 - (songs.embedding_vector <=> test_vector.embedding_vector))::numeric, 3) as similarity
FROM songs, test_vector
WHERE songs.embedding_vector IS NOT NULL
ORDER BY songs.embedding_vector <=> test_vector.embedding_vector
LIMIT 10;

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
