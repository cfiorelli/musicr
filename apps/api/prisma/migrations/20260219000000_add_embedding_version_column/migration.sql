-- AddColumn: embedding_version on songs
-- Tracks which embedding model was used for each song's vector.
-- Version 1 = Xenova/all-MiniLM-L6-v2 (384-dim, cosine)
-- Bump this value whenever a new model replaces the previous one.

ALTER TABLE "songs"
  ADD COLUMN IF NOT EXISTS "embedding_version" INTEGER NOT NULL DEFAULT 1;

-- Index to allow filtering/counting songs by embedding version
-- (useful for backfill queries: WHERE embedding_version < N)
CREATE INDEX IF NOT EXISTS "idx_songs_embedding_version"
  ON "songs" ("embedding_version");
