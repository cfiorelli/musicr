-- Update vector dimension from 1536 to 384 for Xenova/all-MiniLM-L6-v2 embeddings

-- Drop existing HNSW index
DROP INDEX IF EXISTS idx_songs_embedding_hnsw;

-- Drop old 1536-dimensional vector column
ALTER TABLE songs DROP COLUMN IF EXISTS embedding_vector;

-- Add new 384-dimensional vector column for Xenova/all-MiniLM-L6-v2 model
ALTER TABLE songs ADD COLUMN IF NOT EXISTS embedding_vector vector(384);

-- Backfill from existing JSONB embeddings (384 dimensions)
-- Converts JSONB array to native pgvector format
UPDATE songs
SET embedding_vector = (embedding::text)::vector
WHERE embedding IS NOT NULL
  AND embedding_vector IS NULL
  AND jsonb_typeof(embedding) = 'array'
  AND jsonb_array_length(embedding) = 384;

-- Create HNSW index for fast approximate nearest neighbor search
-- m=16: number of bi-directional links per node (higher = more accurate but slower)
-- ef_construction=64: size of dynamic candidate list during construction (higher = better quality)
-- vector_cosine_ops: use cosine distance (1 - cosine similarity)
CREATE INDEX IF NOT EXISTS idx_songs_embedding_hnsw
ON songs
USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Update comment for documentation
COMMENT ON COLUMN songs.embedding_vector IS 'Native pgvector column (384-dim Xenova/all-MiniLM-L6-v2 embeddings) for fast similarity search with HNSW index';
