-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add native vector column for fast pgvector similarity search
-- Uses OpenAI text-embedding-3-small dimensions (1536)
ALTER TABLE songs ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

-- Backfill from existing JSONB embeddings
-- Converts JSONB array to native pgvector format
UPDATE songs
SET embedding_vector = (embedding::text)::vector
WHERE embedding IS NOT NULL
  AND embedding_vector IS NULL
  AND jsonb_typeof(embedding) = 'array'
  AND jsonb_array_length(embedding) = 1536;

-- Create HNSW index for fast approximate nearest neighbor search
-- m=16: number of bi-directional links per node (higher = more accurate but slower)
-- ef_construction=64: size of dynamic candidate list during construction (higher = better quality)
-- vector_cosine_ops: use cosine distance (1 - cosine similarity)
CREATE INDEX IF NOT EXISTS idx_songs_embedding_hnsw
ON songs
USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Add comment for documentation
COMMENT ON COLUMN songs.embedding_vector IS 'Native pgvector column (1536-dim OpenAI embeddings) for fast similarity search with HNSW index';
