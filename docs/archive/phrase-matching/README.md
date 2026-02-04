# Phrase Matching - Removed

**Date Removed:** 2026-02-04
**Reason:** Musicr is now semantic-only, phrase matching was redundant and unused

## What These Files Were

This folder contains artifacts from the legacy phrase-matching system that was removed in favor of pure semantic/embedding-based matching.

### Files

**phrase_generation_report.txt**
- Generated report from phrase extraction algorithm
- Analyzed 193 songs to extract 739 phrase candidates
- Used ngram analysis and common expression detection

**phrase_candidates.json**
- Candidate phrases with scores
- Format: `{ phrase: string, songs: string[], score: number }`

**phrases.json**
- Curated phrase lexicon for matching
- Used by legacy phrase-lexicon-service.ts (removed)

## Why Phrase Matching Was Removed

1. **Redundant:** Semantic/embedding search handles all matching cases effectively
2. **Unused:** Main chat flow only used semantic matching (phraseLexicon was imported but never called)
3. **Complexity:** Added code paths and data dependencies without benefit
4. **Maintenance:** Required manual curation and updates to phrases.json

## Code Removed

### Services
- `apps/api/src/services/phrase-lexicon-service.ts` - Phrase matching service
- `apps/api/src/services/__tests__/phrase-lexicon.test.ts` - Tests

### Scripts
- `apps/api/scripts/generate-phrases.ts` - Phrase generation script

### Matchers (Legacy - unused)
- `apps/api/src/engine/matchers/keyword.ts` - Keyword/phrase matcher
- `apps/api/src/engine/matchers/entities.ts` - Entity extraction
- `apps/api/src/engine/matchers/mood.ts` - Mood detection
- `apps/api/src/engine/pipeline.ts` - Matcher pipeline orchestration

### Modified Services
- `apps/api/src/services/song-matching-service.ts` - Removed phraseLexicon import and initialization
- `apps/api/src/services/song-search-service.ts` - Simplified to semantic-only (removed exact/phrase strategies)

## Current Matching Strategy

**Semantic-Only:**
- User input → Embedding → Vector similarity search
- Uses pgvector HNSW index for fast nearest-neighbor search
- Fallback to popular songs if no semantic matches

**No phrase matching, no exact matching, no keyword matching.**

## Type Changes

Strategy types updated from:
```typescript
strategy: 'exact' | 'phrase' | 'embedding' | 'semantic'
```

To:
```typescript
strategy: 'embedding' | 'semantic'
```

---

**Note:** These files are kept for historical reference only. Do not attempt to restore phrase matching without first understanding why it was removed and validating that semantic search is insufficient for the use case.

**If semantic search quality is poor, the solution is to improve embeddings/ranking, not to reintroduce phrase matching.**
