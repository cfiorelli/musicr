-- Musicr DB Storage Health Check
-- Run periodically to monitor disk usage and detect growth.
--
-- Usage (Railway psql or any Postgres client):
--   psql $DATABASE_URL -f scripts/db-storage-check.sql
--
-- Thresholds (1 GB volume):
--   GREEN:  < 500 MB (< 50%)
--   YELLOW: 500-700 MB (50-70%) — plan cleanup
--   RED:    > 700 MB (> 70%) — act immediately

-- 1. Overall database size
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS db_size,
  ROUND(pg_database_size(current_database())::numeric / (1024*1024*1024) * 100, 1) AS pct_of_1gb,
  CASE
    WHEN pg_database_size(current_database()) < 500 * 1024 * 1024 THEN 'GREEN'
    WHEN pg_database_size(current_database()) < 700 * 1024 * 1024 THEN 'YELLOW'
    ELSE 'RED'
  END AS status;

-- 2. Top 10 relations by size
SELECT
  c.relname AS relation,
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'i' THEN 'index' END AS type,
  pg_size_pretty(pg_relation_size(c.oid)) AS size,
  pg_relation_size(c.oid) AS bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','i')
ORDER BY pg_relation_size(c.oid) DESC
LIMIT 10;

-- 3. Songs table health
SELECT
  COUNT(*) AS total_songs,
  COUNT(*) FILTER (WHERE embedding_vector IS NOT NULL) AS with_vectors,
  COUNT(*) FILTER (WHERE is_placeholder = true) AS placeholders,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS jsonb_remaining
FROM songs;

-- 4. Dead tuple bloat indicator
SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  CASE WHEN n_live_tup > 0
    THEN ROUND(n_dead_tup::numeric / n_live_tup * 100, 1)
    ELSE 0
  END AS dead_pct,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;
