-- CreateTable
CREATE TABLE "songs" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "year" INTEGER,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mbid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "chosenSongId" UUID,
    "scores" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "anonHandle" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "songs_mbid_key" ON "songs"("mbid");

-- CreateIndex
CREATE INDEX "idx_songs_tags" ON "songs" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "idx_songs_phrases" ON "songs" USING GIN ("phrases");

-- CreateIndex
CREATE INDEX "idx_songs_title_artist" ON "songs"("title", "artist");

-- CreateIndex
CREATE INDEX "idx_songs_popularity" ON "songs"("popularity");

-- CreateIndex
CREATE INDEX "idx_songs_year" ON "songs"("year");

-- CreateIndex
CREATE INDEX "idx_messages_user_id" ON "messages"("userId");

-- CreateIndex
CREATE INDEX "idx_messages_song_id" ON "messages"("chosenSongId");

-- CreateIndex
CREATE INDEX "idx_messages_created_at" ON "messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_anonHandle_key" ON "users"("anonHandle");

-- CreateIndex
CREATE INDEX "idx_users_anon_handle" ON "users"("anonHandle");

-- CreateIndex
CREATE INDEX "idx_users_ip_hash" ON "users"("ipHash");

-- CreateIndex
CREATE INDEX "idx_users_created_at" ON "users"("createdAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chosenSongId_fkey" FOREIGN KEY ("chosenSongId") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
