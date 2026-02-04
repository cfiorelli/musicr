# Phase 1: Railway pgvector Database Setup & Verification

## Status: Ready for Execution (Awaiting DATABASE_URL)

---

## Prerequisites

- Railway PostgreSQL database with pgvector extension support
- DATABASE_URL connection string
- Node.js 20+ installed
- pnpm 8+ installed

---

## 1. Migration System Identified ✅

**System:** Prisma ORM v5.11.0 with PostgreSQL

**Key Files:**
- Schema: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma)
- Migration: [`apps/api/prisma/migrations/20250925234135_init/migration.sql`](apps/api/prisma/migrations/20250925234135_init/migration.sql) **(FIXED)**
- Init Script: [`init-db.sql`](init-db.sql)

**Migration Commands:**
```bash
# Working directory: /home/hpz240/musicr/apps/api

# Generate Prisma Client
pnpm db:generate

# Deploy migrations to DATABASE_URL (production-safe)
pnpm prisma migrate deploy

# Alternative: Push schema directly (dev only)
pnpm db:push
```

**Package.json Scripts Reference:** [`apps/api/package.json`](apps/api/package.json:14-19)

---

## 2. pgvector Extension Setup ✅

**Extension File:** [`init-db.sql`](init-db.sql)

**What it does:**
- Creates pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector`
- Sets up schema and permissions
- Required for `<=>` cosine distance operator

**Execution Command:**
```bash
# Option 1: Using psql directly
psql "$DATABASE_URL" -f /home/hpz240/musicr/init-db.sql

# Option 2: Via Railway CLI (if installed)
railway run psql < init-db.sql
```

**Verification:**
```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

---

## 3. Migration Fixed: `embedding` Field Added ✅

**Issue Found:** Original migration was missing:
- `embedding JSONB` column in songs table
- `roomId` column in messages table
- `rooms` table entirely

**Fix Applied:** [`apps/api/prisma/migrations/20250925234135_init/migration.sql`](apps/api/prisma/migrations/20250925234135_init/migration.sql)

**Changes Made:**
- Line 10: Added `"embedding" JSONB,` to songs table
- Line 21: Added `"roomId" UUID NOT NULL,` to messages table
- Lines 40-46: Added complete rooms table definition
- Lines 60-62: Added room indexes
- Line 93: Added foreign key constraint for messages -> rooms

**Schema Alignment:**
- ✅ Now matches [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma)
- ✅ Consistent with programmatic creation in [`apps/api/src/services/database.ts:51-133`](apps/api/src/services/database.ts#L51-L133)

---

## 4. Song Metadata Import (with Embeddings)

**Seed Script:** [`apps/api/scripts/seed.ts`](apps/api/scripts/seed.ts)

**Source Data:** [`apps/api/data/songs_seed.csv`](apps/api/data/songs_seed.csv)
- 193 songs (194 lines including header)
- Columns: title, artist, year, popularity, tags, phrases

**Embedding Model:** Hugging Face Xenova/all-MiniLM-L6-v2
- 384-dimensional vectors
- Normalized cosine similarity
- Local inference (no API calls)

**Features:**
- Duplicate detection (case-insensitive title + artist)
- Progress logging every 10 songs
- Graceful error handling per song
- Automatic embedding generation

**Execution Command:**
```bash
cd /home/hpz240/musicr/apps/api
DATABASE_URL="your_railway_url" pnpm seed
```

**Expected Output:**
```
🌱 Starting database seeding process...
✅ Database connected
Initializing sentence transformer model...
✅ Embedding model loaded successfully
✅ Parsed 193 songs from CSV
Processed 10/193 songs...
Processed 20/193 songs...
...
✅ Seeding complete! Processed: 193, Skipped: 0
✅ Database now contains 193 songs total
```

**Alternative (no embeddings, faster):**
```bash
pnpm seed:simple
```
Script: [`apps/api/scripts/seed-simple.ts`](apps/api/scripts/seed-simple.ts)

---

## 5. Backfill Embeddings

**Note:** The `seed.ts` script ALREADY generates embeddings during import.

**If you need to backfill existing songs without embeddings:**

Create script: [`apps/api/scripts/backfill-embeddings.ts`](apps/api/scripts/backfill-embeddings.ts)

```typescript
import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import { pipeline } from '@huggingface/transformers';

async function backfillEmbeddings() {
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const songs = await prisma.song.findMany({
    where: { embedding: null }
  });

  logger.info(`Found ${songs.length} songs without embeddings`);

  for (const song of songs) {
    const text = `${song.title} by ${song.artist} ${song.tags.join(' ')} ${song.phrases.join(' ')}`;
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    const embedding = Array.from(result.data);

    await prisma.song.update({
      where: { id: song.id },
      data: { embedding }
    });

    logger.info(`Updated: ${song.title}`);
  }
}

backfillEmbeddings();
```

---

## 6. Phase 1 Verification Script ✅

**Created:** [`apps/api/scripts/verify-phase1.ts`](apps/api/scripts/verify-phase1.ts)

**Verification Steps:**
1. ✅ pgvector extension enabled
2. ✅ All tables exist (songs, users, rooms, messages)
3. ✅ Count songs (total and with embeddings)
4. ✅ Sample 3 embeddings, confirm non-zero norm
5. ✅ Run similarity query, return topK songs

**Execution Command:**
```bash
cd /home/hpz240/musicr/apps/api
DATABASE_URL="your_railway_url" pnpm tsx scripts/verify-phase1.ts
```

**Expected Output:**
```
🔍 Starting Phase 1 Verification...
✅ Database connected

================================================================================
PHASE 1 VERIFICATION RESULTS
================================================================================

✅ PASS | 1. pgvector extension
   Details: { "version": "0.7.0" }

✅ PASS | 2. Tables exist
   Details: { "tables": ["messages", "rooms", "songs", "users"] }

✅ PASS | 3. Song count
   Details: {
     "totalSongs": 193,
     "songsWithEmbeddings": 193,
     "embeddingCoverage": "100.0%"
   }

✅ PASS | 4. Sample embeddings (verify non-zero norm)
   Details: {
     "samples": [
       {
         "title": "Bohemian Rhapsody",
         "artist": "Queen",
         "embeddingDimension": 384,
         "norm": "0.999998",
         "nonZero": true
       },
       ...
     ]
   }

✅ PASS | 5. Similarity query (topK songs)
   Details: {
     "query": "feeling happy and energetic",
     "topK": 5,
     "results": [
       { "title": "Happy", "artist": "Pharrell Williams", "similarity": "0.8234" },
       ...
     ]
   }

================================================================================
SUMMARY: 5/5 checks passed
================================================================================

🎉 Phase 1 verification PASSED! Database is ready for relaunch.
```

---

## Complete Execution Sequence

**Once DATABASE_URL is provided, execute these commands:**

```bash
# Set environment variable
export DATABASE_URL="postgresql://user:pass@host:port/db?sslmode=require"

# Navigate to API directory
cd /home/hpz240/musicr/apps/api

# Step 1: Enable pgvector extension
psql "$DATABASE_URL" -f ../../init-db.sql

# Step 2: Generate Prisma Client
pnpm db:generate

# Step 3: Deploy migrations
pnpm prisma migrate deploy

# Step 4: Seed songs with embeddings
pnpm seed

# Step 5: Run verification
pnpm tsx scripts/verify-phase1.ts
```

---

## Manual Verification Queries

**List all tables:**
```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

**Count songs:**
```sql
SELECT COUNT(*) as total_songs FROM songs;
SELECT COUNT(*) as songs_with_embeddings FROM songs WHERE embedding IS NOT NULL;
```

**Sample 3 embeddings:**
```sql
SELECT
  title,
  artist,
  jsonb_array_length(embedding) as dimension,
  embedding
FROM songs
WHERE embedding IS NOT NULL
LIMIT 3;
```

**Test similarity search:**
```sql
-- First, get an embedding from a song
WITH sample_embedding AS (
  SELECT embedding FROM songs WHERE title ILIKE '%happy%' LIMIT 1
)
SELECT
  title,
  artist,
  year,
  (songs.embedding <=> (SELECT embedding FROM sample_embedding)::vector) * -1 + 1 as similarity
FROM songs
WHERE embedding IS NOT NULL
ORDER BY songs.embedding <=> (SELECT embedding FROM sample_embedding)::vector
LIMIT 5;
```

---

## Key File References

| Purpose | File Path | Line Reference |
|---------|-----------|----------------|
| Prisma Schema | `apps/api/prisma/schema.prisma` | Full file |
| Migration SQL | `apps/api/prisma/migrations/20250925234135_init/migration.sql` | Lines 2-95 |
| pgvector Init | `init-db.sql` | Lines 1-26 |
| Seed Script (with embeddings) | `apps/api/scripts/seed.ts` | Lines 1-215 |
| Seed Simple (no embeddings) | `apps/api/scripts/seed-simple.ts` | Lines 1-162 |
| Verification Script | `apps/api/scripts/verify-phase1.ts` | Lines 1-end |
| Embedding Service | `apps/api/src/embeddings/index.ts` | Export |
| Semantic Search | `apps/api/src/engine/matchers/semantic.ts` | Lines 55-131 |
| Database Service | `apps/api/src/services/database.ts` | Lines 51-133 |
| CSV Data | `apps/api/data/songs_seed.csv` | 194 lines |

---

## Status: ⏸️ WAITING FOR DATABASE_URL

Once you provide the Railway PostgreSQL DATABASE_URL, I will:
1. Execute all setup commands
2. Run seeding with embeddings
3. Run verification script
4. Provide Phase 1 completion report

**Please provide your Railway DATABASE_URL in the format:**
```
postgresql://user:password@host.railway.app:port/railway?sslmode=require
```
