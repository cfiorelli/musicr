# PHASE 2: Implementation Checklist

**Repository:** musicr
**Current State:** Phase 1 complete (DB live, 193 songs, embeddings working)
**Goal:** Production-ready relaunch with performance, security, and UX fixes

---

## SECTION A: END-TO-END VERIFICATION

### A1. Create Smoke Test Script

**File:** [`apps/api/scripts/smoke-test.ts`](apps/api/scripts/smoke-test.ts)

```bash
cd /home/hpz240/musicr/apps/api

cat > scripts/smoke-test.ts << 'EOF'
import 'dotenv/config';
import WebSocket from 'ws';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

async function smokeTest() {
  console.log('🔍 Smoke Test Starting...\n');

  try {
    // 1. Database connection
    console.log('1. Database connection...');
    const songCount = await prisma.song.count();
    console.log(`   ✅ Connected. Songs: ${songCount}`);

    // 2. WebSocket connection
    console.log('2. WebSocket connection...');
    const ws = new WebSocket('ws://localhost:4000/ws');

    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        console.log('   ✅ Connected');
        resolve(null);
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    // 3. Send test message
    console.log('3. Sending test message...');
    ws.send(JSON.stringify({type: 'msg', text: 'happy song'}));

    const songResponse = await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'song') {
          console.log(`   ✅ Received song: "${msg.primary.title}" by ${msg.primary.artist}`);
          resolve(msg);
        }
      });
      setTimeout(() => reject(new Error('No response in 10 seconds')), 10000);
    });

    // 4. Check message persistence
    console.log('4. Checking database persistence...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for DB write
    const recentMsg = await prisma.message.findFirst({
      where: {text: 'happy song'},
      orderBy: {createdAt: 'desc'},
      include: {song: true}
    });

    if (recentMsg) {
      console.log(`   ✅ Message persisted. Song: ${recentMsg.song?.title || 'N/A'}`);
    } else {
      console.log('   ❌ Message not found in database');
    }

    ws.close();
    await prisma.$disconnect();

    console.log('\n🎉 Smoke test PASSED!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Smoke test FAILED:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

smokeTest();
EOF
```

**Run:**
```bash
# Terminal 1: Start API server
cd /home/hpz240/musicr/apps/api
DATABASE_URL="postgresql://postgres:***@your-railway-host.proxy.rlwy.net:PORT/railway?sslmode=require" \
OPENAI_API_KEY="sk-proj-***" \
pnpm dev

# Terminal 2: Run smoke test
cd /home/hpz240/musicr/apps/api
DATABASE_URL="postgresql://postgres:***@your-railway-host.proxy.rlwy.net:PORT/railway?sslmode=require" \
pnpm tsx scripts/smoke-test.ts
```

**Expected Output:**
```
🔍 Smoke Test Starting...
1. Database connection...
   ✅ Connected. Songs: 193
2. WebSocket connection...
   ✅ Connected
3. Sending test message...
   ✅ Received song: "Happy" by Pharrell Williams
4. Checking database persistence...
   ✅ Message persisted. Song: Happy
🎉 Smoke test PASSED!
```

---

## SECTION B: FIX PRODUCTION BLOCKERS

### B1. Update DATABASE_URL to Use SSL

**File:** [`apps/api/.env.example`](apps/api/.env.example)

```bash
cd /home/hpz240/musicr/apps/api

# Update .env.example
sed -i 's|?schema=public|?sslmode=require|g' .env.example

# For Railway deployment, create .env.railway
cat > .env.railway << 'EOF'
NODE_ENV=production
PORT=4000
DATABASE_URL=${DATABASE_URL}?sslmode=require
COOKIE_SECRET=${COOKIE_SECRET}
OPENAI_API_KEY=${OPENAI_API_KEY}
FRONTEND_ORIGIN=https://musicr.app,https://www.musicr.app
EOF
```

**Test SSL connection:**
```bash
psql "postgresql://postgres:***@your-railway-host.proxy.rlwy.net:PORT/railway?sslmode=require" -c "SELECT version();"
```

---

### B2. Add Native Vector Column + Index

**Step 1: Create Migration**

```bash
cd /home/hpz240/musicr/apps/api

# Create migration file
mkdir -p prisma/migrations/20260202000001_add_native_vector
cat > prisma/migrations/20260202000001_add_native_vector/migration.sql << 'EOF'
-- Add native vector column (1536 dimensions for OpenAI text-embedding-3-small)
ALTER TABLE songs ADD COLUMN embedding_vector vector(1536);

-- Backfill from JSONB (may take a few minutes for 193 songs)
UPDATE songs
SET embedding_vector = (embedding::text)::vector
WHERE embedding IS NOT NULL;

-- Create HNSW index for fast similarity search
-- m=16: number of connections per node
-- ef_construction=64: quality during build (higher = better but slower)
CREATE INDEX idx_songs_embedding_hnsw
ON songs
USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Add comment
COMMENT ON COLUMN songs.embedding_vector IS 'Native pgvector column for fast similarity search';
EOF
```

**Step 2: Apply Migration**

```bash
DATABASE_URL="postgresql://postgres:***@your-railway-host.proxy.rlwy.net:PORT/railway?sslmode=require" \
pnpm prisma migrate deploy
```

**Expected output:**
```
Applying migration `20260202000001_add_native_vector`
All migrations have been successfully applied.
```

**Step 3: Verify Index**

```bash
psql "postgresql://postgres:***@your-railway-host.proxy.rlwy.net:PORT/railway?sslmode=require" << 'EOF'
-- Check column exists
\d songs

-- Check index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'songs' AND indexname LIKE '%hnsw%';

-- Test query performance
EXPLAIN ANALYZE
SELECT title, artist, embedding_vector <=> '[0.1, 0.2, ...]'::vector(1536) as distance
FROM songs
WHERE embedding_vector IS NOT NULL
ORDER BY embedding_vector <=> '[0.1, 0.2, ...]'::vector(1536)
LIMIT 10;
EOF
```

---

### B3. Update Semantic Search to Use Native Vector

**File:** [`apps/api/src/engine/matchers/semantic.ts:80-92`](apps/api/src/engine/matchers/semantic.ts#L80-L92)

```bash
cd /home/hpz240/musicr/apps/api/src/engine/matchers

# Backup original
cp semantic.ts semantic.ts.backup

# Update query to use native vector column
cat > semantic.ts << 'EOF'
/**
 * Semantic KNN Searcher
 *
 * Performs embedding-based K-nearest neighbor search using cosine similarity
 * against Song.embedding_vector (native pgvector column).
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/index.js';
import { getEmbeddingService } from '../../embeddings/index.js';

export interface SemanticMatch {
  songId: string;
  title: string;
  artist: string;
  similarity: number;
  distance: number;
  tags: string[];
  year?: number;
  decade?: number;
  popularity: number;
}

export interface SemanticConfig {
  knn_size: number;
  embedding_model?: string;
  similarity_threshold?: number;
  use_reranking?: boolean;
}

type RawSimilarityResult = {
  id: string;
  title: string;
  artist: string;
  tags: string[];
  year: number | null;
  popularity: number;
  similarity: number;
};

export class SemanticSearcher {
  private prisma: PrismaClient;
  private config: SemanticConfig;

  constructor(prisma: PrismaClient, config: SemanticConfig) {
    this.prisma = prisma;
    this.config = {
      similarity_threshold: 0.5,
      use_reranking: true,
      ...config
    };
  }

  /**
   * Find semantically similar songs using embedding search
   */
  async findSimilar(message: string, k: number = 50): Promise<SemanticMatch[]> {
    const startTime = Date.now();

    try {
      // Generate embedding for the input message
      logger.debug({ message: message.substring(0, 100) }, 'Generating message embedding');
      const embeddingService = await getEmbeddingService();
      const messageEmbedding = await embeddingService.embedSingle(message);

      // Use native vector column for fast similarity search
      logger.debug('Performing vector similarity search with HNSW index');

      const embeddingString = `[${messageEmbedding.join(',')}]`;

      // Native vector query (no casting needed!)
      const results = await this.prisma.$queryRaw<Array<{
        id: string;
        title: string;
        artist: string;
        tags: string[];
        year: number | null;
        popularity: number;
        similarity: number;
      }>>`
        SELECT
          id,
          title,
          artist,
          tags,
          year,
          popularity,
          (embedding_vector <=> ${embeddingString}::vector) * -1 + 1 as similarity
        FROM songs
        WHERE embedding_vector IS NOT NULL
        ORDER BY embedding_vector <=> ${embeddingString}::vector
        LIMIT ${k * 2}
      `;

      if (results.length === 0) {
        logger.warn('No songs with embeddings found in database');
        return [];
      }

      logger.debug({ songCount: results.length }, 'Computing similarities complete');

      // Convert results to SemanticMatch format
      const matches: SemanticMatch[] = results
        .filter((result: RawSimilarityResult) => result.similarity >= (this.config.similarity_threshold || 0.5))
        .map((result: RawSimilarityResult) => ({
          songId: result.id,
          title: result.title,
          artist: result.artist,
          similarity: result.similarity,
          distance: 1 - result.similarity,
          tags: result.tags || [],
          year: result.year || undefined,
          decade: result.year ? Math.floor(result.year / 10) * 10 : undefined,
          popularity: result.popularity
        }))
        .slice(0, k);

      const duration = Date.now() - startTime;
      logger.debug({
        totalResults: results.length,
        filteredMatches: matches.length,
        topSimilarity: matches[0]?.similarity || 0,
        duration
      }, 'Semantic search completed');

      return matches;

    } catch (error) {
      logger.error({ error, message }, 'Semantic search failed');
      throw error;
    }
  }

  // ... rest of methods remain the same ...
}
EOF
```

**Rebuild:**
```bash
cd /home/hpz240/musicr/apps/api
pnpm build
```

---

### B4. Create Vector Column Sync Script

**File:** [`apps/api/scripts/sync-vector-column.ts`](apps/api/scripts/sync-vector-column.ts)

```bash
cd /home/hpz240/musicr/apps/api

cat > scripts/sync-vector-column.ts << 'EOF'
import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

async function syncVectorColumn() {
  logger.info('🔄 Syncing JSONB embeddings to native vector column...');

  const songs = await prisma.song.findMany({
    where: { embedding: { not: null } },
    select: { id: true, embedding: true, title: true, artist: true }
  });

  logger.info(`Found ${songs.length} songs with embeddings`);

  let synced = 0;
  let errors = 0;

  for (const song of songs) {
    try {
      const embeddingArray = song.embedding as number[];

      if (!Array.isArray(embeddingArray) || embeddingArray.length === 0) {
        logger.warn(`Skipping ${song.title}: invalid embedding`);
        continue;
      }

      const vectorString = `[${embeddingArray.join(',')}]`;

      await prisma.$executeRaw`
        UPDATE songs
        SET embedding_vector = ${vectorString}::vector
        WHERE id = ${song.id}::uuid
      `;

      synced++;

      if (synced % 50 === 0) {
        logger.info(`Progress: ${synced}/${songs.length} synced`);
      }

    } catch (error) {
      logger.error({ song: song.title, error }, 'Failed to sync song');
      errors++;
    }
  }

  logger.info('='.repeat(80));
  logger.info(`✅ Sync complete!`);
  logger.info(`   Synced: ${synced}`);
  logger.info(`   Errors: ${errors}`);
  logger.info('='.repeat(80));

  await prisma.$disconnect();
}

syncVectorColumn();
EOF
```

**Run:**
```bash
DATABASE_URL="postgresql://postgres:***@your-railway-host.proxy.rlwy.net:PORT/railway?sslmode=require" \
pnpm tsx scripts/sync-vector-column.ts
```

---

## SECTION C: FIX SECURITY ISSUES

### C1. Re-enable Seed Endpoint Protection

**File:** [`apps/api/src/index.ts:669-673`](apps/api/src/index.ts#L669-L673)

```bash
cd /home/hpz240/musicr/apps/api/src

# Uncomment the production check
sed -i 's|// if (process.env.NODE_ENV|if (process.env.NODE_ENV|g' index.ts
sed -i 's|// return reply.code(403)|return reply.code(403)|g' index.ts
sed -i 's|// }| }|g' index.ts
```

**Verify:**
```bash
grep -A2 "Seed endpoint disabled" index.ts
```

Expected output:
```typescript
if (process.env.NODE_ENV === 'production') {
  return reply.code(403).send({ error: 'Seed endpoint disabled in production' });
}
```

---

### C2. Make COOKIE_SECRET Required in Production

**File:** [`apps/api/src/index.ts:47`](apps/api/src/index.ts#L47)

```bash
cd /home/hpz240/musicr/apps/api/src

# Replace line 47
sed -i "47s/.*/  secret: (() => {/" index.ts
sed -i "48i\    if (config.nodeEnv === 'production' && !process.env.COOKIE_SECRET) {" index.ts
sed -i "49i\      throw new Error('COOKIE_SECRET environment variable is required in production');" index.ts
sed -i "50i\    }" index.ts
sed -i "51i\    return process.env.COOKIE_SECRET || 'dev-secret-not-for-production';" index.ts
sed -i "52i\  })()," index.ts
```

**Or manually edit:**
```typescript
await fastify.register(cookie, {
  secret: (() => {
    if (config.nodeEnv === 'production' && !process.env.COOKIE_SECRET) {
      throw new Error('COOKIE_SECRET environment variable is required in production');
    }
    return process.env.COOKIE_SECRET || 'dev-secret-not-for-production';
  })(),
  parseOptions: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
  }
});
```

---

### C3. Fix Admin Dashboard Hardcoded URL

**File:** [`apps/web/src/components/AdminDashboard.tsx:58`](apps/web/src/components/AdminDashboard.tsx#L58)

```bash
cd /home/hpz240/musicr/apps/web/src/components

# Create dynamic API URL helper
cat > ../utils/apiUrl.ts << 'EOF'
export function getApiUrl(): string {
  // In development, derive from window.location
  if (import.meta.env.DEV) {
    const host = window.location.hostname;
    const port = host === 'localhost' ? '4000' : window.location.port;
    return `http://${host}:${port}`;
  }

  // In production, use env var or default
  return import.meta.env.VITE_API_URL || 'https://musicrapi-production.up.railway.app';
}
EOF

# Update AdminDashboard.tsx
# Replace line 58
sed -i "58s|.*|        const response = await fetch(\`\${getApiUrl()}/api/admin/analytics\`);|" AdminDashboard.tsx

# Add import at top
sed -i "1i import { getApiUrl } from '../utils/apiUrl';" AdminDashboard.tsx
```

**Also update chatStore.ts for consistency:**

```bash
cd /home/hpz240/musicr/apps/web/src/stores

# Update WebSocket URL derivation (already dynamic, but verify)
grep "const wsUrl" chatStore.ts
```

Should see:
```typescript
const wsUrl = `ws://${host}:4000/ws`;
```

---

### C4. Remove Sensitive Logging

**File:** [`apps/api/src/config/env.ts:31-33`](apps/api/src/config/env.ts#L31-L33)

```bash
cd /home/hpz240/musicr/apps/api/src/config

# Replace error logging
sed -i "31,33d" env.ts
sed -i "31i\    logger.error('Failed to get DATABASE_URL. Check environment variables: DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT');" env.ts
```

---

### C5. Add Message Length Validation

**File:** [`apps/api/src/index.ts:1066`](apps/api/src/index.ts#L1066)

```bash
cd /home/hpz240/musicr/apps/api/src

# Add after line 1066 (websocket 'message' handler)
# Find the line with: const data = JSON.parse(message.toString());

# Insert validation after parsing:
cat > /tmp/validation.txt << 'EOF'

        // Validate message format
        if (!data.text || typeof data.text !== 'string') {
          connection.socket.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format'
          }));
          return;
        }

        // Enforce message length
        if (data.text.length > 500) {
          connection.socket.send(JSON.stringify({
            type: 'error',
            message: 'Message too long (max 500 characters)'
          }));
          return;
        }

        if (data.text.trim().length === 0) {
          connection.socket.send(JSON.stringify({
            type: 'error',
            message: 'Message cannot be empty'
          }));
          return;
        }
EOF

# Manual edit recommended for this one
echo "⚠️  Add validation code from /tmp/validation.txt after line parsing data"
```

---

## SECTION D: ACCESSIBILITY FIXES

### D1. Run Lighthouse Scan

```bash
# Install lighthouse CLI
npm install -g lighthouse

# Start dev servers
cd /home/hpz240/musicr
pnpm dev &
DEV_PID=$!

# Wait for servers to start
sleep 10

# Run lighthouse
lighthouse http://localhost:5173 \
  --output=html \
  --output=json \
  --output-path=./lighthouse-report \
  --chrome-flags="--headless" \
  --only-categories=accessibility,performance,best-practices

# Kill dev servers
kill $DEV_PID
```

**Review report:**
```bash
open lighthouse-report.report.html
# Or: xdg-open lighthouse-report.report.html on Linux
```

---

### D2. Add ARIA Labels to ChatInterface

**File:** [`apps/web/src/components/ChatInterface.tsx`](apps/web/src/components/ChatInterface.tsx)

```bash
cd /home/hpz240/musicr/apps/web/src/components

# Backup
cp ChatInterface.tsx ChatInterface.tsx.backup

# Apply accessibility fixes (manual edit recommended)
cat > /tmp/a11y-fixes.txt << 'EOF'
// Add to input field (line ~137):
<input
  aria-label="Type your message"
  aria-describedby="char-count"
  type="text"
  ...
/>

// Add character count (hidden for sighted users):
<span id="char-count" className="sr-only">
  {text.length} of 500 characters
</span>

// Add to send button:
<button aria-label="Send message" onClick={handleSubmit}>
  Send
</button>

// Add to family-friendly toggle:
<button
  aria-label={familyFriendly ? "Disable family-friendly mode" : "Enable family-friendly mode"}
  onClick={toggleFamilyFriendly}
>
  {familyFriendly ? '👨‍👩‍👧' : '🔞'}
</button>

// Add to song cards:
<div
  role="button"
  tabIndex={0}
  aria-label={`Song: ${song.title} by ${song.artist}, released ${song.year}`}
  onKeyPress={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // Handle click
    }
  }}
>
  ...
</div>

// Add live region for song announcements:
<div role="status" aria-live="polite" className="sr-only">
  {latestSong && `Matched song: ${latestSong.title} by ${latestSong.artist}`}
</div>

// Add error alert:
<div role="alert" aria-live="assertive" className="sr-only">
  {error && error}
</div>
EOF

echo "⚠️  Apply fixes from /tmp/a11y-fixes.txt to ChatInterface.tsx"
```

---

### D3. Add Screen Reader Utility Class

**File:** [`apps/web/src/index.css`](apps/web/src/index.css)

```bash
cd /home/hpz240/musicr/apps/web/src

cat >> index.css << 'EOF'

/* Screen reader only utility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.sr-only.focus:focus,
.sr-only.focus-visible:focus-visible {
  position: static;
  width: auto;
  height: auto;
  padding: inherit;
  margin: inherit;
  overflow: visible;
  clip: auto;
  white-space: normal;
}

/* Focus visible styles */
*:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

/* Skip link */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: #2563eb;
  color: white;
  padding: 8px;
  z-index: 100;
  text-decoration: none;
}

.skip-link:focus {
  top: 0;
}
EOF
```

---

## SECTION E: CATALOG EXPANSION

### E1. Create Catalog Schema

```bash
cd /home/hpz240/musicr/apps/api
mkdir -p data/catalog

cat > data/catalog/README.md << 'EOF'
# Song Catalog

## Format: JSONL (JSON Lines)

Each line is a valid JSON object representing a song.

## Schema

```json
{
  "id": "uuid",                    // Optional: auto-generated if omitted
  "title": "Song Title",           // Required
  "artist": "Artist Name",         // Required
  "year": 1985,                    // Optional: release year
  "popularity": 75,                // Required: 0-100
  "genres": ["pop", "rock"],       // Required: genre tags
  "moods": ["happy", "energetic"], // Required: mood descriptors
  "descriptors": [                 // Required: unique characteristics
    "synthesizer-driven",
    "catchy chorus",
    "upbeat tempo"
  ],
  "mbid": "abc-123-def"            // Optional: MusicBrainz ID
}
```

## Field Guidelines

### Genres
Use standard genre tags:
- rock, pop, hip-hop, rap, r&b, soul, funk, jazz, blues, country, folk
- electronic, dance, house, techno, ambient, indie, alternative, punk, metal
- classical, opera, world, latin, reggae, ska, gospel

### Moods
Choose 1-3 moods:
- happy, sad, angry, calm, energetic, melancholic, romantic, nostalgic
- uplifting, dark, mysterious, playful, serious, relaxed, tense

### Descriptors (NOT genres or moods!)
Unique song characteristics:
- Instrumentation: "acoustic guitar", "heavy bass", "string section"
- Vocal style: "raspy vocals", "harmonized chorus", "spoken word"
- Tempo: "slow ballad", "mid-tempo groove", "fast-paced"
- Production: "lo-fi", "heavily produced", "live recording"
- Structure: "build-up and drop", "call and response", "instrumental bridge"
- Themes: "coming of age", "social commentary", "love letter"

BAD descriptors (redundant):
- ❌ "rock song" (use genres)
- ❌ "upbeat" (use moods)
- ❌ "popular" (use popularity score)

GOOD descriptors (unique):
- ✅ "iconic guitar riff"
- ✅ "falsetto vocals"
- ✅ "syncopated rhythm"
EOF

# Create example catalog file
cat > data/catalog/songs-example.jsonl << 'EOF'
{"title":"Bohemian Rhapsody","artist":"Queen","year":1975,"popularity":100,"genres":["rock","progressive rock","opera"],"moods":["dramatic","theatrical","epic"],"descriptors":["multi-section structure","operatic vocals","piano-driven intro","guitar solo crescendo"],"mbid":"b1a9c0e9-d987-4042-ae91-78d6a3267d69"}
{"title":"Billie Jean","artist":"Michael Jackson","year":1982,"popularity":98,"genres":["pop","dance","r&b"],"moods":["mysterious","tense","groovy"],"descriptors":["iconic bassline","tight drum programming","vocal hiccups","storytelling narrative"],"mbid":"f6f2b6a8-8b5e-4e4c-8e5e-5e5e5e5e5e5e"}
{"title":"Smells Like Teen Spirit","artist":"Nirvana","year":1991,"popularity":95,"genres":["grunge","alternative rock"],"moods":["rebellious","angsty","raw"],"descriptors":["quiet-loud dynamics","distorted power chords","mumbled verses","anthemic chorus","generation-defining"],"mbid":"c6c2b6a8-8b5e-4e4c-8e5e-5e5e5e5e5e5e"}
EOF
```

---

### E2. Create Import Script

**File:** [`apps/api/scripts/import-catalog.ts`](apps/api/scripts/import-catalog.ts)

```bash
cd /home/hpz240/musicr/apps/api

cat > scripts/import-catalog.ts << 'EOF'
import 'dotenv/config';
import fs from 'fs';
import readline from 'readline';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import OpenAI from 'openai';

interface CatalogSong {
  id?: string;
  title: string;
  artist: string;
  year?: number;
  popularity: number;
  genres: string[];
  moods: string[];
  descriptors: string[];
  mbid?: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function importCatalog(filePath: string, options: {
  skipExisting?: boolean;
  reembedAll?: boolean;
  batchSize?: number;
}) {
  const { skipExisting = true, reembedAll = false, batchSize = 100 } = options;

  logger.info(`Starting catalog import from ${filePath}`);
  logger.info(`Options: skipExisting=${skipExisting}, reembedAll=${reembedAll}, batchSize=${batchSize}`);

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const batch: CatalogSong[] = [];
  let lineCount = 0;
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for await (const line of rl) {
    lineCount++;

    if (line.trim().length === 0) continue;

    try {
      const song: CatalogSong = JSON.parse(line);
      batch.push(song);

      if (batch.length >= batchSize) {
        const result = await processBatch(batch, { skipExisting, reembedAll });
        imported += result.imported;
        skipped += result.skipped;
        errors += result.errors;
        batch.length = 0;

        logger.info(`Progress: ${lineCount} lines, ${imported} imported, ${skipped} skipped, ${errors} errors`);
      }
    } catch (error) {
      logger.error({ line: lineCount, error }, 'Failed to parse line');
      errors++;
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    const result = await processBatch(batch, { skipExisting, reembedAll });
    imported += result.imported;
    skipped += result.skipped;
    errors += result.errors;
  }

  logger.info('='.repeat(80));
  logger.info('Import complete!');
  logger.info(`  Total lines: ${lineCount}`);
  logger.info(`  Imported: ${imported}`);
  logger.info(`  Skipped: ${skipped}`);
  logger.info(`  Errors: ${errors}`);
  logger.info('='.repeat(80));

  await prisma.$disconnect();
}

async function processBatch(songs: CatalogSong[], options: {
  skipExisting: boolean;
  reembedAll: boolean;
}) {
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const song of songs) {
    try {
      // Check if song exists
      const existing = await prisma.song.findFirst({
        where: {
          AND: [
            { title: { equals: song.title, mode: 'insensitive' } },
            { artist: { equals: song.artist, mode: 'insensitive' } }
          ]
        }
      });

      if (existing && options.skipExisting && !options.reembedAll) {
        skipped++;
        continue;
      }

      // Generate embedding
      const searchText = createSearchText(song);
      const embedding = await generateEmbedding(searchText);

      // Combine tags (genres + moods)
      const tags = [...song.genres, ...song.moods];
      const phrases = song.descriptors; // Unique descriptors

      if (existing) {
        // Update
        await prisma.song.update({
          where: { id: existing.id },
          data: {
            year: song.year,
            popularity: song.popularity,
            tags,
            phrases,
            embedding,
            mbid: song.mbid
          }
        });
      } else {
        // Insert
        await prisma.song.create({
          data: {
            title: song.title,
            artist: song.artist,
            year: song.year,
            popularity: song.popularity,
            tags,
            phrases,
            embedding,
            mbid: song.mbid
          }
        });
      }

      imported++;

    } catch (error) {
      logger.error({ song: `${song.title} by ${song.artist}`, error }, 'Failed to import song');
      errors++;
    }
  }

  return { imported, skipped, errors };
}

function createSearchText(song: CatalogSong): string {
  return [
    `${song.title} by ${song.artist}`,
    song.year ? `from ${song.year}` : '',
    ...song.genres,
    ...song.moods,
    ...song.descriptors
  ].filter(Boolean).join(' ');
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    encoding_format: 'float'
  });
  return response.data[0].embedding;
}

// CLI
const filePath = process.argv[2] || 'data/catalog/songs.jsonl';
const skipExisting = process.argv.includes('--skip-existing');
const reembedAll = process.argv.includes('--reembed-all');
const batchSizeArg = process.argv.find(arg => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;

importCatalog(filePath, { skipExisting, reembedAll, batchSize })
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ error }, 'Import failed');
    process.exit(1);
  });
EOF
```

**Usage:**
```bash
cd /home/hpz240/musicr/apps/api

# Test with example
DATABASE_URL="$DATABASE_URL" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
pnpm tsx scripts/import-catalog.ts data/catalog/songs-example.jsonl

# Import full catalog (when ready)
DATABASE_URL="$DATABASE_URL" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
pnpm tsx scripts/import-catalog.ts data/catalog/songs.jsonl --skip-existing

# Re-embed all (after model change)
DATABASE_URL="$DATABASE_URL" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
pnpm tsx scripts/import-catalog.ts data/catalog/songs.jsonl --reembed-all
```

---

## SECTION F: PRODUCT FEATURES

### F1. Add Top 3 Matches Display

**File:** [`apps/web/src/components/ChatInterface.tsx`](apps/web/src/components/ChatInterface.tsx)

Update message display to show top 3:

```tsx
// Around line 195-235
{message.songs && (
  <div className="mt-2 space-y-2">
    {/* Primary match */}
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-blue-900">
            🎵 {message.songs.primary.title}
          </div>
          <div className="text-sm text-blue-700">
            {message.songs.primary.artist} {message.songs.primary.year && `(${message.songs.primary.year})`}
          </div>
        </div>
        {message.songs.confidence && (
          <div className="text-xs text-blue-600 font-mono">
            {Math.round(message.songs.confidence * 100)}%
          </div>
        )}
      </div>
    </div>

    {/* Alternates */}
    {message.songs.alternates && message.songs.alternates.length > 0 && (
      <div className="space-y-1">
        <div className="text-xs text-gray-500">Other matches:</div>
        {message.songs.alternates.slice(0, 2).map((alt, idx) => (
          <div
            key={idx}
            className="bg-gray-50 border border-gray-200 rounded p-2 text-sm hover:bg-gray-100 cursor-pointer"
            onClick={() => handleAlternateClick(message.id, alt)}
          >
            • {alt.title} - {alt.artist}
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

---

### F2. Add Reroll Feature

**Backend: Add WebSocket handler**

File: [`apps/api/src/index.ts:1300`](apps/api/src/index.ts#L1300)

```typescript
// Add after 'msg' handler
if (data.type === 'reroll') {
  // Reroll logic
  const messageId = data.messageId;

  // Fetch original message
  const originalMessage = await prisma.message.findUnique({
    where: { id: messageId },
    include: { song: true }
  });

  if (!originalMessage) {
    connection.socket.send(JSON.stringify({
      type: 'error',
      message: 'Message not found'
    }));
    return;
  }

  // Extract previous songs to exclude
  const scores = originalMessage.scores as any;
  const excludeSongs = [
    scores?.primary?.title,
    ...(scores?.alternates || []).map((a: any) => a.title)
  ].filter(Boolean);

  // Re-run matching with exclusions
  const result = await songMatchingService.matchSongs(
    originalMessage.text,
    data.allowExplicit !== false,
    userId,
    { excludeTitles: excludeSongs } // New option
  );

  // Update message
  await prisma.message.update({
    where: { id: messageId },
    data: {
      scores: result.scores,
      chosenSongId: null // Reset choice
    }
  });

  // Send update
  connection.socket.send(JSON.stringify({
    type: 'reroll_result',
    messageId,
    primary: result.primary,
    alternates: result.alternates
  }));

  return;
}
```

**Frontend: Add reroll button**

```tsx
<button
  onClick={() => handleReroll(message.id)}
  className="text-xs text-gray-500 hover:text-gray-700"
  aria-label="Get different song match"
>
  🔄 Reroll
</button>
```

**Store handler:**
```typescript
// In chatStore.ts
rerollMessage: (messageId: string) => {
  const ws = get().ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'reroll',
      messageId
    }));
  }
}
```

---

## SECTION G: INSTRUMENTATION

### G1. Add Metrics Tracking

**File:** [`apps/api/src/utils/metrics.ts`](apps/api/src/utils/metrics.ts)

```bash
cd /home/hpz240/musicr/apps/api/src/utils

cat > metrics.ts << 'EOF'
import { logger } from '../config/index.js';

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  increment(metric: string, value: number = 1) {
    const current = this.counters.get(metric) || 0;
    this.counters.set(metric, current + value);
  }

  recordDuration(metric: string, ms: number) {
    if (!this.histograms.has(metric)) {
      this.histograms.set(metric, []);
    }
    this.histograms.get(metric)!.push(ms);
  }

  getSnapshot() {
    const snapshot: any = {
      counters: Object.fromEntries(this.counters),
      histograms: {}
    };

    for (const [key, values] of this.histograms) {
      if (values.length === 0) continue;

      const sorted = values.sort((a, b) => a - b);
      snapshot.histograms[key] = {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)]
      };
    }

    return snapshot;
  }

  reset() {
    this.counters.clear();
    this.histograms.clear();
  }
}

export const metrics = new Metrics();

// Flush metrics every 60 seconds
setInterval(() => {
  const snapshot = metrics.getSnapshot();
  logger.info({ metrics: snapshot }, 'Metrics snapshot');
  metrics.reset();
}, 60000);
EOF
```

### G2. Add Metrics Endpoint

```bash
cd /home/hpz240/musicr/apps/api/src

# Add to index.ts after health check
cat >> /tmp/metrics-endpoint.txt << 'EOF'

// Metrics endpoint (dev only)
fastify.get('/api/metrics', async (request, reply) => {
  if (config.nodeEnv === 'production') {
    return reply.code(403).send({ error: 'Not available in production' });
  }
  return metrics.getSnapshot();
});
EOF

echo "⚠️  Add metrics endpoint from /tmp/metrics-endpoint.txt to index.ts"
```

---

## SECTION H: RAILWAY DEPLOYMENT

### H1. Create Railway Deploy Guide

```bash
cd /home/hpz240/musicr

cat > RAILWAY-DEPLOY.md << 'EOF'
# Railway Deployment Guide

## Prerequisites

1. Railway account: https://railway.app
2. Railway CLI installed: `npm i -g @railway/cli`
3. PostgreSQL plugin configured

## Setup

### 1. Create Railway Project

```bash
railway login
railway init
```

### 2. Add PostgreSQL Plugin

```bash
railway add postgresql
```

This creates `DATABASE_URL` automatically.

### 3. Set Environment Variables

```bash
railway variables set NODE_ENV=production
railway variables set COOKIE_SECRET=$(openssl rand -base64 32)
railway variables set OPENAI_API_KEY=sk-proj-***
railway variables set FRONTEND_ORIGIN=https://musicr.app
```

### 4. Deploy

```bash
# From repo root
railway up
```

Railway will:
- Detect monorepo (apps/api, apps/web)
- Build API service
- Build web frontend
- Set up domains

## Database Setup

### 1. Enable pgvector

```bash
railway connect postgresql

-- In psql:
CREATE EXTENSION IF NOT EXISTS vector;
\q
```

### 2. Run Migrations

```bash
cd apps/api
railway run pnpm prisma migrate deploy
```

### 3. Seed Songs

```bash
# Metadata only
railway run pnpm seed:simple

# With embeddings
railway run pnpm seed
```

### 4. Backfill Embeddings (if needed)

```bash
railway run pnpm tsx scripts/backfill-embeddings.ts
```

### 5. Sync Vector Column

```bash
railway run pnpm tsx scripts/sync-vector-column.ts
```

## Verification

```bash
# Check deployment
railway status

# View logs
railway logs

# Run smoke test
railway run pnpm tsx scripts/smoke-test.ts
```

## Scaling

### Vertical Scaling (RAM/CPU)

1. Go to Railway dashboard
2. Select API service
3. Settings → Resources
4. Increase memory (512MB → 1GB → 2GB)

### Horizontal Scaling

1. Use Railway's auto-scaling
2. Configure replicas in railway.toml:

```toml
[[services]]
name = "api"
replicas = 2
```

## Monitoring

### Application Logs

```bash
railway logs --tail
```

### Database Metrics

```bash
railway connect postgresql
\x
SELECT * FROM pg_stat_database WHERE datname = 'railway';
```

### Query Performance

```bash
SELECT query, calls, mean_exec_time, stddev_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Troubleshooting

### Migration Fails

```bash
# Reset migrations (DANGER: drops all data!)
railway run pnpm prisma migrate reset --force

# Or manually fix:
railway connect postgresql
-- Run SQL fixes
\q
```

### Out of Memory

1. Check vector index size:
```sql
SELECT pg_size_pretty(pg_relation_size('idx_songs_embedding_hnsw'));
```

2. Upgrade Railway plan or switch to IVFFlat index

### Slow Queries

```sql
-- Enable query stats
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Check slow queries
SELECT * FROM pg_stat_statements
WHERE mean_exec_time > 1000
ORDER BY mean_exec_time DESC;
```
EOF
```

---

## FINAL CHECKLIST

### Phase 1 Complete ✅
- [x] PostgreSQL database on Railway
- [x] pgvector extension enabled (v0.8.1)
- [x] Prisma migrations applied
- [x] 193 songs seeded with metadata
- [x] OpenAI embeddings backfilled (100%)

### Phase 2 Tasks

#### B) Production Blockers
- [ ] B1: Update DATABASE_URL to use SSL (`sslmode=require`)
- [ ] B2: Create native vector column migration
- [ ] B3: Apply vector migration to Railway DB
- [ ] B4: Update semantic search to use native vector
- [ ] B5: Verify HNSW index performance

#### C) Security
- [ ] C1: Re-enable seed endpoint protection
- [ ] C2: Make COOKIE_SECRET required in production
- [ ] C3: Fix hardcoded Admin Dashboard URL
- [ ] C4: Remove sensitive logging from env.ts
- [ ] C5: Add message length validation

#### D) Accessibility
- [ ] D1: Run Lighthouse scan
- [ ] D2: Add ARIA labels to inputs/buttons
- [ ] D3: Add keyboard navigation to song cards
- [ ] D4: Add screen reader utility classes
- [ ] D5: Add live regions for announcements
- [ ] D6: Implement skip link
- [ ] D7: Fix color contrast (WCAG AA)
- [ ] D8: Add focus-visible styles
- [ ] D9: Use semantic HTML tags
- [ ] D10: Add form labels

#### E) Catalog Expansion
- [ ] E1: Create catalog schema (JSONL format)
- [ ] E2: Create import-catalog.ts script
- [ ] E3: Document descriptor guidelines
- [ ] E4: Plan 5k → 100k → 1M scaling

#### F) Product Features
- [ ] F1: Show top 3 matches with confidence scores
- [ ] F2: Implement reroll button (backend + frontend)
- [ ] F3: Add room playlist persistence
- [ ] F4: Add pin/unpin functionality

#### G) Instrumentation
- [ ] G1: Create metrics.ts utility
- [ ] G2: Add metrics tracking to WebSocket handler
- [ ] G3: Add /api/metrics endpoint
- [ ] G4: Log metrics snapshot every 60s

#### H) Documentation
- [ ] H1: Create RAILWAY-DEPLOY.md
- [ ] H2: Update README with production setup
- [ ] H3: Document scaling strategies

---

## Quick Start Commands

```bash
# 1. Run smoke test
cd /home/hpz240/musicr/apps/api
DATABASE_URL="$DATABASE_URL" pnpm tsx scripts/smoke-test.ts

# 2. Apply vector migration
DATABASE_URL="$DATABASE_URL" pnpm prisma migrate deploy

# 3. Sync vector column
DATABASE_URL="$DATABASE_URL" pnpm tsx scripts/sync-vector-column.ts

# 4. Test semantic search
DATABASE_URL="$DATABASE_URL" OPENAI_API_KEY="$OPENAI_API_KEY" pnpm tsx scripts/test-similarity.ts

# 5. Run Lighthouse scan
pnpm dev & lighthouse http://localhost:5173 --output=html --output-path=./lighthouse-report

# 6. Import catalog
DATABASE_URL="$DATABASE_URL" OPENAI_API_KEY="$OPENAI_API_KEY" pnpm tsx scripts/import-catalog.ts data/catalog/songs.jsonl

# 7. Deploy to Railway
railway up
```

---

**Next:** Start with Section B (Production Blockers) for immediate impact on query performance.
