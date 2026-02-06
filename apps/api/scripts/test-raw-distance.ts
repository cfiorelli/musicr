import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { getEmbeddingService } from '../src/embeddings/index.js';
import { logger } from '../src/config/index.js';

/**
 * Test if distance calculation works at all for "pizza night"
 * Try different approaches to isolate the issue
 */
async function testRawDistance() {
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

  // Get "pizza night" embedding
  const pizzaEmbedding = await embeddingService.embedSingle('pizza night');
  const pizzaVector = `[${pizzaEmbedding.join(',')}]`;

  logger.info({
    embeddingLength: pizzaEmbedding.length,
    vectorStringLength: pizzaVector.length,
    first5: pizzaEmbedding.slice(0, 5)
  }, 'Pizza night embedding generated');

  // Test 1: Get a single known song's embedding and calculate distance manually
  logger.info('\n--- Test 1: Get a known song and calculate distance ---');
  const knownSong = await prisma.song.findFirst({
    where: {
      title: 'Bohemian Rhapsody',
      artist: 'Queen'
    }
  });

  if (knownSong) {
    logger.info({
      title: knownSong.title,
      artist: knownSong.artist,
      hasEmbedding: knownSong.embeddingVector !== null
    }, 'Found Bohemian Rhapsody');

    // Try to calculate distance using raw SQL
    const distanceResult = await prisma.$queryRawUnsafe<Array<{
      title: string;
      distance: number;
      similarity: number;
    }>>(`
      SELECT
        title,
        embedding_vector <=> '${pizzaVector}'::vector as distance,
        (embedding_vector <=> '${pizzaVector}'::vector) * -1 + 1 as similarity
      FROM public.songs
      WHERE id = '${knownSong.id}'
    `);

    logger.info({
      result: distanceResult[0]
    }, 'Distance calculation for Bohemian Rhapsody');
  }

  // Test 2: Try WITHOUT casting to ::vector (let PostgreSQL infer)
  logger.info('\n--- Test 2: Query WITHOUT ::vector cast ---');
  try {
    const results2 = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      artist: string;
    }>>(`
      SELECT id, title, artist
      FROM public.songs
      WHERE embedding_vector IS NOT NULL
        AND is_placeholder = false
      LIMIT 5
    `);

    logger.info({
      count: results2.length,
      samples: results2
    }, 'Basic query without distance calculation');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Basic query failed');
  }

  // Test 3: Try with explicit vector dimensions
  logger.info('\n--- Test 3: Query with explicit vector(384) cast ---');
  try {
    const results3 = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      artist: string;
      distance: number;
    }>>(`
      SELECT
        id,
        title,
        artist,
        embedding_vector <=> '${pizzaVector}'::vector(384) as distance
      FROM public.songs
      WHERE embedding_vector IS NOT NULL
        AND is_placeholder = false
      ORDER BY embedding_vector <=> '${pizzaVector}'::vector(384)
      LIMIT 10
    `);

    logger.info({
      count: results3.length,
      first: results3[0]
    }, 'Query with vector(384) cast');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Query with vector(384) cast failed');
  }

  // Test 4: Check if the vector literal is valid by inserting into a temp table
  logger.info('\n--- Test 4: Validate vector literal by inserting into temp table ---');
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE IF NOT EXISTS test_vectors (
        id SERIAL PRIMARY KEY,
        vec vector(384)
      )
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO test_vectors (vec) VALUES ('${pizzaVector}'::vector(384))
    `);

    const insertedVector = await prisma.$queryRawUnsafe<Array<{
      dims: number;
    }>>(`
      SELECT vector_dims(vec) as dims
      FROM test_vectors
      LIMIT 1
    `);

    logger.info({
      inserted: true,
      dims: insertedVector[0]?.dims
    }, 'Vector literal is valid and can be inserted');

    // Now try distance calculation using the temp table
    const tempDistance = await prisma.$queryRawUnsafe<Array<{
      title: string;
      artist: string;
      distance: number;
    }>>(`
      SELECT
        s.title,
        s.artist,
        s.embedding_vector <=> t.vec as distance
      FROM public.songs s
      CROSS JOIN test_vectors t
      WHERE s.embedding_vector IS NOT NULL
        AND s.is_placeholder = false
      ORDER BY s.embedding_vector <=> t.vec
      LIMIT 10
    `);

    logger.info({
      count: tempDistance.length,
      first: tempDistance[0]
    }, 'Distance calculation using temp table');

  } catch (error: any) {
    logger.error({ error: error.message }, 'Temp table test failed');
  }

  await prisma.$disconnect();
}

testRawDistance().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Test failed');
  process.exit(1);
});
