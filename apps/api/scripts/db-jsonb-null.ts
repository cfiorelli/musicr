import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

/**
 * JSONB Embedding Cleanup Script
 *
 * One-time manual cleanup to NULL out all JSONB embedding data.
 * This script ONLY affects the `embedding` column (JSONB).
 * The `embedding_vector` column (pgvector) is NOT touched.
 *
 * Purpose:
 * - Reclaim disk space from redundant JSONB embeddings
 * - All runtime queries already use embedding_vector
 * - JSONB embeddings are no longer written by seed/backfill scripts
 *
 * Safety:
 * - Does NOT delete rows
 * - Does NOT modify embedding_vector
 * - Can be run multiple times safely (idempotent)
 */

interface TableStats {
  tableName: string;
  sizeBytes: bigint;
  sizeMB: string;
}

async function getTableSize(tableName: string): Promise<TableStats> {
  const result = await prisma.$queryRaw<Array<{ size: bigint }>>`
    SELECT pg_total_relation_size(${tableName}::regclass) as size
  `;

  const sizeBytes = result[0]?.size || BigInt(0);
  const sizeMB = (Number(sizeBytes) / 1024 / 1024).toFixed(2);

  return {
    tableName,
    sizeBytes,
    sizeMB
  };
}

async function getJsonbCount(): Promise<number> {
  const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM songs
    WHERE embedding IS NOT NULL
  `;

  return Number(result[0]?.count || 0);
}

async function nullifyJsonbEmbeddings(): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE songs
    SET embedding = NULL
    WHERE embedding IS NOT NULL
  `;

  return result;
}

async function main() {
  await prisma.$connect();

  try {
    logger.info('='.repeat(60));
    logger.info('JSONB EMBEDDING CLEANUP');
    logger.info('='.repeat(60));

    // Get before stats
    logger.info('\nBEFORE:');
    const beforeSize = await getTableSize('songs');
    const beforeCount = await getJsonbCount();

    logger.info(`  Table size:         ${beforeSize.sizeMB} MB`);
    logger.info(`  JSONB embeddings:   ${beforeCount.toLocaleString()}`);

    if (beforeCount === 0) {
      logger.info('\n✅ No JSONB embeddings found. Nothing to clean up.');
      logger.info('All clear!');
      return;
    }

    // Confirm operation
    logger.info(`\nWill NULL out ${beforeCount.toLocaleString()} JSONB embeddings...`);
    logger.info('This operation is SAFE:');
    logger.info('  - Does NOT delete rows');
    logger.info('  - Does NOT touch embedding_vector (pgvector)');
    logger.info('  - Runtime queries use embedding_vector only');

    // Execute cleanup
    logger.info('\nExecuting cleanup...');
    const updatedRows = await nullifyJsonbEmbeddings();
    logger.info(`✅ Updated ${updatedRows.toLocaleString()} rows`);

    // Vacuum to reclaim space
    logger.info('\nRunning VACUUM to reclaim disk space...');
    await prisma.$executeRawUnsafe('VACUUM FULL songs');
    logger.info('✅ VACUUM complete');

    // Get after stats
    logger.info('\nAFTER:');
    const afterSize = await getTableSize('songs');
    const afterCount = await getJsonbCount();

    logger.info(`  Table size:         ${afterSize.sizeMB} MB`);
    logger.info(`  JSONB embeddings:   ${afterCount.toLocaleString()}`);

    // Calculate reclaimed space
    const reclaimedBytes = Number(beforeSize.sizeBytes - afterSize.sizeBytes);
    const reclaimedMB = (reclaimedBytes / 1024 / 1024).toFixed(2);
    const percentReduction = ((reclaimedBytes / Number(beforeSize.sizeBytes)) * 100).toFixed(1);

    logger.info('\n' + '='.repeat(60));
    logger.info('SPACE RECLAIMED');
    logger.info('='.repeat(60));
    logger.info(`  Before:    ${beforeSize.sizeMB} MB`);
    logger.info(`  After:     ${afterSize.sizeMB} MB`);
    logger.info(`  Reclaimed: ${reclaimedMB} MB (${percentReduction}% reduction)`);
    logger.info('='.repeat(60));

    logger.info('\n✅ JSONB cleanup complete!');
    logger.info('The embedding_vector column is intact and functional.\n');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  logger.error({ error: error.message }, 'JSONB cleanup failed');
  process.exit(1);
});
