# CI Fixes - Backend Build and Placeholder Detection

**Date:** 2026-02-05
**Status:** ✅ Complete - CI now passes

---

## Issues Fixed

### 1. Backend TypeScript Compilation Errors ✅

**Problem:** Leftover references to `songMatchResult.moderated` from previous NSFW removal

**Error:**
```
src/index.ts(1615,33): error TS2339: Property 'moderated' does not exist on type 'SongMatchResult'.
```

**Root Cause:** When NSFW functionality was removed, some references to the `moderated` property remained in the WebSocket message handler.

**Files Modified:**
- [apps/api/src/index.ts](apps/api/src/index.ts) (lines 1599-1695)
- [apps/api/src/services/__tests__/profanity-filter.test.ts](apps/api/src/services/__tests__/profanity-filter.test.ts) (deleted)
- [apps/api/src/services/song-matching-service.ts](apps/api/src/services/song-matching-service.ts) (line 198)

**Changes:**

1. **Removed moderation error handler** (lines 1599-1610)
   - Replaced with simple error handler
   - No longer checks for "inappropriate language"

2. **Simplified broadcast logic** (lines 1614-1695)
   - Removed entire if/else block checking `songMatchResult.moderated?.wasFiltered`
   - Removed split broadcast for filtered vs unfiltered content
   - Now broadcasts same message to all users

3. **Deleted obsolete test file**
   - Removed `profanity-filter.test.ts` (was testing removed ModerationService)

4. **Fixed unused parameter warning**
   - Changed `roomAllowsExplicit` to `_roomAllowsExplicit` in matchSongs signature
   - Suppresses TypeScript unused variable warning

**Result:** Backend now compiles successfully

---

### 2. Catalog Safety False Positives ✅

**Problem:** 3-10 real songs flagged as placeholders

**Original False Positives:**
```
- "Barn Jam 166" by David Gilmour (real Pink Floyd jam)
- "Come in Number 21" by The Charlatans (real song)
- "Pop Song 89" by Motion City Soundtrack (real R.E.M. cover)
```

**After first fix, new false positives:**
```
- "Track 05" by 2Mex
- "Beat 70" by Pat Metheny Group
- "Track 7" by Joyce Meyer
- "Beat 0033" by Snakadaktal
- "Number 1" by Jont
- "Song 1" by Jon Gibson
- "Track 10" by Philip Williams
```

**Root Cause:** Numbered placeholder detection regex was too aggressive

**File Modified:**
- [apps/api/scripts/utils/placeholder-detector.ts](apps/api/scripts/utils/placeholder-detector.ts)

**Solution:**

Updated Rule 4 to be more specific:

**Before:**
```typescript
// Matched ANY title with type word + number
const numberedPattern = /^.+\s+(Song|Track|...)\s+\d+$/i;
```

**After:**
```typescript
// Only match clear placeholder patterns:
// 1. With test/demo prefixes: "Test Song 1", "Demo Track 2"
const placeholderPrefixes = ['Test', 'Demo', 'My', 'Sample', 'Fake', 'Example', 'Placeholder'];
const genericNumberedPattern = /^(Test|Demo|My|...)\s+(Song|Track|...)\s+\d+$/i;

// 2. Very generic patterns ONLY for non-MusicBrainz records: "Song 1", "Track 2"
if (!isMusicBrainzRecord) {
  const veryGenericPattern = /^(Song|Track|...)\s+\d+$/i;
  // ...
}
```

**Key Improvements:**
1. Only flags titles with explicit test/placeholder prefixes
2. Exempts verified MusicBrainz records from very generic pattern checks
3. Recognizes that "Song 1" by a real artist on MusicBrainz is legitimate

**Result:** All false positives eliminated, catalog safety check passes

---

## Testing Results

### Build Test ✅
```bash
$ pnpm -r build

✓ apps/api: Built successfully
✓ apps/web: Built successfully
✓ shared/types: Built successfully
```

### Catalog Safety Test ✅
```bash
$ CI=true pnpm --filter @musicr/api run catalog:safety

✅ songs_seed.csv: 247 songs, 0 placeholders
✅ musicbrainz_50k.jsonl: 50000 songs, 0 placeholders

✅ PASSED: No placeholder songs detected
```

### Full CI Workflow ✅
```bash
$ pnpm -r build && CI=true pnpm --filter @musicr/api run catalog:safety

All steps passed successfully
```

---

## Technical Details

### Placeholder Detection Logic

The improved detection now uses a layered approach:

1. **Exact matches** - Known placeholders like "Found Song"
2. **Adjective + Type patterns** - "Blue Song", "Red Track" (with specific adjectives)
3. **Simple type suffix** - "X Song" (only for non-MusicBrainz)
4. **Numbered patterns** - Two variants:
   - **With prefix:** "Test Song 1", "Demo Track 2" (always flagged)
   - **Very generic:** "Song 1", "Track 2" (only for non-MusicBrainz)
5. **Trivial phrases** - Synthetic metadata patterns

### MusicBrainz Exemptions

Rules 3 and 4 now check if a song is from MusicBrainz:

```typescript
const isMusicBrainzRecord = row.source === 'musicbrainz' && row.mbid;

if (!isMusicBrainzRecord) {
  // Apply stricter checks
}
```

This recognizes that:
- MusicBrainz records are curated and verified
- Real artists sometimes use generic titles
- Having an MBID (MusicBrainz ID) validates authenticity

---

## Files Changed Summary

| File | Type | Description |
|------|------|-------------|
| [apps/api/src/index.ts](apps/api/src/index.ts) | Modified | Removed moderation code, simplified broadcast |
| [apps/api/src/services/__tests__/profanity-filter.test.ts](apps/api/src/services/__tests__/profanity-filter.test.ts) | Deleted | Obsolete test for removed service |
| [apps/api/src/services/song-matching-service.ts](apps/api/src/services/song-matching-service.ts) | Modified | Fixed unused parameter warning |
| [apps/api/scripts/utils/placeholder-detector.ts](apps/api/scripts/utils/placeholder-detector.ts) | Modified | Improved numbered placeholder detection |

**Total:** 3 modified, 1 deleted

---

## CI Status

### Before Fixes
- ❌ Build: Failed (TypeScript errors)
- ❌ Catalog safety: Failed (3-10 false positives)

### After Fixes
- ✅ Build: Passes
- ✅ Catalog safety: Passes (0 false positives)

### GitHub Actions
The CI workflow will now pass on:
- Every push to `main`
- Every pull request to `main`

---

## Deployment

These fixes are ready to be committed and pushed:

```bash
# Verify locally one more time
pnpm -r build && CI=true pnpm --filter @musicr/api run catalog:safety

# Commit
git add .
git commit -m "Fix: CI blocking issues - backend build and placeholder detection

- Remove leftover moderation code from NSFW removal
- Simplify WebSocket broadcast logic (no per-user filtering)
- Delete obsolete profanity filter test
- Improve placeholder detection to avoid false positives
- Exempt verified MusicBrainz records from generic pattern checks

Fixes #issue-number

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# Push
git push
```

---

## Summary

**Fixed:**
- ✅ Backend TypeScript compilation errors
- ✅ Catalog safety false positives
- ✅ CI workflow now passes completely

**Impact:**
- CI can run on every PR without false failures
- No changes required to workflow configuration
- Placeholder detection is now more intelligent
- Real MusicBrainz songs won't be rejected

**Files:** 3 modified, 1 deleted
**Effort:** ~15 minutes
**Status:** Ready for deployment

