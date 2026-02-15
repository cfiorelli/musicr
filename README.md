# Musicr

**Type anything. Get a song that matches.**

Live: [musicrweb-production.up.railway.app](https://musicrweb-production.up.railway.app) &middot;
Repo: [github.com/cfiorelli/musicr](https://github.com/cfiorelli/musicr)

### How it works

- You type a message — a mood, a feeling, a sentence, anything.
- Musicr turns your text into a 384-dimensional embedding using a local transformer model (Xenova/all-MiniLM-L6-v2).
- It finds the closest song in a PostgreSQL + pgvector catalog via cosine similarity search.
- The matched song appears instantly in the real-time chat — no accounts, no sign-up.

### What I want feedback on

- Does the matching feel surprising/delightful or random/off?
- Is the "type → get a song" loop obvious enough without explanation?
- Mobile experience — anything broken or awkward?
- Ideas for the catalog (currently thousands of songs with pre-computed embeddings).

---

Real-time anonymous chat where user messages are converted into relevant song recommendations using AI-powered semantic search.

**What it is:** A WebSocket-based chat application that transforms conversational text into music suggestions using 384-dimensional embeddings and pgvector similarity search.

**What it isn't:** A music player, streaming service, or lyrics database. Musicr recommends songs based on message content but doesn't play audio.

## Tech Stack

### Backend
- **Fastify** - HTTP server and WebSocket handling
- **Prisma ORM** - Database client with TypeScript types
- **PostgreSQL + pgvector** - Vector similarity search with HNSW indexing
- **Xenova/all-MiniLM-L6-v2** - Local embedding model (384-dim)
- **Pino** - Structured JSON logging

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Zustand** - Lightweight state management
- **Tailwind CSS** - Utility-first styling

### Monorepo
- **pnpm workspaces** - Package management
- **TypeScript** - Type safety across all packages

## Project Structure

```
musicr/
├── apps/
│   ├── api/              # Fastify backend (port 4000)
│   │   ├── src/
│   │   │   ├── index.ts  # API entrypoint
│   │   │   ├── engine/   # Song matching logic
│   │   │   └── services/ # Database, WebSocket, users
│   │   ├── prisma/       # Database schema and migrations
│   │   └── scripts/      # Seeding and utilities
│   └── web/              # React frontend (port 5173)
│       └── src/
│           ├── main.tsx  # Web entrypoint
│           └── stores/   # Zustand state
├── shared/
│   └── types/            # Shared TypeScript types
└── package.json          # Root workspace config
```

## Local Development

### Prerequisites

- **Node.js 20+**
- **pnpm 8+**
- **PostgreSQL 14+** with pgvector extension

### Setup

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your DATABASE_URL
   ```

3. **Set up database**
   ```bash
   cd apps/api

   # Generate Prisma client
   pnpm prisma generate

   # Run migrations
   pnpm prisma migrate deploy

   # Seed database with songs (includes embedding generation)
   pnpm seed
   ```

4. **Start development servers**
   ```bash
   # From root directory
   pnpm dev

   # OR run separately:
   pnpm --filter @musicr/api dev    # API on http://localhost:4000
   pnpm --filter @musicr/web dev    # Web on http://localhost:5173
   ```

5. **Verify setup**
   - API health: http://localhost:4000/health
   - Web UI: http://localhost:5173

## Environment Variables

Create `.env` in the project root with the following:

### Required

- `DATABASE_URL` - PostgreSQL connection string with pgvector support
  ```
  postgresql://user:password@host:5432/musicr?schema=public
  ```

### Optional

- `NODE_ENV` - Environment (`development` | `production`) [default: `development`]
- `PORT` - API server port [default: `4000`]
- `HOST` - API bind address [default: `0.0.0.0`]
- `FRONTEND_ORIGIN` - CORS allowed origins [default: `http://localhost:5173`]
- `COOKIE_SECRET` - Session secret (required in production, 32+ characters)
- `OPENAI_API_KEY` - Optional OpenAI key (local Xenova model used by default)
- `VITE_API_URL` - Frontend API URL [default: auto-detected from window.location]
- `LOG_LEVEL` - Pino log level (`debug` | `info` | `warn` | `error`) [default: `info`]

See `.env.example` for complete reference with Railway-specific variables.

## Database

### Schema

- **Songs** - Title, artist, year, tags, phrases, embeddings (384-dim vectors)
- **Users** - Anonymous handles, IP hashing for rate limiting
- **Rooms** - Chat room isolation with per-room configs
- **Messages** - User messages linked to chosen songs
- **MessageReactions** - Emoji reactions on messages

Schema location: [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma)

### Embeddings

Musicr uses **Xenova/all-MiniLM-L6-v2** to generate 384-dimensional embeddings:
- **Storage:** Dual-format (JSONB `embedding` + native pgvector `embedding_vector`)
- **Index:** HNSW on `embedding_vector` for fast approximate nearest neighbor search
- **Search:** Cosine distance operator (`<=>`) for semantic similarity

### Migrations

```bash
cd apps/api

# Create new migration (development)
pnpm prisma migrate dev --name description_of_change

# Apply pending migrations (production)
pnpm prisma migrate deploy

# View database in Prisma Studio
pnpm db:studio
```

## Building for Production

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @musicr/api build
pnpm --filter @musicr/web build

# Start API in production mode
cd apps/api
pnpm start  # Runs: node dist/index.js
```

## Deployment

Musicr is deployed on **Railway**:
- **API:** Dockerfile-based build ([apps/api/Dockerfile](apps/api/Dockerfile))
- **Web:** Nixpacks build ([apps/web/nixpacks.toml](apps/web/nixpacks.toml))
- **Database:** Railway PostgreSQL with pgvector extension

Deployment is automatic via GitHub integration. Push to `main` triggers Railway builds.

### Railway Environment Variables

Set in Railway dashboard:
- `DATABASE_URL` - Auto-provided by Railway PostgreSQL addon
- `COOKIE_SECRET` - Generate with `openssl rand -hex 32`
- `FRONTEND_ORIGIN` - Your Railway web domain
- `NODE_ENV=production`

## Commands Reference

### Root Workspace

```bash
pnpm dev          # Run API + web concurrently
pnpm build        # Build all packages
pnpm lint         # Lint all packages
pnpm clean        # Remove all build artifacts
```

### API Package

```bash
cd apps/api

pnpm dev          # Start dev server with hot reload
pnpm build        # Compile TypeScript to dist/
pnpm start        # Run compiled production build
pnpm seed         # Seed database with songs + embeddings
pnpm db:generate  # Generate Prisma client
pnpm db:push      # Push schema changes (dev only)
pnpm db:migrate   # Create migration (dev)
pnpm db:studio    # Open Prisma Studio GUI
```

### Web Package

```bash
cd apps/web

pnpm dev          # Start Vite dev server
pnpm build        # Build static production files
pnpm preview      # Preview production build locally
```

## API Endpoints

- `GET /health` - Health check (returns `{ status: "ok", timestamp: "..." }`)
- `GET /test` - WebSocket test page (HTML interface)
- `GET /api/admin/analytics` - Admin analytics (song count, user stats)
- `GET /api/rooms/:roomId/users` - List users in a room
- `GET /debug/connections` - Debug WebSocket connections
- `WS /` - WebSocket connection for real-time chat

## Secrets

Production secrets live exclusively in Railway environment variables — never in code or git history. See [SECURITY.md](SECURITY.md) for:

- Where each secret is configured
- How to rotate `DATABASE_URL`, `OPENAI_API_KEY`, `COOKIE_SECRET`
- What to do if a secret is leaked
- Automated scanning (Gitleaks CI, Dependabot)

## Documentation

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) - System design and matching engine
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) - Development guidelines
- **Operations:** [RUNBOOK.md](RUNBOOK.md) - Deployment and troubleshooting
- **Security:** [SECURITY.md](SECURITY.md) - Secret rotation and leak response
- **Test Fixtures:** [apps/api/fixtures/FIXTURES_README.md](apps/api/fixtures/FIXTURES_README.md)

## License

MIT
