# Contributing to Musicr

Thanks for your interest in contributing to Musicr!

## Before Merging

Before merging any changes to `main`, please ensure:

1. **✅ Build passes** - All packages build successfully
   ```bash
   pnpm -r build
   ```

2. **✅ Catalog safety passes** - No placeholder songs in catalog
   ```bash
   pnpm --filter @musicr/api run catalog:safety
   ```

3. **✅ No placeholders** - Verify no test/synthetic data in:
   - `apps/api/data/songs_seed.csv`
   - `apps/api/data/musicbrainz/*.jsonl`
   - Database (if running locally)

## Development Workflow

### Running Locally

```bash
# Install dependencies
pnpm install

# Start API (backend)
cd apps/api
pnpm dev

# Start Web (frontend) in another terminal
cd apps/web
pnpm dev
```

### Database Setup

```bash
# Run migrations
cd apps/api
pnpm prisma migrate dev

# Seed database (optional)
pnpm db:seed
```

### Running Tests

```bash
# Build all packages
pnpm -r build

# Run catalog safety check
pnpm --filter @musicr/api run catalog:safety

# Lint (if configured)
pnpm -r lint
```

## Code Style

- **TypeScript** - All code is TypeScript
- **ESLint** - Follow existing code patterns
- **Prettier** - Code formatting (if configured)

## Pull Requests

- Keep PRs focused on a single feature/fix
- Include descriptive commit messages
- Reference any related issues
- Ensure CI passes before requesting review

## Catalog Data Guidelines

**IMPORTANT:** Do not add placeholder/synthetic songs to the catalog.

❌ **Prohibited:**
- Test songs (e.g., "Test Song 1", "My Cool Song")
- Generic titles (e.g., "Song Title", "Untitled")
- Synthetic data (e.g., "Generated Song 123")
- Placeholders (e.g., "TODO: Add real song")

✅ **Allowed:**
- Real songs from MusicBrainz
- Properly attributed covers/versions
- Songs with valid metadata (title, artist, year)

**Verification:**
```bash
# Check for placeholders
pnpm --filter @musicr/api run catalog:safety

# Should output: "No placeholders found"
```

## CI/CD

GitHub Actions automatically runs on all PRs:
- ✅ Install dependencies
- ✅ Build all packages
- ✅ Run catalog safety check
- ✅ Lint (if configured)

**Note:** CI runs in file-only mode (no database required).

## Questions?

- Check existing issues and PRs
- Review documentation in `/docs`
- Ask questions in issues or discussions

---

**Summary:** Build passes, catalog safety passes, no placeholders. That's it!
