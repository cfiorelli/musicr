# Musicr

**Type anything. Get a song that matches the meaning.**

Real-time anonymous chat where every message is matched to a song using semantic similarity. No accounts, no sign-up — just type and see what Musicr picks.

Live: [musicrweb-production.up.railway.app](https://musicrweb-production.up.railway.app) &middot;
Repo: [github.com/cfiorelli/musicr](https://github.com/cfiorelli/musicr)

### How it works

1. You type a message — a mood, a memory, a joke, anything.
2. The server embeds your text into a 384-dim vector (Xenova/all-MiniLM-L6-v2, runs server-side).
3. pgvector finds the closest song in a ~114k-song catalog via HNSW cosine similarity.
4. The matched song appears instantly in the chat. Click it to listen on YouTube.

Matching is based on title + artist + tags + album metadata (no lyrics). Some matches are uncanny; some are a stretch — that tension is the fun part.

### What I want feedback on

- Does the matching feel surprising/delightful or random/off?
- Is the "type -> get a song" loop obvious enough without explanation?
- Mobile experience — anything broken or awkward?
- Ideas for the catalog or matching quality.

## Stack

- **Fastify** + WebSocket — real-time chat, rate limiting, maintenance mode
- **PostgreSQL + pgvector** — HNSW index, cosine similarity search
- **Xenova/all-MiniLM-L6-v2** — local embedding model (384-dim, no external API needed)
- **Prisma ORM** — typed DB client, migrations
- **React 18 + Zustand + Tailwind** — frontend
- **Vite** — build tool
- **pnpm workspaces** — monorepo (`apps/api`, `apps/web`, `shared/types`)

## Quick Start (local)

Prerequisites: Node.js 20+, pnpm 8+, PostgreSQL 14+ with [pgvector](https://github.com/pgvector/pgvector).

```bash
git clone https://github.com/cfiorelli/musicr.git && cd musicr
pnpm install

# Configure
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL

# Database
cd apps/api
pnpm prisma generate
pnpm prisma migrate deploy
pnpm seed                                # seeds songs + generates embeddings
cd ../..

# Run
pnpm dev                                 # API :4000, Web :5173
```

Verify: `GET http://localhost:4000/health` should return `{ "ok": true }`.

## Key Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check (includes song count, DB status) |
| `WS /` | WebSocket — real-time chat |
| `GET /api/admin/analytics` | Song count, user stats |

## Safety

- **Rate limiting** — per-IP message throttle (production)
- **Maintenance mode** — toggle via `MAINTENANCE_MODE=true` env var
- **Hard input cap** — messages truncated at 500 chars
- **Anonymous** — no PII stored; users identified by hashed IP + random handle

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

See `apps/api/.env.example` for a complete reference with Railway-specific variables.

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
