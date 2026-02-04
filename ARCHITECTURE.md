# Musicr Architecture

System design and technical architecture for the Musicr song recommendation chat application.

## System Overview

Musicr is a real-time anonymous chat application that converts user messages into song recommendations using semantic similarity search powered by embeddings and vector databases.

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   React Web     │  HTTP/  │  Fastify API    │  SQL/   │  PostgreSQL +   │
│   Frontend      │◄────────┤  + WebSocket    │◄────────┤   pgvector      │
│  (Port 5173)    │   WS    │  (Port 4000)    │  Vector │  (Port 5432)    │
└─────────────────┘         └─────────────────┘   KNN   └─────────────────┘
        │                            │                            │
   React Router               Song Matching              HNSW Index
   Zustand State              Embedding Gen.             384-dim vectors
   WebSocket Client           Content Filter             Cosine similarity
```

## Core Components

### 1. Frontend (React + Vite)

**Entry Point:** [apps/web/src/main.tsx](apps/web/src/main.tsx)

**Key Files:**
- `App.tsx` - App shell, routing, header
- `components/ChatInterface.tsx` - Main chat UI with message display
- `components/RoomUserList.tsx` - Online users sidebar
- `stores/chatStore.ts` - Zustand state (messages, WebSocket, users)

**State Management:**
- **Zustand store** handles all client state
- WebSocket connection lifecycle
- Message history
- User session (anonymous handle)
- Room membership

**WebSocket Events (Client → Server):**
```typescript
{ type: 'msg', content: string }
{ type: 'reaction_add', messageId: string, emoji: string }
{ type: 'reaction_remove', messageId: string, emoji: string }
```

**WebSocket Events (Server → Client):**
```typescript
{ type: 'song_result', songId, title, artist, similarity, reasoning, ... }
{ type: 'user_joined', userId, anonHandle, joinedAt }
{ type: 'user_left', userId }
{ type: 'reaction_added', messageId, emoji, userId, anonHandle }
{ type: 'reaction_removed', messageId, emoji, userId }
```

### 2. Backend (Fastify + Prisma)

**Entry Point:** [apps/api/src/index.ts](apps/api/src/index.ts)

**Architecture Layers:**

```
HTTP/WebSocket Layer (Fastify)
        ↓
Service Layer (Business Logic)
        ↓
Engine Layer (Song Matching)
        ↓
Data Layer (Prisma ORM)
        ↓
PostgreSQL + pgvector
```

**Key Services:**

- **UserService** - Anonymous user creation, handle generation
- **RoomService** - Chat room management
- **ConnectionManager** - WebSocket connection tracking and broadcasting
- **SongMatchingService** - Coordinates matching strategies
- **SongSearchService** - Database queries for songs

**Matching Engine:**

Pipeline: `apps/api/src/engine/pipeline.ts`

```
User Message
     ↓
[1] Exact Phrase Match
     ↓ (if no match)
[2] Keyword Match
     ↓ (if low confidence)
[3] Semantic Search (embeddings)
     ↓
[4] Fallback (popular songs)
     ↓
Return top song with reasoning
```

### 3. Database (PostgreSQL + pgvector)

**Schema:** [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma)

**Tables:**

- **songs** - Song metadata with dual embedding storage
  - `embedding` (JSONB) - 384-dim array for compatibility
  - `embedding_vector` (vector(384)) - Native pgvector with HNSW index
  - `tags[]`, `phrases[]` - Array fields for keyword matching

- **users** - Anonymous users
  - `anonHandle` - Random animal adjective combo
  - `ipHash` - Rate limiting

- **rooms** - Chat room isolation
  - `name` - Room identifier
  - `allowExplicit` - Content filtering flag

- **messages** - Chat messages
  - `text` - User's original message
  - `chosenSongId` - Matched song FK
  - `scores` - JSON with match scores

- **message_reactions** - Emoji reactions
  - Unique constraint: (messageId, userId, emoji)

**Indexes:**

- GIN indexes on `tags[]` and `phrases[]` for fast array searches
- B-tree indexes on title, artist, popularity, year
- **HNSW index** on `embedding_vector` for approximate nearest neighbor search

## Song Matching Engine

### Strategy 1: Exact Phrase Match

**File:** [apps/api/src/engine/matchers/keyword.ts](apps/api/src/engine/matchers/keyword.ts)

```
User: "hey jude"
↓
Search phrases[] array for exact substring
↓
Match: "Hey Jude" by The Beatles (100% confidence)
```

**Characteristics:**
- Fastest (array index scan)
- Case-insensitive
- Partial matching supported
- High confidence results

### Strategy 2: Keyword Extraction

**File:** [apps/api/src/engine/matchers/keyword.ts](apps/api/src/engine/matchers/keyword.ts)

```
User: "I'm feeling stressed about work"
↓
Extract keywords: ["stressed", "work"]
↓
Search tags[] for matches
↓
Score by keyword overlap + popularity boost
↓
Match: "Stressed Out" by Twenty One Pilots
```

**Scoring:**
- Base similarity from tag overlap
- Popularity boost (0-10% based on song popularity)
- Year recency boost (newer songs favored slightly)

### Strategy 3: Semantic Search (Embeddings)

**File:** [apps/api/src/engine/matchers/semantic.ts](apps/api/src/engine/matchers/semantic.ts)

**Flow:**

```
User: "california dreaming again"
↓
Generate embedding (Xenova/all-MiniLM-L6-v2)
  → 384-dimensional vector
↓
Query PostgreSQL with pgvector:
  SELECT *, embedding_vector <=> '[0.1, 0.2, ...]' AS distance
  FROM songs
  ORDER BY embedding_vector <=> '[0.1, 0.2, ...]'
  LIMIT 50
↓
Convert distance to similarity (1 - distance)
↓
Filter by threshold (>0.5)
↓
Return top matches
```

**HNSW Index Details:**
```sql
CREATE INDEX idx_songs_embedding_hnsw
ON songs USING hnsw (embedding_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

- **m=16** - Connections per node (quality vs speed tradeoff)
- **ef_construction=64** - Build-time accuracy
- **Runtime:** `SET LOCAL hnsw.ef_search = 100` for query accuracy

**Embedding Model:**
- **Model:** Xenova/all-MiniLM-L6-v2
- **Dimensions:** 384
- **Normalization:** L2 normalized for cosine similarity
- **Local inference:** No API calls, runs on CPU

### Strategy 4: Fallback

When all strategies fail or confidence is too low:
- Return most popular songs from database
- Sort by `popularity DESC`
- Preference for well-known classics

## Real-Time Communication (WebSocket)

**Connection Flow:**

```
1. Client connects to WS endpoint
   ↓
2. Server creates session, assigns anonymous handle
   ↓
3. User joins default room ("general")
   ↓
4. Server broadcasts user_joined event
   ↓
5. Client receives room history (last 50 messages)
   ↓
6. Bidirectional communication established
```

**Message Processing:**

```
Client sends: { type: 'msg', content: 'Hey everyone!' }
     ↓
Server receives message
     ↓
Run through matching engine (exact → keyword → semantic)
     ↓
Save message + chosen song to database
     ↓
Broadcast to all room users:
  { type: 'song_result', songId, title, artist, similarity, reasoning }
     ↓
Clients display in chat UI
```

**Connection Management:**

- **Heartbeat:** 30-second ping/pong for keepalive
- **Reconnection:** Client auto-reconnects with exponential backoff
- **State sync:** Re-fetch room users and history on reconnect
- **Cleanup:** Remove user from room on disconnect

## Embedding System

**File:** [apps/api/src/embeddings/index.ts](apps/api/src/embeddings/index.ts)

**Dual Storage Strategy:**

1. **JSONB column (`embedding`):**
   - Compatibility layer
   - Easy inspection in Prisma Studio
   - Backup if pgvector has issues

2. **pgvector column (`embedding_vector`):**
   - Primary search column
   - HNSW index for fast approximate search
   - Native vector operations

**Seeding Process:**

```bash
pnpm seed
  ↓
Read songs from CSV (apps/api/data/songs_seed.csv)
  ↓
For each song:
  - Generate searchable text:
      "${title} by ${artist} ${tags.join(' ')} ${phrases.join(' ')}"
  - Pass through Xenova model
  - Get 384-dim embedding vector
  - Store in both JSONB and pgvector columns
  ↓
Commit to database with transaction
```

**Embedding Generation Time:**
- ~1 second per song (CPU-bound)
- 500 songs = ~8-10 minutes
- Runs once during seeding, embeddings cached thereafter

## Security & Rate Limiting

**Anonymous Users:**
- No authentication required
- Session tied to WebSocket connection
- IP hashing for rate limiting
- Anonymous handles prevent tracking

**Rate Limiting:**

File: [apps/api/src/utils/rate-limiter.ts](apps/api/src/utils/rate-limiter.ts)

- **Default:** 100 requests per 60 seconds per IP
- **Storage:** In-memory Map (resets on server restart)
- **Future:** Consider Redis for distributed rate limiting

**Content Filtering:**

File: [apps/api/src/engine/content-filter.ts](apps/api/src/engine/content-filter.ts)

- Optional explicit content filtering
- Configurable per room via `allowExplicit` flag
- Note: Family-friendly mode removed in recent refactor

**CORS:**
- Configured via `FRONTEND_ORIGIN` env var
- Allows credentials for cookie-based sessions
- Multiple origins supported (comma-separated)

## Deployment Architecture (Railway)

```
GitHub Push to main
        ↓
Railway Detects Change
        ↓
   ┌────────────────────────┐
   │   Build Phase          │
   │  - API: Dockerfile     │
   │  - Web: Nixpacks       │
   │  - Run migrations      │
   │  - Generate Prisma     │
   └────────────────────────┘
        ↓
   ┌────────────────────────┐
   │   Deploy Phase         │
   │  - Health checks       │
   │  - Zero-downtime swap  │
   │  - Logs streaming      │
   └────────────────────────┘
        ↓
Production Live
```

**API Build (Dockerfile):**

Multi-stage build:
1. **Dependencies stage** - Install all deps
2. **Builder stage** - Compile TypeScript + Prisma
3. **Runtime stage** - Copy only production artifacts

**Web Build (Nixpacks):**

1. Install pnpm via corepack
2. `pnpm install --frozen-lockfile`
3. `pnpm run build` (Vite static build)
4. Serve via `pnpm start` (serves dist/)

**Database:**
- Railway-managed PostgreSQL 14+
- pgvector extension pre-installed
- Automatic backups
- Connection pooling via DATABASE_URL

## Performance Considerations

**Bottlenecks:**

1. **Embedding generation** (CPU-bound)
   - Mitigation: Pre-compute during seeding
   - Cache in database, don't regenerate

2. **Vector search** (I/O-bound)
   - Mitigation: HNSW index for approximate search
   - Trade accuracy for speed (m=16, ef_search=100)

3. **WebSocket broadcasting** (Memory-bound)
   - Mitigation: Connection manager tracks active connections
   - Broadcast only to users in same room

**Optimizations:**

- Prisma query batching
- Indexed database queries
- Lazy-load embedding model (don't load until first use)
- Connection pooling (20 connections default)

## Monitoring & Debugging

**Debug Flags:**

```bash
# Enable detailed embedding logs
DEBUG_MATCHING=1 pnpm dev

# Pino logging levels
LOG_LEVEL=debug pnpm dev

# Prisma query logging
DEBUG=prisma:query pnpm dev
```

**Health Endpoints:**

- `/health` - Basic health check
- `/api/admin/analytics` - Song count, user stats
- `/debug/connections` - Active WebSocket connections

**Logs:**

Structured JSON logging via Pino:
```json
{
  "level": 30,
  "time": 1707080400000,
  "msg": "Semantic search completed",
  "totalResults": 50,
  "filteredMatches": 10,
  "topSimilarity": 0.87,
  "duration": 145
}
```

## Future Enhancements

**Scalability:**
- Redis for distributed WebSocket state
- Read replicas for database
- Horizontal API scaling with sticky sessions

**Features:**
- User preferences (favorite genres, decades)
- Room-specific song catalogs
- Playlist generation from chat history
- Spotify/Apple Music integration

**Performance:**
- GPU acceleration for embeddings
- Quantized vector search (reduce 384 dims)
- Materialized views for analytics

## Key Files Reference

| Component | File | Purpose |
|-----------|------|---------|
| API Entry | `apps/api/src/index.ts` | Fastify server, routes, WebSocket |
| Matching Pipeline | `apps/api/src/engine/pipeline.ts` | Orchestrates matching strategies |
| Semantic Search | `apps/api/src/engine/matchers/semantic.ts` | Embedding-based KNN search |
| Keyword Match | `apps/api/src/engine/matchers/keyword.ts` | Phrase/tag matching |
| Embeddings | `apps/api/src/embeddings/index.ts` | Xenova model wrapper |
| Database Schema | `apps/api/prisma/schema.prisma` | Tables, indexes, relations |
| WebSocket Store | `apps/web/src/stores/chatStore.ts` | Client state management |
| Chat UI | `apps/web/src/components/ChatInterface.tsx` | Message rendering |
| User Service | `apps/api/src/services/user-service.ts` | Anonymous user handling |
| Connection Manager | `apps/api/src/services/connection-manager.ts` | WebSocket lifecycle |
