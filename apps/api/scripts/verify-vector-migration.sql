-- Verification script for native vector migration

\echo '=== 1. Check pgvector extension ==='
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';

\echo ''
\echo '=== 2. Check embedding_vector column exists ==='
SELECT
  column_name,
  data_type,
  udt_name
FROM information_schema.columns
WHERE table_name = 'songs'
  AND column_name = 'embedding_vector';

\echo ''
\echo '=== 3. Check HNSW index exists ==='
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'songs'
  AND indexname = 'idx_songs_embedding_hnsw';

\echo ''
\echo '=== 4. Count songs with vector embeddings ==='
SELECT
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) as jsonb_embeddings,
  COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL) as vector_embeddings,
  COUNT(*) as total_songs
FROM songs;

\echo ''
\echo '=== 5. Test EXPLAIN ANALYZE for vector search ==='
\echo 'This should show "Index Scan using idx_songs_embedding_hnsw"'
EXPLAIN ANALYZE
SELECT
  id,
  title,
  artist,
  embedding_vector <=> '[0.1, 0.2, 0.3, ...]'::vector(1536) as distance
FROM songs
WHERE embedding_vector IS NOT NULL
ORDER BY embedding_vector <=> '[0.1, 0.2, 0.3, ...]'::vector(1536)
LIMIT 10;

\echo ''
\echo '=== Verification complete ==='
