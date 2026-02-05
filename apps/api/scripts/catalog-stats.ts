import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';

/**
 * Catalog Statistics
 *
 * Shows current database state:
 * - Total songs
 * - Breakdown by source
 * - Placeholder count
 * - Embedding coverage
 * - Sample similarity query
 */

async function main() {
  await prisma.$connect();

  try {
    logger.info('Fetching catalog statistics...\n');

    // Total songs
    const totalSongs = await prisma.song.count();

    // Breakdown by source
    const sourceBreakdown = await prisma.$queryRaw<Array<{ source: string; count: bigint }>>`
      SELECT source, COUNT(*) as count
      FROM songs
      GROUP BY source
      ORDER BY count DESC
    `;

    // Placeholder breakdown
    const placeholderStats = await prisma.$queryRaw<Array<{ is_placeholder: boolean; count: bigint }>>`
      SELECT is_placeholder, COUNT(*) as count
      FROM songs
      GROUP BY is_placeholder
    `;

    // Embedding coverage
    const embeddingCoverage = await prisma.$queryRaw<Array<{ has_embedding: boolean; count: bigint }>>`
      SELECT
        (embedding_vector IS NOT NULL) as has_embedding,
        COUNT(*) as count
      FROM songs
      WHERE is_placeholder = false
      GROUP BY has_embedding
    `;

    // Calculate percentages
    const totalReal = placeholderStats.find(p => !p.is_placeholder)?.count || BigInt(0);
    const withEmbeddings = embeddingCoverage.find(e => e.has_embedding)?.count || BigInt(0);
    const embeddingPercent = totalReal > 0 ? Number((withEmbeddings * BigInt(100)) / totalReal) : 0;

    // Sample songs
    const sampleSongs = await prisma.song.findMany({
      where: { isPlaceholder: false },
      select: {
        title: true,
        artist: true,
        year: true,
        source: true,
        mbid: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    // Print report
    logger.info('='.repeat(60));
    logger.info('CATALOG STATISTICS');
    logger.info('='.repeat(60));
    logger.info(`\nTotal Songs: ${totalSongs}`);

    logger.info('\nBreakdown by Source:');
    for (const row of sourceBreakdown) {
      logger.info(`  ${row.source || '(null)'.padEnd(15)}: ${row.count}`);
    }

    logger.info('\nPlaceholder Status:');
    for (const row of placeholderStats) {
      const label = row.is_placeholder ? 'Placeholders' : 'Real songs';
      logger.info(`  ${label.padEnd(15)}: ${row.count}`);
    }

    logger.info('\nEmbedding Coverage (Real Songs Only):');
    for (const row of embeddingCoverage) {
      const label = row.has_embedding ? 'With embedding' : 'Missing embedding';
      logger.info(`  ${label.padEnd(20)}: ${row.count}`);
    }
    logger.info(`  Coverage: ${embeddingPercent.toFixed(1)}%`);

    logger.info('\nRecent Songs (Sample):');
    for (const song of sampleSongs) {
      logger.info(`  ${song.title} — ${song.artist} (${song.year || 'N/A'}) [${song.source}]`);
      if (song.mbid) {
        logger.info(`    MBID: ${song.mbid}`);
      }
    }

    // Test similarity query
    logger.info('\nTest Similarity Query:');
    logger.info('  Testing: "feeling happy and optimistic"');

    try {
      const testQuery = await prisma.$queryRaw<Array<{ title: string; artist: string; similarity: number }>>`
        WITH query_embedding AS (
          SELECT embedding_vector
          FROM songs
          WHERE embedding_vector IS NOT NULL
            AND is_placeholder = false
          LIMIT 1
        )
        SELECT title, artist, 1 - (embedding_vector <=> (SELECT embedding_vector FROM query_embedding)) as similarity
        FROM songs
        WHERE embedding_vector IS NOT NULL
          AND is_placeholder = false
        ORDER BY embedding_vector <=> (SELECT embedding_vector FROM query_embedding)
        LIMIT 3
      `;

      logger.info('  Results:');
      for (const result of testQuery) {
        logger.info(`    ${result.title} — ${result.artist} (similarity: ${(result.similarity * 100).toFixed(1)}%)`);
      }
    } catch (error: any) {
      logger.warn({ error: error.message }, '  Could not run similarity query');
    }

    logger.info('\n' + '='.repeat(60));
    logger.info('');

    // Warnings
    const placeholderCount = Number(placeholderStats.find(p => p.is_placeholder)?.count || 0);
    if (placeholderCount > 0) {
      logger.warn(`⚠️  WARNING: ${placeholderCount} placeholder songs detected`);
      logger.warn('⚠️  Run: pnpm catalog:safety to see details\n');
    }

    const missingEmbeddings = Number(embeddingCoverage.find(e => !e.has_embedding)?.count || 0);
    if (missingEmbeddings > 0) {
      logger.warn(`⚠️  WARNING: ${missingEmbeddings} songs missing embeddings`);
      logger.warn('⚠️  Run: pnpm catalog:embed to generate embeddings\n');
    }

    if (placeholderCount === 0 && missingEmbeddings === 0) {
      logger.info('✅ Catalog is healthy!\n');
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Stats query failed');
  process.exit(1);
});
