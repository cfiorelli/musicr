-- Add is_placeholder column to songs table
ALTER TABLE "songs" ADD COLUMN "is_placeholder" BOOLEAN NOT NULL DEFAULT false;

-- Create index for filtering placeholders
CREATE INDEX "idx_songs_is_placeholder" ON "songs"("is_placeholder");

-- Backfill: Mark existing placeholder songs
-- Rule 1: Exact matches
UPDATE "songs"
SET "is_placeholder" = true
WHERE title IN (
  'Found Song', 'Found Track',
  'True Song', 'True Track',
  'Lost Song', 'Lost Track'
);

-- Rule 2: Adjective + Type pattern (e.g., "Blue Song", "Red Track 2")
UPDATE "songs"
SET "is_placeholder" = true
WHERE title ~* '^(Blue|Red|Golden|Silver|Dark|Bright|Sweet|Wild|Free|Lost|Found|True|Faded|Shining|Burning|Rising)\s+(Song|Track|Anthem|Hit|Tune|Number|Single|Piece|Jam|Record|Ballad|Beat)(\s+\d+)?$';

-- Rule 3: Simple two-token patterns (e.g., "Crazy Song", "Happy Track")
UPDATE "songs"
SET "is_placeholder" = true
WHERE title ~* '^\w+\s+(Song|Track)$'
AND title NOT IN (
  -- Exclude known real songs that might match this pattern
  'Video Killed the Radio Star',
  'Don''t Stop Believin''',
  'Stairway to Heaven'
);

-- Rule 4: Numbered suffix patterns (e.g., "Something 2", "Thing 10")
UPDATE "songs"
SET "is_placeholder" = true
WHERE title ~* '^[A-Za-z]+\s+(Song|Track|Anthem|Hit|Tune|Number|Single|Piece|Jam|Record|Ballad|Beat)\s+\d+$';

-- Verify the update
DO $$
DECLARE
  placeholder_count INT;
  real_count INT;
BEGIN
  SELECT COUNT(*) INTO placeholder_count FROM "songs" WHERE "is_placeholder" = true;
  SELECT COUNT(*) INTO real_count FROM "songs" WHERE "is_placeholder" = false;

  RAISE NOTICE 'Migration complete: % placeholder songs marked, % real songs kept', placeholder_count, real_count;
END $$;
