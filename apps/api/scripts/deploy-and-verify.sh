#!/bin/bash
# Deploy native pgvector column and HNSW index to Railway, then verify
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: DATABASE_URL not set"
  echo "Usage: DATABASE_URL='postgresql://...' ./scripts/deploy-and-verify.sh"
  exit 1
fi

echo "=========================================="
echo "  Deploy Native pgvector + HNSW"
echo "=========================================="
echo ""

# Step 1: Apply migration via Prisma
echo "📦 Step 1: Applying Prisma migration..."
pnpm prisma migrate deploy
echo "✓ Migration applied"
echo ""

# Step 2: Verify deployment
echo "🔍 Step 2: Running verification..."
echo ""
psql "$DATABASE_URL" << 'VERIFICATION'
\echo '=== a) Row Counts ==='
SELECT
  COUNT(*) as total_songs,
  COUNT(*) FILTER (WHERE embedding IS NULL) as embedding_null_count,
  COUNT(*) FILTER (WHERE embedding_vector IS NULL) as embedding_vector_null_count
FROM songs;

\echo ''
\echo '=== b) HNSW Index Definition ==='
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'songs' AND indexname = 'idx_songs_embedding_hnsw';

\echo ''
\echo '=== c) EXPLAIN ANALYZE - Verify Index Usage ==='
\echo 'Look for: "Index Scan using idx_songs_embedding_hnsw"'
\echo ''
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)
SELECT
  id,
  title,
  artist,
  embedding_vector <=> '[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]'::vector(10) as distance
FROM songs
WHERE embedding_vector IS NOT NULL
ORDER BY embedding_vector <=> '[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]'::vector(10)
LIMIT 10;
VERIFICATION

echo ""
echo "=========================================="
echo "  ✅ Deployment Complete"
echo "=========================================="
echo ""
echo "Modified files:"
echo "  - prisma/migrations/20260203065710_native_pgvector_column/"
echo "  - apps/api/src/engine/matchers/semantic.ts (already updated)"
echo ""
echo "To test performance:"
echo "  OPENAI_API_KEY='sk-...' pnpm tsx scripts/test-vector-performance.ts"
