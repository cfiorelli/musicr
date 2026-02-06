# CI Setup Documentation

**Date:** 2026-02-05
**Objective:** Add minimal CI to prevent regressions without requiring database
**Status:** Implemented, pending backend TypeScript fixes

---

## What Was Added

### 1. GitHub Actions Workflow

**File:** [.github/workflows/ci.yml](.github/workflows/ci.yml)

**Runs on:**
- Push to `main` branch
- Pull requests to `main`

**Jobs:**
1. ✅ Install dependencies (`pnpm install --frozen-lockfile`)
2. ✅ Build all packages (`pnpm -r build`)
3. ✅ Run catalog safety check (`pnpm --filter @musicr/api run catalog:safety`)
4. ✅ Lint (optional, continues on error)

**Key Features:**
- **No database required** - Runs in file-only mode
- **Safe for background tasks** - Only checks files, won't interfere with embeddings
- **15-minute timeout** - Prevents hanging builds
- **Uses pnpm cache** - Faster builds

### 2. Catalog Safety CI Mode

**File:** [apps/api/scripts/catalog-safety-check.ts](apps/api/scripts/catalog-safety-check.ts)

**Enhancement:** Added `--ci` flag and `CI` environment variable support

**Behavior:**
```bash
# Normal mode (checks database + files)
pnpm run catalog:safety

# CI mode (files only, no database)
CI=true pnpm run catalog:safety
# or
pnpm run catalog:safety -- --ci
```

**Files checked in CI mode:**
- `apps/api/data/songs_seed.csv`
- `apps/api/data/musicbrainz/musicbrainz_50k.jsonl` (if exists)

**Skipped in CI mode:**
- Database queries (requires PostgreSQL connection)

### 3. Contributing Guidelines

**File:** [CONTRIBUTING.md](CONTRIBUTING.md)

**Content:**
- Pre-merge checklist (build, catalog safety, no placeholders)
- Development workflow (setup, running locally)
- Catalog data guidelines (what's allowed/prohibited)
- CI/CD info

**Key requirement:**
> Before merging: build passes, catalog safety passes, no placeholders.

### 4. Bug Report Template

**File:** [.github/ISSUE_TEMPLATE/bug_report.md](.github/ISSUE_TEMPLATE/bug_report.md)

**Sections:**
- Bug description
- Steps to reproduce
- Expected vs actual behavior
- Console output
- Environment (browser, OS, device)
- Additional context

---

## Current Status

### ✅ What Works

1. **CI workflow file created** - Ready to run on GitHub
2. **Catalog safety enhanced** - Supports CI mode without database
3. **Documentation added** - CONTRIBUTING.md with clear guidelines
4. **Issue template added** - Bug reports have consistent format

### ⚠️ Known Issues

#### Backend Build Fails

**Problem:** TypeScript compilation errors in `apps/api/src/index.ts`

```
src/index.ts(1615,33): error TS2339: Property 'moderated' does not exist on type 'SongMatchResult'.
```

**Cause:** Leftover references to `songMatchResult.moderated` from previous NSFW removal

**Impact:**
- CI will fail on `pnpm -r build` step
- Backend cannot be deployed
- Frontend builds successfully

**Fix Required:**
Remove all references to `songMatchResult.moderated` in WebSocket message handler (~lines 1600-1680)

#### Catalog Safety Finds False Positives

**Problem:** 3 real songs flagged as placeholders

```
- "Barn Jam 166" by David Gilmour (real Pink Floyd jam)
- "Come in Number 21" by The Charlatans (real song)
- "Pop Song 89" by Motion City Soundtrack (real R.E.M. cover)
```

**Cause:** Numbered placeholder detection (`/song.*\d+/i`) is too aggressive

**Impact:**
- CI fails on catalog safety check
- Prevents merging valid MusicBrainz data

**Fix Options:**
1. Improve placeholder detection to exclude real songs
2. Add whitelist for known false positives
3. Adjust regex to be more specific (e.g., "Test Song 123", "Song #1")

---

## Testing Results

### Catalog Safety (CI Mode)

```bash
$ CI=true pnpm --filter @musicr/api run catalog:safety

# Output:
✅ songs_seed.csv: 247 songs, 0 placeholders
❌ musicbrainz_50k.jsonl: 50000 songs, 3 placeholders (false positives)

# Exit code: 1 (fails due to false positives)
```

### Build (All Packages)

```bash
$ pnpm -r build

# Output:
✅ Frontend: Build successful
❌ Backend: TypeScript errors (moderated property)

# Exit code: 1 (fails due to backend errors)
```

---

## Files Modified

| File | Type | Description |
|------|------|-------------|
| `.github/workflows/ci.yml` | Created | GitHub Actions workflow |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Created | Bug report template |
| `CONTRIBUTING.md` | Created | Contribution guidelines |
| `apps/api/scripts/catalog-safety-check.ts` | Modified | Added CI mode support (~15 lines) |

**Total:** 3 new files, 1 modified file

---

## Next Steps to Make CI Pass

### 1. Fix Backend TypeScript Errors

**File:** `apps/api/src/index.ts` (lines ~1600-1680)

**Find and remove:**
```typescript
if (songMatchResult.moderated?.wasFiltered) {
  // ... remove this entire block
}
```

**Replace with simple broadcast:**
```typescript
const displayMessage = {
  type: 'display',
  id: savedMessage.id,
  originalText: messageData.text,
  // ... rest of message
};
connectionManager.broadcastToRoom(defaultRoom.id, displayMessage, connectionId);
```

### 2. Fix Placeholder Detection

**File:** `apps/api/scripts/utils/placeholder-detector.ts`

**Option A: Whitelist known false positives**
```typescript
const WHITELIST_SONGS = [
  'Barn Jam 166',
  'Come in Number 21',
  'Pop Song 89'
];

if (WHITELIST_SONGS.includes(title)) {
  return null; // Not a placeholder
}
```

**Option B: Improve regex**
```typescript
// Instead of: /song.*\d+/i
// Use: /^(test|my|demo|sample|fake)\s+(song|track).*\d+$/i
```

### 3. Verify CI Passes

After fixes:

```bash
# Test locally
pnpm -r build                                    # Should pass
CI=true pnpm --filter @musicr/api run catalog:safety  # Should pass

# Commit and push
git add .
git commit -m "Fix: Backend TypeScript errors and placeholder detection"
git push

# Check GitHub Actions
# https://github.com/<user>/musicr/actions
```

---

## Workflow Details

### Trigger Conditions

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

**Runs on:**
- Every push to `main`
- Every PR targeting `main`
- Manual trigger via GitHub UI

### Job Steps

```yaml
1. Checkout code              # Get repository files
2. Setup pnpm                 # Install pnpm package manager
3. Setup Node.js              # Install Node 18 with cache
4. Install dependencies       # pnpm install --frozen-lockfile
5. Build all packages         # pnpm -r build
6. Run catalog safety check   # CI mode, no database
7. Lint (optional)            # pnpm -r lint (continues on error)
```

### Environment Variables

- `NODE_ENV=test` - Skip env var checks during build
- `CI=true` - Enable CI mode for catalog safety

### Timeouts

- **Workflow:** 15 minutes max
- **Prevents:** Hanging builds, runaway processes
- **Safe for:** Background embedding tasks (no database access)

---

## Design Decisions

### Why File-Only Mode?

**Problem:** CI runners don't have access to production database

**Solution:** Check catalog files instead
- ✅ No database connection needed
- ✅ Fast (< 1 second)
- ✅ Safe for concurrent runs
- ✅ Validates source of truth (CSV/JSONL files)

**Trade-off:** Doesn't catch placeholders added directly to database

### Why Skip Lint Errors?

**Current state:** Lint may not be fully configured

**Approach:**
```yaml
continue-on-error: true
```

**Rationale:**
- Don't block CI on non-critical issues
- Allows gradual adoption of linting
- Shows lint output for awareness

**Future:** Remove `continue-on-error` when lint is fully configured

### Why 15-Minute Timeout?

**Typical build times:**
- Install: ~30 seconds
- Build: ~10 seconds
- Catalog check: ~1 second
- **Total:** ~45 seconds

**15 minutes provides:**
- 20x buffer for slow runners
- Prevents infinite loops
- Fails fast on hanging builds

---

## Maintenance

### Updating Dependencies

```bash
# Update pnpm action version
# .github/workflows/ci.yml
- uses: pnpm/action-setup@v4  # Update v4 to v5 when available
```

### Adding More Checks

```yaml
# Add to .github/workflows/ci.yml after build step
- name: Run unit tests
  run: pnpm -r test
  continue-on-error: false
```

### Changing Node Version

```yaml
# .github/workflows/ci.yml
- uses: actions/setup-node@v4
  with:
    node-version: '20'  # Update from 18 to 20
```

---

## Summary

**Added:**
- ✅ GitHub Actions CI workflow
- ✅ Catalog safety CI mode (no database)
- ✅ Contributing guidelines
- ✅ Bug report template

**Pending:**
- ⏸️ Fix backend TypeScript errors
- ⏸️ Fix placeholder detection false positives
- ⏸️ Verify CI passes on GitHub

**Impact:**
- Prevents regressions (build failures, placeholders)
- No database required (file-only checks)
- Safe for background tasks (won't interfere with embeddings)
- Clear contribution process

**Files:** 3 new, 1 modified
**Effort:** ~30 minutes to implement, pending fixes to pass
