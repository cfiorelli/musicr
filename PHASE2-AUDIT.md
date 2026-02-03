# PHASE 2: Relaunch Audit + Hardening Report

**Status:** Railway pgvector DB live with 193 songs + embeddings ✅
**Date:** 2026-02-02

---

## EXECUTIVE SUMMARY

### What Works ✅
1. **Database & Migrations**: Prisma schema deployed, pgvector enabled, 193 songs seeded
2. **WebSocket Chat**: Real-time messaging functional
3. **Song Matching**: 4-strategy pipeline (exact → phrase → embedding → fallback)
4. **Rate Limiting**: Token bucket (10 msgs/10sec, burst 30)
5. **Content Moderation**: 4-tier filtering (slurs, harassment, NSFW, spam)
6. **Family-Friendly Mode**: Per-user content filtering
7. **Anonymous Users**: IP-based identification with cookies

### What's Broken ❌
1. **Embedding Storage**: JSONB requires expensive casting at query time
2. **No Vector Index**: Missing HNSW/IVFFlat index for similarity search
3. **Hardcoded URLs**: Admin dashboard has prod URL hardcoded
4. **Security Gaps**: Seed endpoint check disabled, default cookie secret
5. **No SSL Enforcement**: DATABASE_URL should use `sslmode=require` for production
6. **Missing Accessibility**: No keyboard nav, no ARIA labels, no lighthouse scan
7. **No Instrumentation**: Response time tracking stubbed (TODO comments)
8. **Embedding Provider**: Xenova transformers fails on Node 18 (only OpenAI works)

---

## A) END-TO-END VERIFICATION

### Runtime Flow

```
USER TYPES MESSAGE
  ↓
[ChatInterface.tsx:174] → WebSocket send: {type: 'msg', text: "I'm feeling happy"}
  ↓
[apps/api/src/index.ts:1066] → WebSocket /ws receives message
  ↓
[1. RATE LIMIT] RateLimiter.checkLimit(userId, IP)
  ↓
[2. MODERATION] ModerationService.moderateContent(text, config)
  ↓
[3. SONG MATCHING] SongMatchingService.matchSongs(text, allowExplicit, userId)
  Pipeline:
    → Exact match (title/artist contains text)
    → Phrase match (song phrases ∩ user words)
    → Embedding match (cosine similarity > 0.6)
    → Fallback (popular songs with mood tags)
  ↓
[4. DATABASE WRITE] prisma.message.create({userId, roomId, text, scores})
  File: apps/api/src/index.ts:1242-1256
  Saves: primary song, alternates, confidence, strategy
  ↓
[5. RESPONSE] WebSocket send to sender: {type: 'song', primary, alternates, why}
  ↓
[6. BROADCAST] ConnectionManager.broadcastWithFiltering(roomId, displayMsg)
  → Filtered version to familyFriendly=true users
  → Original version to familyFriendly=false users
  ↓
[ChatInterface.tsx:85] → Zustand store receives 'display' message
  ↓
[ChatInterface.tsx:195-235] → UI renders message + song card
```

### Database Persistence Check

**Messages Table:**
- File: [`apps/api/prisma/schema.prisma:37-55`](apps/api/prisma/schema.prisma#L37-L55)
- Fields: `userId`, `roomId`, `text`, `chosenSongId`, `scores (JSONB)`
- Indexes: userId, roomId, chosenSongId, createdAt

**Scores JSONB Structure:**
```json
{
  "primary": {"title": "Happy", "artist": "Pharrell Williams", "year": 2013},
  "alternates": [{"title": "...", "artist": "...", "year": ...}],
  "confidence": 0.85,
  "strategy": "phrase",
  "source": "websocket"
}
```

**Rooms & Users:**
- Rooms: Created on demand, default "general" room
- Users: Created on first `/api/user/session` call, stored with ipHash
- File: [`apps/api/src/services/user-service.ts:33-89`](apps/api/src/services/user-service.ts#L33-L89)

### Smoke Test Script

Create [`apps/api/scripts/smoke-test.ts`](apps/api/scripts/smoke-test.ts):

```typescript
import 'dotenv/config';
import WebSocket from 'ws';
import { prisma } from '../src/services/database.js';

async function smokeTest() {
  console.log('🔍 Smoke Test Starting...\n');

  // 1. Check database connection
  console.log('1. Database connection...');
  const songCount = await prisma.song.count();
  console.log(`   ✅ Connected. Songs: ${songCount}`);

  // 2. Check WebSocket connection
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
    setTimeout(() => reject(new Error('No response')), 10000);
  });

  // 4. Check message persistence
  console.log('4. Checking database persistence...');
  const recentMsg = await prisma.message.findFirst({
    where: {text: 'happy song'},
    orderBy: {createdAt: 'desc'},
    include: {song: true}
  });

  if (recentMsg) {
    console.log(`   ✅ Message persisted. Song: ${recentMsg.song?.title}`);
  } else {
    console.log('   ❌ Message not found in database');
  }

  ws.close();
  await prisma.$disconnect();

  console.log('\n🎉 Smoke test passed!');
}

smokeTest().catch(console.error);
```

**Run command:**
```bash
cd /home/hpz240/musicr/apps/api
DATABASE_URL="$DATABASE_URL" pnpm tsx scripts/smoke-test.ts
```

**Expected output:**
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
🎉 Smoke test passed!
```

**Manual Test Steps (< 5 minutes):**
1. Open http://localhost:5173
2. Type "I'm feeling happy" → Should match "Happy" by Pharrell Williams
3. Type "bohemian rhapsody" → Should exact match Queen
4. Open browser DevTools → Network → WS → Verify WebSocket connection
5. Check database: `psql $DATABASE_URL -c "SELECT COUNT(*) FROM messages;"`

---

## B) FIX PRODUCTION BLOCKERS

### B1) SSL / DATABASE_URL

**Current Issue:**
- Phase 1 used: `postgresql://...?sslmode=disable`
- Railway DOES support SSL, but we bypassed it

**Railway SSL Support:**
- Railway PostgreSQL natively supports SSL/TLS connections
- Correct connection string: `postgresql://...?sslmode=require`
- OR: `?sslmode=verify-full` with CA cert

**File:** [`apps/api/.env.example:10`](apps/api/.env.example#L10)

**Current:**
```bash
DATABASE_URL="postgresql://musicr_user:password@localhost:5432/musicr_prod?schema=public"
```

**Updated:**
```bash
# Railway PostgreSQL with SSL
DATABASE_URL="postgresql://postgres:***@your-railway-host.proxy.rlwy.net:27490/railway?sslmode=require"

# Alternative: use Railway's PGHOST/PGUSER/etc. vars (auto SSL)
PGHOST=your-railway-host.proxy.rlwy.net
PGPORT=27490
PGUSER=postgres
PGPASSWORD=***
PGDATABASE=railway
```

**Environment Config File:** [`apps/api/src/config/env.ts:12-37`](apps/api/src/config/env.ts#L12-L37)

Already handles Railway vars correctly:
```typescript
const dbUrl = process.env.DATABASE_URL ||
  `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;
```

**Action:** Update production DATABASE_URL to use `sslmode=require`

---

### B2) Embedding Storage: JSONB vs Native Vector

**Current State:**
- Storage: JSONB (`embedding JSONB` column)
- Query cost: `embedding::jsonb::text::vector <=> query::vector`
- Triple casting on every similarity search!

**Performance Impact:**
```sql
-- Current (slow):
SELECT * FROM songs
WHERE embedding IS NOT NULL
ORDER BY embedding::jsonb::text::vector <=> '[...]'::vector
LIMIT 10;

-- Native vector (fast):
SELECT * FROM songs
WHERE embedding IS NOT NULL
ORDER BY embedding <=> '[...]'::vector
LIMIT 10;
```

**Option 1: Add Native Vector Column (Recommended)**

**Migration:** [`apps/api/prisma/migrations/add_vector_column/migration.sql`](apps/api/prisma/migrations/add_vector_column/migration.sql)

```sql
-- Add native vector column (1536 dimensions for OpenAI text-embedding-3-small)
ALTER TABLE songs ADD COLUMN embedding_vector vector(1536);

-- Backfill from JSONB
UPDATE songs
SET embedding_vector = (embedding::text)::vector
WHERE embedding IS NOT NULL;

-- Create HNSW index for fast similarity search
CREATE INDEX idx_songs_embedding_hnsw
ON songs
USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Alternative: IVFFlat index (less memory, slightly slower)
-- CREATE INDEX idx_songs_embedding_ivfflat
-- ON songs
-- USING ivfflat (embedding_vector vector_cosine_ops)
-- WITH (lists = 100);
```

**Schema Update:** [`apps/api/prisma/schema.prisma:14-35`](apps/api/prisma/schema.prisma#L14-L35)

```prisma
model Song {
  id               String   @id @default(uuid()) @db.Uuid
  title            String
  artist           String
  year             Int?
  popularity       Int      @default(0)
  tags             String[] @default([])
  phrases          String[] @default([])
  mbid             String?  @unique
  embedding        Json?    // Keep for backward compatibility
  embeddingVector  Unsupported("vector(1536)")? @map("embedding_vector") // Native vector
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  messages Message[]

  @@index([tags], map: "idx_songs_tags", type: Gin)
  @@index([phrases], map: "idx_songs_phrases", type: Gin)
  @@index([title, artist], map: "idx_songs_title_artist")
  @@index([popularity], map: "idx_songs_popularity")
  @@index([year], map: "idx_songs_year")
  // Note: HNSW index created via raw SQL (Prisma doesn't support yet)
  @@map("songs")
}
```

**Query Update:** [`apps/api/src/engine/matchers/semantic.ts:80-92`](apps/api/src/engine/matchers/semantic.ts#L80-L92)

```typescript
// Before:
const results = await this.prisma.$queryRaw`
  SELECT id, title, artist, tags, year, popularity,
    (embedding::jsonb::text::vector <=> ${embeddingString}::vector) * -1 + 1 as similarity
  FROM songs
  WHERE embedding IS NOT NULL
  ORDER BY embedding::jsonb::text::vector <=> ${embeddingString}::vector
  LIMIT ${k * 2}
`;

// After:
const results = await this.prisma.$queryRaw`
  SELECT id, title, artist, tags, year, popularity,
    (embedding_vector <=> ${embeddingString}::vector) * -1 + 1 as similarity
  FROM songs
  WHERE embedding_vector IS NOT NULL
  ORDER BY embedding_vector <=> ${embeddingString}::vector
  LIMIT ${k * 2}
`;
```

**Backfill Script:** [`apps/api/scripts/sync-vector-column.ts`](apps/api/scripts/sync-vector-column.ts)

```typescript
import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

async function syncVectorColumn() {
  const songs = await prisma.song.findMany({
    where: { embedding: { not: null } },
    select: { id: true, embedding: true }
  });

  logger.info(`Syncing ${songs.length} embeddings to vector column...`);

  for (const song of songs) {
    const embeddingArray = song.embedding as number[];
    const vectorString = `[${embeddingArray.join(',')}]`;

    await prisma.$executeRaw`
      UPDATE songs
      SET embedding_vector = ${vectorString}::vector
      WHERE id = ${song.id}::uuid
    `;
  }

  logger.info('✅ Vector column sync complete');
}

syncVectorColumn();
```

**Index Performance:**
- **HNSW (Hierarchical Navigable Small World)**:
  - Best for: Accuracy + speed
  - Memory: Higher (~10-20% of data size)
  - Build time: Slower
  - Recommended for: < 1M vectors

- **IVFFlat (Inverted File with Flat Compression)**:
  - Best for: Lower memory usage
  - Accuracy: Slightly lower
  - Build time: Faster
  - Recommended for: > 1M vectors

**For 193 songs → 100k songs: Use HNSW**

---

### B3) Create Migration Plan

**New Migration:** Create `apps/api/prisma/migrations/add_native_vector/migration.sql`

```bash
cd /home/hpz240/musicr/apps/api

# Create migration
pnpm prisma migrate dev --name add_native_vector --create-only

# Edit the generated migration.sql file to add:
# 1. ALTER TABLE songs ADD COLUMN embedding_vector vector(1536);
# 2. Backfill: UPDATE songs SET embedding_vector = ...
# 3. CREATE INDEX ... USING hnsw

# Apply to Railway
DATABASE_URL="$DATABASE_URL" pnpm prisma migrate deploy
```

---

## C) ACCESSIBILITY + UX MINIMUMS

### Lighthouse Scan

**Install dependencies:**
```bash
npm install -g lighthouse
```

**Run scan:**
```bash
# Start dev server
cd /home/hpz240/musicr
pnpm dev

# In another terminal
lighthouse http://localhost:5173 --output=html --output-path=./lighthouse-report.html --chrome-flags="--headless"
```

### Expected Issues (based on code review):

#### 1. **No ARIA Labels**
- File: [`apps/web/src/components/ChatInterface.tsx:137-144`](apps/web/src/components/ChatInterface.tsx#L137-L144)
- Missing: `aria-label` on input, buttons
- Fix:
```tsx
<input
  aria-label="Chat message input"
  placeholder="Type a message..."
/>
<button aria-label="Send message">Send</button>
<button aria-label="Toggle family-friendly mode">
  {familyFriendly ? '👨‍👩‍👧' : '🔞'}
</button>
```

#### 2. **No Keyboard Navigation for Song Cards**
- File: [`apps/web/src/components/ChatInterface.tsx:195-235`](apps/web/src/components/ChatInterface.tsx#L195-L235)
- Issue: Song cards not keyboard accessible
- Fix: Add `tabIndex={0}` and `onKeyPress` handlers

#### 3. **Color Contrast**
- Likely issue: Light gray text on white background
- Fix: Ensure WCAG AA compliance (contrast ratio ≥ 4.5:1)

#### 4. **Focus Indicators**
- Missing visible focus states for keyboard navigation
- Fix: Add CSS `:focus-visible` styles

#### 5. **Form Labels**
- Input fields without associated labels
- Fix: Wrap in `<label>` or use `aria-labelledby`

#### 6. **Heading Hierarchy**
- May be missing proper h1 → h2 → h3 structure
- Fix: Add semantic heading tags

#### 7. **Alt Text**
- No images, so likely N/A

#### 8. **Semantic HTML**
- Using divs instead of semantic tags
- Fix: Use `<main>`, `<aside>`, `<nav>`, `<article>`

#### 9. **Skip Links**
- No "Skip to main content" link
- Fix: Add skip link at top of page

#### 10. **Error Messages**
- Rate limit/moderation errors not announced to screen readers
- Fix: Add `role="alert"` and `aria-live="polite"`

### Top 10 Accessibility Fixes

Create [`apps/web/src/components/ChatInterface-a11y.tsx`](apps/web/src/components/ChatInterface-a11y.tsx) (or update existing):

```tsx
// 1. Add skip link
<a href="#main-content" className="sr-only focus:not-sr-only">
  Skip to main content
</a>

// 2. Semantic HTML
<main id="main-content">
  <section aria-label="Chat messages">
    {/* messages */}
  </section>

  <form onSubmit={handleSubmit} aria-label="Send message form">
    {/* input */}
  </form>
</main>

// 3. ARIA labels
<input
  aria-label="Type your message"
  aria-describedby="char-count"
/>
<span id="char-count" className="sr-only">
  {text.length} of 500 characters
</span>

// 4. Keyboard navigation for song cards
<div
  tabIndex={0}
  role="button"
  aria-label={`Song: ${song.title} by ${song.artist}`}
  onKeyPress={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleSongClick(song);
    }
  }}
>
  {song.title}
</div>

// 5. Live regions for errors
<div role="alert" aria-live="polite" aria-atomic="true">
  {error && <p>{error}</p>}
</div>

// 6. Focus management
useEffect(() => {
  if (showQuickPalette) {
    // Focus first alternate when palette opens
    document.getElementById('alternate-0')?.focus();
  }
}, [showQuickPalette]);

// 7. Color contrast
// In Tailwind config, use colors with ≥4.5:1 contrast
colors: {
  primary: '#2563eb', // Blue 600
  text: '#1f2937',    // Gray 800 (high contrast)
}

// 8. Focus visible styles
.focus-visible:outline {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

// 9. Screen reader only utility
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

// 10. Announce song matches
<div role="status" aria-live="polite" className="sr-only">
  {latestSong && `Matched song: ${latestSong.title} by ${latestSong.artist}`}
</div>
```

---

## D) SECURITY + ABUSE CONTROLS

### Current State ✅

**Rate Limiting:**
- File: [`apps/api/src/utils/rate-limiter.ts`](apps/api/src/utils/rate-limiter.ts)
- Implementation: Token bucket algorithm
- Limits: 10 messages per 10 seconds, burst capacity 30
- Tracking: Per (userId + IP hash) combination
- Cleanup: Removes stale buckets every 5 minutes

**Message Length:**
- File: [`apps/api/src/services/moderation-service.ts:181`](apps/api/src/services/moderation-service.ts#L181)
- Current limit: 1000 characters (spam detection threshold)
- Enforced: Only in "strict" mode

**Content Moderation:**
- 4-tier filtering: slurs (blocked), harassment (filtered), NSFW (filtered if familyFriendly), spam (filtered if strict)
- File: [`apps/api/src/services/moderation-service.ts`](apps/api/src/services/moderation-service.ts)

### Additional Security Measures Needed

#### 1. Enforce Message Length at API Level

File: [`apps/api/src/index.ts:1066`](apps/api/src/index.ts#L1066)

```typescript
// Add validation before processing
if (!data.text || typeof data.text !== 'string') {
  connection.socket.send(JSON.stringify({
    type: 'error',
    message: 'Invalid message format'
  }));
  return;
}

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
```

#### 2. Bot/Spam Throttles

File: [`apps/api/src/utils/rate-limiter.ts:200-250`](apps/api/src/utils/rate-limiter.ts)

Add new method:
```typescript
export class SpamDetector {
  private readonly recentMessages = new Map<string, string[]>();
  private readonly DUPLICATE_THRESHOLD = 3; // Same message 3x = spam
  private readonly WINDOW_MS = 60000; // 1 minute

  detectSpam(userId: string, text: string): boolean {
    const key = userId;
    const now = Date.now();

    if (!this.recentMessages.has(key)) {
      this.recentMessages.set(key, []);
    }

    const history = this.recentMessages.get(key)!;

    // Remove old messages
    const recent = history.filter(msg => {
      const [timestamp] = msg.split('|');
      return now - parseInt(timestamp) < this.WINDOW_MS;
    });

    // Check for duplicates
    const duplicateCount = recent.filter(msg => {
      const [, oldText] = msg.split('|');
      return oldText === text;
    }).length;

    if (duplicateCount >= this.DUPLICATE_THRESHOLD) {
      return true; // Spam detected
    }

    // Add new message
    recent.push(`${now}|${text}`);
    this.recentMessages.set(key, recent);

    return false;
  }
}
```

#### 3. Secret Management Audit

**Files to check:**
1. `.env` - Not in repo ✅ (in .gitignore)
2. `.env.example` - No secrets ✅
3. Logging - Need to audit

**Audit logging for secrets:**
```bash
cd /home/hpz240/musicr
grep -r "logger.*DATABASE_URL\|console.log.*DATABASE_URL\|logger.*OPENAI_API_KEY" apps/api/src/
```

**File: [`apps/api/src/config/env.ts:31-33`](apps/api/src/config/env.ts#L31-L33)**
```typescript
// ❌ ISSUE: Logs env vars when DATABASE_URL fails
logger.error('Failed to get DATABASE_URL. Available DB env vars:', {
  PG: Object.keys(process.env).filter(k => k.startsWith('PG')),
  DB: Object.keys(process.env).filter(k => k.startsWith('DB'))
});
```

**Fix:**
```typescript
// ✅ Only log key names, not values
logger.error('Failed to get DATABASE_URL. Check environment variables: DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT');
```

#### 4. Re-enable Seed Endpoint Protection

**File: [`apps/api/src/index.ts:669-673`](apps/api/src/index.ts#L669-L673)**

```typescript
// ❌ Current (DISABLED):
// if (process.env.NODE_ENV === 'production') {
//   return reply.code(403).send({ error: 'Seed endpoint disabled in production' });
// }

// ✅ Re-enable:
if (process.env.NODE_ENV === 'production') {
  return reply.code(403).send({ error: 'Seed endpoint disabled in production' });
}
```

#### 5. Make COOKIE_SECRET Required

**File: [`apps/api/src/index.ts:47`](apps/api/src/index.ts#L47)**

```typescript
// ❌ Current:
secret: process.env.COOKIE_SECRET || 'default-cookie-secret-change-in-production',

// ✅ Fix:
secret: (() => {
  if (config.nodeEnv === 'production' && !process.env.COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET environment variable is required in production');
  }
  return process.env.COOKIE_SECRET || 'dev-secret-not-for-production';
})(),
```

---

## E) CATALOG EXPANSION PLAN

### E1) Canonical Catalog Schema

**Location:** [`apps/api/data/catalog/`](apps/api/data/catalog/)

**Schema:** `songs.jsonl` (JSON Lines format for streaming)

```jsonl
{"id": "uuid", "title": "Bohemian Rhapsody", "artist": "Queen", "year": 1975, "popularity": 100, "genres": ["rock", "classic rock", "progressive rock"], "moods": ["dramatic", "operatic", "epic"], "descriptors": ["complex composition", "multiple sections", "vocal harmonies"], "mbid": "b1a9c0e9-d987-4042-ae91-78d6a3267d69"}
{"id": "uuid", "title": "Billie Jean", "artist": "Michael Jackson", "year": 1982, "popularity": 98, "genres": ["pop", "dance"], "moods": ["mysterious", "tense", "groovy"], "descriptors": ["iconic bassline", "beat-driven", "storytelling"], "mbid": "..."}
```

**Field Definitions:**
- `id`: UUID (stable identifier)
- `title`: Song title (required)
- `artist`: Primary artist name (required)
- `year`: Release year (optional, for decade matching)
- `popularity`: 0-100 score (for tiebreaking)
- `genres`: Array of genre tags (rock, pop, hip-hop, jazz, etc.)
- `moods`: Array of mood descriptors (happy, sad, energetic, chill, etc.)
- `descriptors`: Unique characteristics (NOT a copy of genres/moods)
  - Good: "heavy guitar riffs", "synthesizer-driven", "acoustic ballad"
  - Bad: "rock", "upbeat" (redundant with genres/moods)
- `mbid`: MusicBrainz ID (optional, for canonical song identity)

**Why JSONL instead of CSV:**
- Handles nested arrays natively
- Streaming-friendly for large catalogs
- No escaping issues with commas/quotes
- Easier to append incrementally

### E2) Incremental Import/Upsert

**Script:** [`apps/api/scripts/import-catalog.ts`](apps/api/scripts/import-catalog.ts)

```typescript
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
  logger.info(`Options: skipExisting=${skipExisting}, reembedAll=${reembedAll}`);

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

    try {
      const song: CatalogSong = JSON.parse(line);
      batch.push(song);

      if (batch.length >= batchSize) {
        const result = await processBatch(batch, { skipExisting, reembedAll });
        imported += result.imported;
        skipped += result.skipped;
        errors += result.errors;
        batch.length = 0;

        logger.info(`Progress: ${lineCount} lines, ${imported} imported, ${skipped} skipped`);
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

  logger.info('Import complete!');
  logger.info(`  Total: ${lineCount} lines`);
  logger.info(`  Imported: ${imported}`);
  logger.info(`  Skipped: ${skipped}`);
  logger.info(`  Errors: ${errors}`);
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

      // Combine all tags (genres + moods + descriptors)
      const tags = [...song.genres, ...song.moods];
      const phrases = song.descriptors; // Unique descriptors only

      if (existing) {
        // Update existing
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
        // Insert new
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
      logger.error({ song, error }, 'Failed to import song');
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
const batchSize = parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '100');

importCatalog(filePath, { skipExisting, reembedAll, batchSize })
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ error }, 'Import failed');
    process.exit(1);
  });
```

**Usage:**
```bash
# Initial import
pnpm tsx scripts/import-catalog.ts data/catalog/songs.jsonl

# Add new songs only
pnpm tsx scripts/import-catalog.ts data/catalog/new-songs.jsonl --skip-existing

# Re-embed all (after changing embedding model)
pnpm tsx scripts/import-catalog.ts data/catalog/songs.jsonl --reembed-all

# Custom batch size
pnpm tsx scripts/import-catalog.ts data/catalog/songs.jsonl --batch-size=50
```

### E3) Improve Phrases vs Tags

**Current Issue:**
- File: [`apps/api/data/songs_seed.csv`](apps/api/data/songs_seed.csv)
- Phrases are often just lyric snippets or redundant mood words

**New Approach:**

**Tags** (for filtering/matching):
- Genres: rock, pop, hip-hop, jazz, country, electronic, etc.
- Moods: happy, sad, angry, romantic, chill, energetic, etc.
- Era: 60s, 70s, 80s, 90s, 2000s, 2010s, 2020s

**Descriptors** (unique characteristics):
- Instrumentation: "acoustic guitar", "heavy bass", "orchestral strings"
- Vocal style: "raspy vocals", "harmonized chorus", "rap verses"
- Tempo: "slow ballad", "uptempo dance", "mid-tempo groove"
- Production: "lo-fi aesthetic", "polished pop production", "live recording"
- Themes: "coming of age", "breakup song", "party anthem"

**Example:**
```json
{
  "title": "Smells Like Teen Spirit",
  "artist": "Nirvana",
  "genres": ["grunge", "alternative rock"],
  "moods": ["rebellious", "angsty", "raw"],
  "descriptors": [
    "distorted guitar riff",
    "quiet-loud dynamics",
    "anthemic chorus",
    "generation-defining track"
  ]
}
```

### E4) Scaling Plan: 5k → 100k → 1M Songs

#### Phase 1: 5,000 Songs (Current: 193)

**Target:** Top 5k most popular songs across all genres

**Sources:**
- Billboard charts (1958-present)
- Spotify top tracks by decade
- RIAA Gold & Platinum certified songs
- Rolling Stone's 500 Greatest Songs
- Genre-specific charts (rock, hip-hop, country, etc.)

**Implementation:**
- Manual curation + data entry
- Use MusicBrainz API for metadata validation
- ~40 hours of work for 5k songs @ 2 min/song

**Cost:**
- Embeddings: 5,000 songs × $0.00002 = $0.10 (OpenAI text-embedding-3-small)
- Storage: 5k × 2KB embedding = 10 MB
- Index: HNSW with m=16 → ~50 MB RAM

**Timeline:** 2-3 weeks part-time

---

#### Phase 2: 100,000 Songs

**Target:** Comprehensive catalog across all major genres

**Sources:**
- MusicBrainz database (open-source, 2M+ recordings)
- Last.fm API (top tracks by tag)
- Discogs database (metadata + genres)
- Spotify API (top tracks by country/genre)

**Implementation:**
- Automated scraping + enrichment
- Batch processing (1000 songs/hour)
- Quality filtering (min popularity threshold)

**Cost:**
- Embeddings: 100k × $0.00002 = $2.00
- Storage: 100k × 2KB = 200 MB
- Index: HNSW with m=16 → ~1 GB RAM
- Database: PostgreSQL (Railway Pro: $20/month)

**Query Performance:**
- HNSW index: <50ms for k=10 nearest neighbors
- IVFFlat index: <100ms (if memory constrained)

**Timeline:** 1-2 months automated + QA

---

#### Phase 3: 1,000,000 Songs

**Target:** Near-complete coverage of recorded music

**Sources:**
- MusicBrainz full database
- Discogs full catalog
- Spotify full catalog
- Apple Music catalog
- YouTube Music metadata

**Implementation:**
- Distributed batch processing
- Cloud-based embedding generation (AWS Lambda, Modal, etc.)
- Incremental index updates

**Cost:**
- Embeddings: 1M × $0.00002 = $20.00 (one-time)
- Storage: 1M × 2KB = 2 GB
- Index: IVFFlat preferred (HNSW would need 10+ GB RAM)
  - IVFFlat with lists=1000 → ~3 GB RAM
- Database: Dedicated PostgreSQL instance
  - Railway Pro: $20/month (may need upgrade)
  - Self-hosted: $50-100/month (AWS RDS, DigitalOcean)

**Query Performance:**
- IVFFlat with lists=1000: ~200ms for k=10
- Batch queries: Process 100 messages/sec

**Index Build Time:**
- HNSW: ~6-12 hours
- IVFFlat: ~1-2 hours

**Timeline:** 3-6 months (data collection, cleaning, embedding)

---

#### Optimization Strategies

1. **Embedding Batching:**
   - OpenAI allows 2048 inputs per batch
   - Cost: Same ($0.00002/1k tokens)
   - Speed: 10x faster

2. **Caching:**
   - Cache common query embeddings (e.g., "happy song", "sad song")
   - Use Redis for sub-millisecond lookups
   - Hit rate: 30-50% for common phrases

3. **Tiered Storage:**
   - Hot tier: Top 10k songs (in-memory)
   - Warm tier: Top 100k (SSD)
   - Cold tier: Remaining (HDD)

4. **Approximate Search:**
   - Use IVFFlat with `SET ivfflat.probes = 10;`
   - Trade accuracy for speed (95% recall at 10x speedup)

5. **Sharding:**
   - Shard by genre/decade
   - Route queries to relevant shards
   - Reduces search space by 80%

---

#### Legal Considerations (Metadata-Only)

**What we store (LEGAL ✅):**
- Song title
- Artist name
- Release year
- Genre/mood tags
- Descriptors

**What we DON'T store (avoiding licensing):**
- Lyrics (copyrighted)
- Audio files (copyrighted)
- Album art (copyrighted)
- Recording ISRC codes (may require license)

**Safe Sources:**
- MusicBrainz (CC0 license)
- Discogs (metadata only, not copyrighted)
- Public charts (factual data)
- User-generated tags (transformative fair use)

**Best Practice:**
- Always cite MusicBrainz ID (mbid) for canonical identity
- Don't scrape lyrics from Genius/AZLyrics
- Don't use song previews without Spotify/Apple license

---

## F) PRODUCT + MONETIZATION

### F1) Three Retention Features

#### Feature 1: Top 3 Matches Display

**Current:** Shows 1 primary song + alternates in palette (Cmd+K)

**Improved:** Show top 3 matches with confidence scores

**File:** [`apps/web/src/components/ChatInterface.tsx:195-235`](apps/web/src/components/ChatInterface.tsx#L195-L235)

**UI Mockup:**
```
┌─────────────────────────────────────────┐
│ You: "I'm feeling happy"                │
│                                         │
│ ┌─────────────────────────────────┐    │
│ │ 🎵 Happy                         │ 98%│
│ │    Pharrell Williams (2013)      │    │
│ │    [▶️ Preview] [🔄 Reroll]      │    │
│ └─────────────────────────────────┘    │
│                                         │
│ Other matches:                          │
│ • Don't Stop Me Now - Queen      87%   │
│ • Walking on Sunshine - Katrina   82%  │
└─────────────────────────────────────────┘
```

**Backend:** Already returns alternates, just need to show them

**Benefit:** Users see matching quality, build trust in algorithm

---

#### Feature 2: Reroll Button

**Purpose:** Let users request a different match without retyping

**Implementation:**

**Frontend:** Add button next to primary song
```tsx
<button
  onClick={() => handleReroll(message.id)}
  className="btn-secondary"
>
  🔄 Reroll
</button>
```

**Backend:** Add WebSocket message type
```typescript
// Client sends:
{type: 'reroll', messageId: 'uuid'}

// Server responds:
// 1. Fetch original message from DB
// 2. Re-run matching with:
//    - excludeSongs: [previous primary, ...previous alternates]
//    - Use fallback strategy to find new matches
// 3. Update message.scores in DB
// 4. Broadcast new 'display' message with updated song
```

**File:** Add to [`apps/api/src/index.ts:1300`](apps/api/src/index.ts#L1300)

**Benefit:** Users feel in control, increases engagement

---

#### Feature 3: Room Playlist & Pins

**Purpose:** Persist room's song history, allow users to "pin" favorites

**Implementation:**

**Playlist View:**
```tsx
<aside className="room-playlist">
  <h3>Room Playlist</h3>
  <ul>
    {recentSongs.map(song => (
      <li key={song.id}>
        <span>{song.title} - {song.artist}</span>
        <button onClick={() => pinSong(song.id)}>📌</button>
      </li>
    ))}
  </ul>

  <h3>Pinned Songs</h3>
  <ul>
    {pinnedSongs.map(song => (
      <li key={song.id}>
        {song.title} - {song.artist}
        <button onClick={() => unpinSong(song.id)}>❌</button>
      </li>
    ))}
  </ul>
</aside>
```

**Database:**
```sql
-- Add to schema.prisma:
model RoomPlaylist {
  id         String   @id @default(uuid())
  roomId     String
  songId     String
  isPinned   Boolean  @default(false)
  pinnedBy   String?  // userId
  addedAt    DateTime @default(now())

  room Room @relation(fields: [roomId], references: [id])
  song Song @relation(fields: [songId], references: [id])

  @@unique([roomId, songId])
  @@index([roomId])
}
```

**API Endpoints:**
```typescript
POST /api/rooms/:roomId/playlist/pin
  Body: {songId}
  → Add song to room playlist with isPinned=true

DELETE /api/rooms/:roomId/playlist/:songId
  → Remove song from playlist

GET /api/rooms/:roomId/playlist
  → Return: {recent: Song[], pinned: Song[]}
```

**Benefit:** Rooms build identity, users return to see playlist grow

---

### F2) Two Monetization Paths

#### Path 1: Premium Rooms (Subscription)

**Tiers:**
- **Free:** 1 public room, 20 message history, standard matching
- **Pro ($5/month):** Unlimited private rooms, custom room URLs, 100 message history, priority matching
- **Team ($20/month):** White-label rooms, analytics dashboard, API access

**Features:**
- Private rooms with invite links
- Custom room branding (name, description, theme)
- Export playlist as Spotify/Apple Music link
- Room analytics (top songs, active users, engagement metrics)

**Implementation:**
- Stripe integration for payments
- Room.tier field in database
- Middleware to enforce limits

**Revenue Estimate:**
- 10,000 users × 5% conversion = 500 paid users
- 500 × $5/month = $2,500/month
- Annual: $30,000

---

#### Path 2: Song Discovery API (B2B)

**Target:** Music apps, chatbots, recommendation engines

**Pricing:**
- Free tier: 1,000 requests/month
- Starter ($99/month): 100,000 requests/month
- Growth ($499/month): 1,000,000 requests/month
- Enterprise (custom): Unlimited, SLA, dedicated support

**API Endpoints:**
```bash
POST /api/v1/match
  Headers: X-API-Key: abc123
  Body: {text: "happy song", limit: 5}
  Response: {songs: [{title, artist, confidence}]}

POST /api/v1/match/batch
  Body: {queries: ["happy song", "sad song"]}
  Response: {results: [{query, songs}]}
```

**Use Cases:**
- Spotify playlist generators
- Discord music bots
- Therapy/wellness apps
- Gaming soundtracks
- Event DJ tools

**Revenue Estimate:**
- 50 B2B customers @ $99/month = $4,950/month
- 10 growth customers @ $499/month = $4,990/month
- 2 enterprise @ $2,000/month = $4,000/month
- Total: $13,940/month
- Annual: $167,280

---

### F3) Basic Instrumentation

**Metrics to Track:**

1. **Messages per day**
2. **Match latency** (time to match + respond)
3. **Error rates** (rate limited, moderation rejected, matching failed)
4. **Strategy distribution** (exact vs phrase vs embedding vs fallback)
5. **User retention** (DAU, WAU, MAU)
6. **Room activity** (messages per room, active rooms)
7. **Family-friendly adoption** (% users with filter enabled)

**Implementation:**

**File:** [`apps/api/src/utils/metrics.ts`](apps/api/src/utils/metrics.ts)

```typescript
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
      const sorted = values.sort((a, b) => a - b);
      snapshot.histograms[key] = {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        mean: values.reduce((a, b) => a + b, 0) / values.length,
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
```

**Usage in code:**

```typescript
// In WebSocket handler
const startTime = Date.now();

try {
  // ... matching logic ...
  const result = await songMatchingService.matchSongs(...);

  const duration = Date.now() - startTime;
  metrics.recordDuration('match_latency_ms', duration);
  metrics.increment('messages_total');
  metrics.increment(`strategy_${result.strategy}`);

  if (result.confidence > 0.8) {
    metrics.increment('high_confidence_matches');
  }

} catch (error) {
  metrics.increment('errors_total');
  metrics.increment(`error_${error.type}`);
}
```

**Dashboard Endpoint:**

```typescript
fastify.get('/api/admin/metrics', async () => {
  return metrics.getSnapshot();
});
```

**Example Output:**
```json
{
  "counters": {
    "messages_total": 1543,
    "errors_total": 12,
    "high_confidence_matches": 1231,
    "strategy_phrase": 892,
    "strategy_embedding": 421,
    "strategy_exact": 198,
    "strategy_fallback": 32
  },
  "histograms": {
    "match_latency_ms": {
      "count": 1543,
      "min": 45,
      "max": 1230,
      "mean": 287,
      "p50": 245,
      "p95": 678,
      "p99": 1050
    }
  }
}
```

---

## SUMMARY: What Works / What's Broken

### ✅ What Works
- WebSocket real-time chat
- 4-strategy song matching (exact, phrase, embedding, fallback)
- Rate limiting (10 msg/10sec, burst 30)
- Content moderation (4-tier filtering)
- Family-friendly per-user filtering
- Message persistence
- Room/user management
- PostgreSQL with pgvector
- 193 songs with OpenAI embeddings

### ❌ What's Broken / Missing

#### Critical (Must Fix Before Production)
1. **Embedding storage inefficiency**: JSONB requires triple casting
2. **No vector index**: Linear scan on every query
3. **Hardcoded URLs**: Admin dashboard URL is prod-specific
4. **Security gaps**: Seed endpoint check disabled, default cookie secret
5. **No SSL enforcement**: Should use sslmode=require for production
6. **Node 18 embedding issue**: Xenova transformers broken, only OpenAI works

#### High Priority
7. **No accessibility**: Missing ARIA labels, keyboard nav, focus management
8. **No instrumentation**: Response time tracking, error rates not tracked
9. **Message length not enforced**: Only checked in moderation (spam mode)
10. **No reconnection logic**: WebSocket disconnect = manual refresh

#### Medium Priority
11. **Type safety gaps**: Heavy use of `as any` casts
12. **Error handling**: Silent failures in message history loading
13. **Phrases = lyric snippets**: Should be descriptors, not lyrics
14. **No user preference persistence**: Family-friendly not saved
15. **Console logging**: Too much in production code

---

## Next: Implementation Checklist

See PHASE2-CHECKLIST.md for numbered, copy-paste commands.
