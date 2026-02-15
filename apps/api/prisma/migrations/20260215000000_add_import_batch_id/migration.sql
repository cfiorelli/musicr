-- Add import_batch_id for rollback support
ALTER TABLE "songs" ADD COLUMN IF NOT EXISTS "import_batch_id" UUID;
CREATE INDEX IF NOT EXISTS "idx_songs_import_batch_id" ON "songs" ("import_batch_id");
