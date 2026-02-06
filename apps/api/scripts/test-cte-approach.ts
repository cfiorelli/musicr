import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { getEmbeddingService } from '../src/embeddings/index.js';
import { logger } from '../src/config/index.js';

/**
 * Test CTE approach directly
 */
async function testCTEApproach() {
  logger.info('Initializing embedding service...');
  await getEmbeddingService({
    primaryProvider: 'local',
    fallbackProvider: 'openai',
    local: {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384
    },
    openai: process.env.OPENAI_API_KEY ? {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
      dimensions: 384
    } : undefined
  });

  const embeddingService = await getEmbeddingService();
  const pizzaEmbedding = await embeddingService.embedSingle('pizza night');
  const pizzaVector = `[${pizzaEmbedding.join(',')}]`;

  // Test different CTE approaches
  logger.info('\n--- Test 1: CTE with vector(384) ---');
  try {
    const results1 = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      artist: string;
      similarity: number;
    }>>(`
      WITH query_vector AS (
        SELECT '${pizzaVector}'::vector(384) as vec
      )
      SELECT
        s.id,
        s.title,
        s.artist,
        (s.embedding_vector <=> q.vec) * -1 + 1 as similarity
      FROM public.songs s
      CROSS JOIN query_vector q
      WHERE s.embedding_vector IS NOT NULL
        AND s.is_placeholder = false
      ORDER BY s.embedding_vector <=> q.vec
      LIMIT 10
    `);

    logger.info({
      count: results1.length,
      first: results1[0]
    }, 'CTE with vector(384) results');
  } catch (error: any) {
    logger.error({ error: error.message }, 'CTE with vector(384) failed');
  }

  // Test 2: CTE without explicit dimensions
  logger.info('\n--- Test 2: CTE with just ::vector ---');
  try {
    const results2 = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      artist: string;
      similarity: number;
    }>>(`
      WITH query_vector AS (
        SELECT '${pizzaVector}'::vector as vec
      )
      SELECT
        s.id,
        s.title,
        s.artist,
        (s.embedding_vector <=> q.vec) * -1 + 1 as similarity
      FROM public.songs s
      CROSS JOIN query_vector q
      WHERE s.embedding_vector IS NOT NULL
        AND s.is_placeholder = false
      ORDER BY s.embedding_vector <=> q.vec
      LIMIT 10
    `);

    logger.info({
      count: results2.length,
      first: results2[0]
    }, 'CTE with ::vector results');
  } catch (error: any) {
    logger.error({ error: error.message }, 'CTE with ::vector failed');
  }

  // Test 3: Session-level variable approach
  logger.info('\n--- Test 3: Session-level temp table ---');
  try {
    // Create temp table
    await prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE IF NOT EXISTS query_vec (vec vector(384))
    `);

    // Clear any existing data
    await prisma.$executeRawUnsafe(`DELETE FROM query_vec`);

    // Insert query vector
    await prisma.$executeRawUnsafe(`
      INSERT INTO query_vec (vec) VALUES ('${pizzaVector}'::vector(384))
    `);

    // Query using temp table
    const results3 = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      artist: string;
      similarity: number;
    }>>(`
      SELECT
        s.id,
        s.title,
        s.artist,
        (s.embedding_vector <=> q.vec) * -1 + 1 as similarity
      FROM public.songs s
      CROSS JOIN query_vec q
      WHERE s.embedding_vector IS NOT NULL
        AND s.is_placeholder = false
      ORDER BY s.embedding_vector <=> q.vec
      LIMIT 10
    `);

    logger.info({
      count: results3.length,
      first: results3[0]
    }, 'Temp table results');
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Temp table approach failed');
  }

  await prisma.$disconnect();
}

testCTEApproach().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Test failed');
  process.exit(1);
});
