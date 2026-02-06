import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { SongMatchingService } from '../src/services/song-matching-service.js';
import { getEmbeddingService } from '../src/embeddings/index.js';
import { logger } from '../src/config/index.js';

/**
 * Reproduction script for "pizza night" returning 0 semantic results
 * Tests multiple times to check for ordering/pooling issues
 */
async function reproduceIssue() {
  logger.info('='.repeat(80));
  logger.info('REPRODUCTION SCRIPT: pizza night vs home');
  logger.info('='.repeat(80));

  // Initialize embedding service first
  logger.info('Initializing embedding service...');
  try {
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
    logger.info('✅ Embedding service initialized');
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Embedding service initialization FAILED');
    throw error;
  }

  const service = new SongMatchingService(prisma);

  // Test sequence: pizza night -> home -> pizza night again
  const testSequence = [
    { input: 'pizza night', iteration: 1 },
    { input: 'home', iteration: 1 },
    { input: 'pizza night', iteration: 2 }
  ];

  logger.info('\nTesting sequence to detect ordering/pooling issues...\n');

  for (const test of testSequence) {
    logger.info('='.repeat(80));
    logger.info(`TEST: "${test.input}" (iteration ${test.iteration})`);
    logger.info('='.repeat(80));

    try {
      const result = await service.matchSongs(test.input);

      logger.info({
        input: test.input,
        iteration: test.iteration,
        matched_song: `${result.primary.title} — ${result.primary.artist}`,
        similarity: result.why.similarity?.toFixed(4) || 'N/A',
        confidence: result.scores.confidence.toFixed(4),
        strategy: result.scores.strategy,
        alternates_count: result.alternates.length
      }, 'Match result');

    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        input: test.input,
        iteration: test.iteration
      }, 'Match FAILED');
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info('\n' + '='.repeat(80));
  logger.info('REPRODUCTION COMPLETE');
  logger.info('='.repeat(80));

  await prisma.$disconnect();
}

reproduceIssue().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Reproduction script failed');
  process.exit(1);
});
