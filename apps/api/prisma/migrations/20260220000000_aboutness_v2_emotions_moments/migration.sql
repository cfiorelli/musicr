-- Migration: Aboutness V2 — emotions + moments columns
-- Extends song_aboutness with split emotions/moments fields for 3-signal retrieval.
-- Legacy columns (aboutness_text, aboutness_json, aboutness_vector, embedding_model)
-- are kept for compatibility but will no longer be written after V2 backfill.

ALTER TABLE "song_aboutness"
  ADD COLUMN IF NOT EXISTS "emotions_text"       text,
  ADD COLUMN IF NOT EXISTS "emotions_vector"     vector(384),
  ADD COLUMN IF NOT EXISTS "emotions_confidence" text,
  ADD COLUMN IF NOT EXISTS "moments_text"        text,
  ADD COLUMN IF NOT EXISTS "moments_vector"      vector(384),
  ADD COLUMN IF NOT EXISTS "moments_confidence"  text,
  ADD COLUMN IF NOT EXISTS "provider"            text,
  ADD COLUMN IF NOT EXISTS "generation_model"    text;

-- HNSW index on emotions_vector (cosine) — used in KNN retrieval
-- moments_vector intentionally left unindexed (rerank on candidate set only)
CREATE INDEX IF NOT EXISTS "idx_song_aboutness_emotions_hnsw"
  ON "song_aboutness"
  USING hnsw ("emotions_vector" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
