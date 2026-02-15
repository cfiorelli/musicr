-- Add canonical artist fields for diversity tracking
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "primary_artist" TEXT;
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "primary_artist_mbid" TEXT;
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "artist_credit" TEXT;

-- Index for diversity queries by canonical artist MBID
CREATE INDEX IF NOT EXISTS "idx_songs_primary_artist_mbid" ON "songs" ("primary_artist_mbid");
