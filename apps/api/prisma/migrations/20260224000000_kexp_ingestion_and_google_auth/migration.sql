-- CreateTable: external_plays (KEXP play provenance)
CREATE TABLE "external_plays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "source_play_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "album" TEXT,
    "airdate" TIMESTAMPTZ,
    "mbid" TEXT,
    "year" INTEGER,
    "song_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_plays_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ingestion_checkpoints (resumable cursor per source)
CREATE TABLE "ingestion_checkpoints" (
    "source" TEXT NOT NULL,
    "cursor" TEXT,
    "metadata" JSONB,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ingestion_checkpoints_pkey" PRIMARY KEY ("source")
);

-- CreateTable: auth_users (Google-authenticated users)
CREATE TABLE "auth_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "google_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: auth_sessions (server-side sessions)
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "auth_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anon_user_id" UUID,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "idx_external_plays_source_play_id" ON "external_plays"("source", "source_play_id");
CREATE UNIQUE INDEX "auth_users_google_sub_key" ON "auth_users"("google_sub");
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- Indexes
CREATE INDEX "idx_external_plays_source" ON "external_plays"("source");
CREATE INDEX "idx_external_plays_song_id" ON "external_plays"("song_id");
CREATE INDEX "idx_auth_users_google_sub" ON "auth_users"("google_sub");
CREATE INDEX "idx_auth_users_email" ON "auth_users"("email");
CREATE INDEX "idx_auth_sessions_auth_user_id" ON "auth_sessions"("auth_user_id");
CREATE INDEX "idx_auth_sessions_expires_at" ON "auth_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "external_plays" ADD CONSTRAINT "external_plays_song_id_fkey"
    FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_auth_user_id_fkey"
    FOREIGN KEY ("auth_user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
