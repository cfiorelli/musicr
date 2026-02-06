import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { getEmbeddingService } from '../src/embeddings/index.js';
import { logger } from '../src/config/index.js';

/**
 * Test direct vector queries without HNSW optimization
 * to isolate whether the issue is with the index or the query itself
 */
async function testDirectVectorQuery() {
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

  // Test both "pizza night" and "home"
  const testInputs = ['pizza night', 'home'];

  for (const input of testInputs) {
    logger.info(`\n${'='.repeat(80)}`);
    logger.info(`Testing: "${input}"`);
    logger.info('='.repeat(80));

    const embedding = await embeddingService.embedSingle(input);
    const embeddingString = `[${embedding.join(',')}]`;

    logger.info({
      input,
      embeddingDims: embedding.length,
      embeddingStringLength: embeddingString.length
    }, 'Generated embedding');

    // Test 1: WITH HNSW index (current production query)
    logger.info('\n--- Test 1: WITH HNSW index (ef_search = 100) ---');
    await prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = 100`);

    const resultsWithIndex = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      artist: string;
      similarity: number;
    }>>`
      SELECT
        id,
        title,
        artist,
        (embedding_vector <=> ${embeddingString}::vector) * -1 + 1 as similarity
      FROM public.songs
      WHERE embedding_vector IS NOT NULL
        AND is_placeholder = false
      ORDER BY embedding_vector <=> ${embeddingString}::vector
      LIMIT 10
    `;

    logger.info({
      count: resultsWithIndex.length,
      first: resultsWithIndex[0] ? {
        title: resultsWithIndex[0].title,
        artist: resultsWithIndex[0].artist,
        similarity: resultsWithIndex[0].similarity
      } : null
    }, 'Results WITH index');

    // Test 2: WITHOUT HNSW index (disable with set_enable_seqscan)
    logger.info('\n--- Test 2: WITHOUT HNSW index (force sequential scan) ---');
    await prisma.$executeRawUnsafe(`SET LOCAL enable_indexscan = OFF`);
    await prisma.$executeRawUnsafe(`SET LOCAL enable_bitmapscan = OFF`);

    const resultsWithoutIndex = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      artist: string;
      similarity: number;
    }>>`
      SELECT
        id,
        title,
        artist,
        (embedding_vector <=> ${embeddingString}::vector) * -1 + 1 as similarity
      FROM public.songs
      WHERE embedding_vector IS NOT NULL
        AND is_placeholder = false
      ORDER BY embedding_vector <=> ${embeddingString}::vector
      LIMIT 10
    `;

    logger.info({
      count: resultsWithoutIndex.length,
      first: resultsWithoutIndex[0] ? {
        title: resultsWithoutIndex[0].title,
        artist: resultsWithoutIndex[0].artist,
        similarity: resultsWithoutIndex[0].similarity
      } : null
    }, 'Results WITHOUT index (sequential scan)');

    // Reset settings
    await prisma.$executeRawUnsafe(`RESET enable_indexscan`);
    await prisma.$executeRawUnsafe(`RESET enable_bitmapscan`);

    // Test 3: Check if there are ANY vectors in the database (sanity check)
    const sampleVectors = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      artist: string;
      dims: number;
    }>>`
      SELECT
        id,
        title,
        artist,
        vector_dims(embedding_vector) as dims
      FROM public.songs
      WHERE embedding_vector IS NOT NULL
        AND is_placeholder = false
      LIMIT 5
    `;

    logger.info({
      sampleCount: sampleVectors.length,
      samples: sampleVectors
    }, 'Sample vectors in database');
  }

  await prisma.$disconnect();
}

testDirectVectorQuery().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Test failed');
  process.exit(1);
});
