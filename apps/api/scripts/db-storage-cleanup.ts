import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

/**
 * Database Storage Cleanup Script
 *
 * Reclaims disk space from two sources:
 *   1. Redundant JSONB embeddings (songs.embedding column)
 *   2. Placeholder/synthetic songs (is_placeholder = true)
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/db-storage-cleanup.ts   # report only (default)
 *   DRY_RUN=0 npx tsx scripts/db-storage-cleanup.ts   # execute cleanup
 *
 * Safety:
 *   - Dry-run by default (DRY_RUN !== '0')
 *   - Does NOT touch embedding_vector (pgvector)
 *   - Placeholder songs are already excluded from all queries
 *   - No messages reference any song via chosenSongId
 *   - Idempotent: safe to run multiple times
 *
 * Space reclamation strategy (safe for low-disk environments):
 *   - Uses VACUUM (ANALYZE), NOT VACUUM FULL (which needs temp disk space)
 *   - VACUUM marks dead tuples as reusable and truncates trailing empty pages
 *   - For maximum reclamation when disk is tight, see the runbook:
 *     DROP HNSW index → VACUUM → CHECKPOINT → rebuild index
 */

const DRY_RUN = process.env.DRY_RUN !== '0';

async function getDbSize(): Promise<{ bytes: number; pretty: string }> {
  const result = await prisma.$queryRaw<Array<{ size: bigint; pretty: string }>>`
    SELECT pg_database_size(current_database()) AS size,
           pg_size_pretty(pg_database_size(current_database())) AS pretty
  `;
  return { bytes: Number(result[0].size), pretty: result[0].pretty };
}

async function getTableSize(table: string): Promise<{ bytes: number; pretty: string }> {
  const result = await prisma.$queryRaw<Array<{ size: bigint; pretty: string }>>`
    SELECT pg_total_relation_size(${table}::regclass) AS size,
           pg_size_pretty(pg_total_relation_size(${table}::regclass)) AS pretty
  `;
  return { bytes: Number(result[0].size), pretty: result[0].pretty };
}

async function main() {
  await prisma.$connect();

  try {
    logger.info('='.repeat(60));
    logger.info(DRY_RUN ? 'STORAGE CLEANUP — DRY RUN' : 'STORAGE CLEANUP — EXECUTING');
    logger.info('='.repeat(60));

    // ── Before snapshot ──
    const dbBefore = await getDbSize();
    const songsBefore = await getTableSize('songs');

    const counts = await prisma.$queryRaw<Array<{
      total: bigint;
      jsonb: bigint;
      placeholders: bigint;
      placeholder_with_vec: bigint;
    }>>`
      SELECT
        COUNT(*)                                                          AS total,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL)                     AS jsonb,
        COUNT(*) FILTER (WHERE is_placeholder = true)                     AS placeholders,
        COUNT(*) FILTER (WHERE is_placeholder = true AND embedding_vector IS NOT NULL) AS placeholder_with_vec
      FROM songs
    `;

    const { total, jsonb, placeholders, placeholder_with_vec } = counts[0];
    const totalN = Number(total);
    const jsonbN = Number(jsonb);
    const placeholderN = Number(placeholders);
    const placeholderVecN = Number(placeholder_with_vec);

    logger.info(`\nBEFORE:`);
    logger.info(`  Database size:       ${dbBefore.pretty}`);
    logger.info(`  Songs table (total): ${songsBefore.pretty}`);
    logger.info(`  Total songs:         ${totalN.toLocaleString()}`);
    logger.info(`  JSONB embeddings:    ${jsonbN.toLocaleString()} (redundant, ~${(jsonbN * 4656 / 1024 / 1024).toFixed(1)} MB data)`);
    logger.info(`  Placeholder songs:   ${placeholderN.toLocaleString()} (${placeholderVecN.toLocaleString()} with vectors)`);

    if (jsonbN === 0 && placeholderN === 0) {
      logger.info('\nNothing to clean up. Database is already optimized.');
      return;
    }

    // Estimate savings
    const estJsonbSavings = jsonbN * 4656; // avg JSONB row size
    const estPlaceholderSavings = placeholderN * 2000; // avg row size estimate
    const estHnswSavings = placeholderVecN * 2048; // HNSW entry estimate per vector
    const estTotalSavings = estJsonbSavings + estPlaceholderSavings + estHnswSavings;
    logger.info(`\nEstimated savings: ~${(estTotalSavings / 1024 / 1024).toFixed(0)} MB`);

    if (DRY_RUN) {
      logger.info('\nDRY RUN — no changes made.');
      logger.info('Run with DRY_RUN=0 to execute cleanup.');
      return;
    }

    // ── Step 1: NULL out JSONB embeddings ──
    if (jsonbN > 0) {
      logger.info(`\n[Step 1] NULLing ${jsonbN.toLocaleString()} JSONB embeddings...`);
      const updated = await prisma.$executeRaw`
        UPDATE songs SET embedding = NULL WHERE embedding IS NOT NULL
      `;
      logger.info(`  Updated ${updated.toLocaleString()} rows`);
    } else {
      logger.info('\n[Step 1] JSONB embeddings already clean — skipping.');
    }

    // ── Step 2: Delete placeholder songs ──
    if (placeholderN > 0) {
      // Safety: verify no FK references
      const fkCheck = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM messages
        WHERE "chosenSongId" IN (SELECT id FROM songs WHERE is_placeholder = true)
      `;
      const fkCount = Number(fkCheck[0].count);

      if (fkCount > 0) {
        logger.info(`\n[Step 2] SKIPPED — ${fkCount} messages reference placeholder songs.`);
      } else {
        logger.info(`\n[Step 2] Deleting ${placeholderN.toLocaleString()} placeholder songs...`);
        const deleted = await prisma.$executeRaw`
          DELETE FROM songs WHERE is_placeholder = true
        `;
        logger.info(`  Deleted ${deleted.toLocaleString()} rows`);
      }
    } else {
      logger.info('\n[Step 2] No placeholder songs — skipping.');
    }

    // ── Step 3: VACUUM ANALYZE (safe, no exclusive lock, no temp disk needed) ──
    logger.info('\n[Step 3] Running VACUUM (ANALYZE) songs...');
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) songs');
    logger.info('  VACUUM complete');

    // ── After snapshot ──
    const dbAfter = await getDbSize();
    const songsAfter = await getTableSize('songs');

    const reclaimedDb = dbBefore.bytes - dbAfter.bytes;
    const reclaimedSongs = songsBefore.bytes - songsAfter.bytes;

    logger.info('\n' + '='.repeat(60));
    logger.info('RESULTS');
    logger.info('='.repeat(60));
    logger.info(`  Database:  ${dbBefore.pretty} -> ${dbAfter.pretty}  (reclaimed ${(reclaimedDb / 1024 / 1024).toFixed(1)} MB)`);
    logger.info(`  Songs tbl: ${songsBefore.pretty} -> ${songsAfter.pretty}  (reclaimed ${(reclaimedSongs / 1024 / 1024).toFixed(1)} MB)`);
    logger.info(`  DB usage:  ${((dbAfter.bytes / (1024 * 1024 * 1024)) * 100).toFixed(1)}% of 1 GB volume`);
    logger.info('='.repeat(60));

    if (reclaimedDb < 10 * 1024 * 1024) {
      logger.info('\nNote: VACUUM (ANALYZE) marks space as reusable but may not shrink');
      logger.info('filesystem size. For maximum reclamation, see the runbook:');
      logger.info('  DROP INDEX idx_songs_embedding_hnsw;');
      logger.info('  VACUUM (ANALYZE) songs;');
      logger.info('  CHECKPOINT;');
      logger.info('  CREATE INDEX idx_songs_embedding_hnsw ON songs USING hnsw ...');
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Storage cleanup failed');
  process.exit(1);
});
