import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import OpenAI from 'openai';

/**
 * Performance test for native vector vs JSONB embedding queries
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testVectorPerformance() {
  logger.info('🧪 Testing vector query performance...\n');

  try {
    await prisma.$connect();

    // Generate test embedding
    const testQuery = "feeling happy and energetic";
    logger.info(`Generating embedding for: "${testQuery}"`);

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: testQuery,
      encoding_format: 'float'
    });

    const embedding = response.data[0].embedding;
    const embeddingString = `[${embedding.join(',')}]`;

    // Test 1: Native vector query (with HNSW index)
    logger.info('\n--- Test 1: Native Vector Column (HNSW index) ---');
    const nativeStart = Date.now();
    const nativeResults = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      artist: string;
      distance: number;
    }>>`
      SELECT
        id,
        title,
        artist,
        embedding_vector <=> ${embeddingString}::vector as distance
      FROM songs
      WHERE embedding_vector IS NOT NULL
      ORDER BY embedding_vector <=> ${embeddingString}::vector
      LIMIT 10
    `;
    const nativeTime = Date.now() - nativeStart;

    logger.info(`✅ Native vector query completed in ${nativeTime}ms`);
    logger.info(`   Results: ${nativeResults.length} songs`);
    logger.info(`   Top match: "${nativeResults[0]?.title}" by ${nativeResults[0]?.artist}`);

    // Test 2: JSONB casting query (no index)
    logger.info('\n--- Test 2: JSONB Cast (no index) ---');
    const jsonbStart = Date.now();
    const jsonbResults = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      artist: string;
      distance: number;
    }>>`
      SELECT
        id,
        title,
        artist,
        embedding::jsonb::text::vector <=> ${embeddingString}::vector as distance
      FROM songs
      WHERE embedding IS NOT NULL
      ORDER BY embedding::jsonb::text::vector <=> ${embeddingString}::vector
      LIMIT 10
    `;
    const jsonbTime = Date.now() - jsonbStart;

    logger.info(`✅ JSONB cast query completed in ${jsonbTime}ms`);
    logger.info(`   Results: ${jsonbResults.length} songs`);
    logger.info(`   Top match: "${jsonbResults[0]?.title}" by ${jsonbResults[0]?.artist}`);

    // Summary
    const speedup = (jsonbTime / nativeTime).toFixed(2);
    const improvement = (((jsonbTime - nativeTime) / jsonbTime) * 100).toFixed(1);

    logger.info('\n' + '='.repeat(60));
    logger.info('PERFORMANCE SUMMARY');
    logger.info('='.repeat(60));
    logger.info(`Native vector: ${nativeTime}ms`);
    logger.info(`JSONB cast:    ${jsonbTime}ms`);
    logger.info(`Speedup:       ${speedup}x faster`);
    logger.info(`Improvement:   ${improvement}% reduction in latency`);
    logger.info('='.repeat(60));

    // Verify results match
    const resultsMatch = nativeResults[0]?.id === jsonbResults[0]?.id;
    if (resultsMatch) {
      logger.info('✅ Top results match between both methods');
    } else {
      logger.warn('⚠️  Top results differ (may be due to floating point precision)');
    }

    logger.info('\n✅ Performance test complete!');

    // Exit with success if native is faster
    if (nativeTime < jsonbTime) {
      process.exit(0);
    } else {
      logger.error('❌ Native vector is not faster than JSONB!');
      process.exit(1);
    }

  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Performance test failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testVectorPerformance();
