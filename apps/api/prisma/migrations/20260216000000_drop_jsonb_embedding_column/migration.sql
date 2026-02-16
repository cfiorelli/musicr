-- Drop legacy JSONB embedding column
-- All embedding data is now stored in the native pgvector embedding_vector column
-- The JSONB column was already fully NULL (no data loss)
ALTER TABLE "songs" DROP COLUMN IF EXISTS "embedding";
