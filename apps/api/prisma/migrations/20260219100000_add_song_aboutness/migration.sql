-- CreateTable song_aboutness
-- Stores structured "aboutness" profiles for songs:
-- experiential metadata (mood, themes, energy, sensory feel) + embedding.
--
-- IMPORTANT: The HNSW index is created separately (raw SQL) because Prisma
-- cannot express vector index options (m, ef_construction, opclass) in schema.

CREATE TABLE "song_aboutness" (
    "song_id"           UUID NOT NULL,
    "aboutness_text"    TEXT NOT NULL,
    "aboutness_json"    JSONB NOT NULL,
    "aboutness_vector"  vector(384),
    "aboutness_version" INTEGER NOT NULL,
    "embedding_model"   TEXT NOT NULL,
    "generated_at"      TIMESTAMPTZ NOT NULL,

    CONSTRAINT "song_aboutness_pkey" PRIMARY KEY ("song_id"),
    CONSTRAINT "song_aboutness_song_id_fkey"
        FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE
);

-- B-tree index on version (used by backfill WHERE clause)
CREATE INDEX "idx_song_aboutness_version"
    ON "song_aboutness" ("aboutness_version");

-- HNSW vector index for fast cosine KNN
-- Matches existing idx_songs_embedding_hnsw parameters (m=16, ef_construction=64)
CREATE INDEX "idx_song_aboutness_hnsw"
    ON "song_aboutness"
    USING hnsw ("aboutness_vector" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
