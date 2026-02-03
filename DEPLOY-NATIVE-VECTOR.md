# Deploy Native pgvector + HNSW to Railway

## Quick Deploy

```bash
cd /home/hpz240/musicr/apps/api

# Option 1: Apply via Prisma (Recommended)
DATABASE_URL="$DATABASE_URL" pnpm prisma migrate deploy

# Option 2: Apply via direct SQL
psql "$DATABASE_URL" < scripts/setup-native-vector.sql

# Verify deployment
psql "$DATABASE_URL" < scripts/verify-native-vector.sql
```

## What Gets Deployed

### 1. Database Changes

**Extension:**
- Enables `pgvector` extension (if not already enabled)

**Column:**
- Adds `songs.embedding_vector` as `vector(1536)` type

**Data:**
- Backfills ~193 rows from `embedding` (JSONB) → `embedding_vector` (native vector)

**Index:**
- Creates HNSW index `idx_songs_embedding_hnsw` with:
  - Operator class: `vector_cosine_ops` (cosine distance)
  - m=16 (bidirectional links per node)
  - ef_construction=64 (candidate list size during build)

### 2. Migration Files

**New Migration:** `prisma/migrations/20260203065710_native_pgvector_column/migration.sql`
- Idempotent DDL (safe to re-run)
- Includes CREATE EXTENSION, ALTER TABLE, UPDATE, CREATE INDEX

**Removed:** `20260202000001_add_native_vector` (unapplied, superseded)

**Prisma Schema:** Already updated with:
```prisma
embeddingVector Unsupported("vector(1536)")? @map("embedding_vector")
```

### 3. API Code

**File:** `apps/api/src/engine/matchers/semantic.ts:71-104`

**Query Logic:**
1. Primary path: Uses `embedding_vector <=> vector` (native, fast)
2. Fallback: Uses `embedding::jsonb::text::vector <=> vector` (JSONB cast, slower)
3. WHERE clause: `embedding_vector IS NOT NULL OR embedding IS NOT NULL`

**Performance:**
- Native vector with HNSW: ~10-50ms for top-10 similarity search
- JSONB cast (fallback): ~100-500ms without index

## Verification Checklist

After deployment, verify:

```bash
psql "$DATABASE_URL" << 'EOF'
-- ✓ Extension exists
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- ✓ Column exists with correct type
\d songs

-- ✓ All 193 rows backfilled
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL) as has_vector
FROM songs;

-- ✓ HNSW index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'songs' AND indexname = 'idx_songs_embedding_hnsw';

-- ✓ Index is used (look for "Index Scan using idx_songs_embedding_hnsw")
EXPLAIN ANALYZE
SELECT id, title, embedding_vector <=> '[0.1,0.2,0.3]'::vector(3) as dist
FROM songs
WHERE embedding_vector IS NOT NULL
ORDER BY embedding_vector <=> '[0.1,0.2,0.3]'::vector(3)
LIMIT 10;
EOF
```

Expected outputs:
1. Extension: `vector | 0.8.1` (or higher)
2. Column: `embedding_vector | vector(1536)`
3. Row counts: `total=193, has_vector=193`
4. Index: `idx_songs_embedding_hnsw | CREATE INDEX ... USING hnsw ...`
5. Query plan: Shows `Index Scan using idx_songs_embedding_hnsw`

## Rollback (if needed)

```sql
-- Remove HNSW index
DROP INDEX IF EXISTS idx_songs_embedding_hnsw;

-- Remove native vector column
ALTER TABLE songs DROP COLUMN IF EXISTS embedding_vector;

-- Prisma: Mark migration as rolled back
DELETE FROM _prisma_migrations WHERE migration_name = '20260203065710_native_pgvector_column';
```

## Performance Testing

```bash
# Run performance comparison test
cd /home/hpz240/musicr/apps/api
DATABASE_URL="$DATABASE_URL" OPENAI_API_KEY="$OPENAI_API_KEY" \
  pnpm tsx scripts/test-vector-performance.ts
```

Expected: 4-10x speedup for native vector vs JSONB casting.

## Troubleshooting

### "extension vector does not exist"
Railway PostgreSQL should have pgvector pre-installed. If not:
1. Check Railway dashboard → Database → Extensions
2. Enable pgvector extension manually
3. Re-run migration

### "operator does not exist: vector <=> unknown"
Ensure you're casting to vector type:
```sql
-- ✓ Correct
embedding_vector <=> '[0.1,0.2]'::vector

-- ✗ Wrong
embedding_vector <=> '[0.1,0.2]'
```

### "index row requires X bytes, maximum size is Y"
HNSW index build failed due to dimension size. For 1536-dim vectors, ensure:
- PostgreSQL has sufficient `maintenance_work_mem`
- Try lower `m` value (e.g., m=12 instead of m=16)

### Query not using HNSW index
Check query structure:
```sql
-- ✓ Uses index
ORDER BY embedding_vector <=> '[...]'::vector

-- ✗ Doesn't use index
ORDER BY (embedding_vector <=> '[...]'::vector) * -1
WHERE similarity > 0.8  -- Don't filter on computed similarity
```

## Next Steps

After deployment:
1. Monitor query performance in Railway logs
2. Test semantic search in the app
3. Consider setting `hnsw.ef_search` for accuracy/speed tradeoff:
   ```sql
   SET hnsw.ef_search = 100; -- Higher = more accurate, slower
   ```
4. Plan for future embeddings backfill when adding new songs
