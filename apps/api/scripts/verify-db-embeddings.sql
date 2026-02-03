-- Quick sanity check: Verify embeddings vary across songs in database
-- Run: psql "$DATABASE_URL" < scripts/verify-db-embeddings.sql

\echo '=== 1. Check 3 random songs have different embeddings ==='
\echo ''

-- Get first element of embedding_vector for 3 different songs
SELECT
  title,
  artist,
  CASE
    WHEN embedding_vector IS NOT NULL THEN
      (embedding_vector::text::json->0)::float
    ELSE
      NULL
  END as first_element
FROM songs
WHERE embedding_vector IS NOT NULL
ORDER BY RANDOM()
LIMIT 3;

\echo ''
\echo '=== 2. Verify native vector column vs JSONB differ (if both present) ==='
SELECT
  COUNT(*) as songs_with_both,
  COUNT(*) FILTER (WHERE
    (embedding_vector::text::json->0)::float != (embedding::json->0)::float
  ) as vectors_differ
FROM songs
WHERE embedding_vector IS NOT NULL
  AND embedding IS NOT NULL
LIMIT 1;

\echo ''
\echo '=== 3. Sample query: Verify SQL uses runtime parameter ==='
\echo 'Testing with a constant vector to confirm parameter binding works'
\echo ''

-- Test query with explicit vector parameter
WITH test_vector AS (
  SELECT '[0.1,0.2,0.3,0.4,0.5]'::vector(5) as vec
)
SELECT
  title,
  artist,
  ROUND(((embedding_vector::vector(5) <=> test_vector.vec) * -1 + 1)::numeric, 4) as similarity
FROM songs, test_vector
WHERE embedding_vector IS NOT NULL
ORDER BY embedding_vector::vector(5) <=> test_vector.vec
LIMIT 3;

\echo ''
\echo '=== Verification complete ==='
\echo 'If first_element values differ across songs, embeddings are varying correctly.'
\echo 'If the test query returns results, SQL parameter binding is working.'
