-- Add fields for ingestion pipeline and metadata tracking

-- Add ISRC (International Standard Recording Code) for deduplication
ALTER TABLE songs ADD COLUMN IF NOT EXISTS isrc VARCHAR(12);

-- Add album name for richer metadata and embeddings
ALTER TABLE songs ADD COLUMN IF NOT EXISTS album TEXT;

-- Add source tracking fields
ALTER TABLE songs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Create unique index on ISRC (when present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_isrc ON songs(isrc) WHERE isrc IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN songs.isrc IS 'International Standard Recording Code (12 chars) - unique identifier for recordings';
COMMENT ON COLUMN songs.album IS 'Album name for display and embedding generation';
COMMENT ON COLUMN songs.source IS 'Data source: manual, musicbrainz, spotify, etc.';
COMMENT ON COLUMN songs.source_url IS 'URL to the source record (e.g., MusicBrainz release page)';

-- Update existing manual entries to have source='manual'
UPDATE songs SET source = 'manual' WHERE source IS NULL;
