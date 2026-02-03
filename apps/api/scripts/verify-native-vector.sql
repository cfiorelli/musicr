-- Verification script for native pgvector setup
-- Run: psql "$DATABASE_URL" < verify-native-vector.sql

\echo '=========================================='
\echo '  Native pgvector Verification Report'
\echo '=========================================='
\echo ''

\echo '=== 1. pgvector Extension ==='
SELECT
  extname as "Extension",
  extversion as "Version",
  CASE WHEN extname = 'vector' THEN '✓' ELSE '✗' END as "Status"
FROM pg_extension
WHERE extname = 'vector';

\echo ''
\echo '=== 2. Column Definitions ==='
SELECT
  column_name as "Column",
  data_type as "Type",
  udt_name as "UDT",
  CASE
    WHEN column_name = 'embedding' AND data_type = 'jsonb' THEN '✓'
    WHEN column_name = 'embedding_vector' AND udt_name = 'vector' THEN '✓'
    ELSE '✗'
  END as "Status"
FROM information_schema.columns
WHERE table_name = 'songs'
  AND column_name IN ('embedding', 'embedding_vector')
ORDER BY column_name;

\echo ''
\echo '=== 3. Row Counts ==='
SELECT
  COUNT(*) as "Total Songs",
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) as "Has JSONB Embedding",
  COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL) as "Has Native Vector",
  COUNT(*) FILTER (WHERE embedding IS NULL AND embedding_vector IS NULL) as "Missing Both"
FROM songs;

\echo ''
\echo '=== 4. HNSW Index ==='
SELECT
  indexname as "Index Name",
  substring(indexdef from 'USING ([a-z]+)') as "Index Type",
  CASE
    WHEN indexdef LIKE '%hnsw%' AND indexdef LIKE '%vector_cosine_ops%' THEN '✓ HNSW Cosine'
    ELSE '✗ Wrong Type'
  END as "Status"
FROM pg_indexes
WHERE tablename = 'songs'
  AND indexname = 'idx_songs_embedding_hnsw';

\echo ''
\echo '=== 5. Index Parameters ==='
SELECT
  i.relname as "Index Name",
  array_to_string(c.reloptions, ', ') as "Parameters"
FROM pg_class c
JOIN pg_index ix ON c.oid = ix.indexrelid
JOIN pg_class i ON i.oid = ix.indrelid
WHERE i.relname = 'songs'
  AND c.relname = 'idx_songs_embedding_hnsw';

\echo ''
\echo '=== 6. Sample Vector Norms ==='
\echo '(Verifying vectors are non-zero)'
SELECT
  id,
  title,
  artist,
  round((embedding_vector <=> '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'::vector(16))::numeric, 4) as distance_from_zero
FROM songs
WHERE embedding_vector IS NOT NULL
LIMIT 3;

\echo ''
\echo '=== 7. Query Plan Analysis ==='
\echo 'Testing if HNSW index is used in similarity search:'
\echo ''
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  id,
  title,
  artist,
  embedding_vector <=> '[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6]'::vector(16) as distance
FROM songs
WHERE embedding_vector IS NOT NULL
ORDER BY embedding_vector <=> '[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6]'::vector(16)
LIMIT 10;

\echo ''
\echo '=========================================='
\echo '  Verification Complete'
\echo '=========================================='
