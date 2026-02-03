-- Direct SQL script to create native vector column and HNSW index
-- Run this against Railway database: psql "$DATABASE_URL" < setup-native-vector.sql

\echo '=== Step 1: Ensure pgvector extension exists ==='
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

\echo ''
\echo '=== Step 2: Add native vector column ==='
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'songs' AND column_name = 'embedding_vector'
    ) THEN
        ALTER TABLE songs ADD COLUMN embedding_vector vector(1536);
        RAISE NOTICE 'Added embedding_vector column';
    ELSE
        RAISE NOTICE 'embedding_vector column already exists';
    END IF;
END $$;

\echo ''
\echo '=== Step 3: Backfill from JSONB to native vector ==='
UPDATE songs
SET embedding_vector = (embedding::text)::vector
WHERE embedding IS NOT NULL
  AND embedding_vector IS NULL
  AND jsonb_typeof(embedding) = 'array'
  AND jsonb_array_length(embedding) = 1536;

\echo ''
\echo '=== Step 4: Create HNSW index ==='
DROP INDEX IF EXISTS idx_songs_embedding_hnsw;
CREATE INDEX idx_songs_embedding_hnsw
ON songs
USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

\echo ''
\echo '=== Step 5: Add column comment ==='
COMMENT ON COLUMN songs.embedding_vector IS 'Native pgvector column (1536-dim OpenAI embeddings) for fast similarity search with HNSW index';

\echo ''
\echo '=== Verification ==='
\echo 'Columns:'
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'songs' AND column_name IN ('embedding', 'embedding_vector');

\echo ''
\echo 'Row counts:'
SELECT
  COUNT(*) as total_songs,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) as has_embedding_jsonb,
  COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL) as has_embedding_vector
FROM songs;

\echo ''
\echo 'HNSW index:'
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'songs' AND indexname = 'idx_songs_embedding_hnsw';

\echo ''
\echo '=== Setup complete! ==='
