import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { SongMatchingService } from '../src/services/song-matching-service.js';
import { getEmbeddingService } from '../src/embeddings/index.js';
import { logger } from '../src/config/index.js';

/**
 * Test script to debug why many inputs return Bohemian Rhapsody
 */
async function testMatching() {
  // Initialize embedding service first (CRITICAL)
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

  const testInputs = [
    "home",
    "pizza night",
    "you give me the creeps",
    "heavy deadlifts",
    "radiator leaking",
    "wedding day",
    "minecraft creeper"
  ];

  logger.info('Testing song matching with problem inputs...');
  logger.info('DEBUG_MATCHING is ' + (process.env.DEBUG_MATCHING === '1' ? 'ENABLED' : 'DISABLED'));

  const results = [];

  for (const input of testInputs) {
    try {
      logger.info(`\n${'='.repeat(80)}`);
      logger.info(`Testing input: "${input}"`);
      logger.info('='.repeat(80));

      const result = await service.matchSongs(input);

      const summary = {
        input,
        song: `${result.primary.title} — ${result.primary.artist}`,
        similarity: result.why.similarity?.toFixed(4) || 'N/A',
        confidence: result.scores.confidence.toFixed(4),
        strategy: result.scores.strategy
      };

      results.push(summary);

      logger.info({
        ...summary,
        alternates_count: result.alternates.length
      }, 'Match result');

    } catch (error: any) {
      logger.error({ error: error.message, input }, 'Match failed');
      results.push({
        input,
        error: error.message
      });
    }
  }

  logger.info('\n\n' + '='.repeat(80));
  logger.info('SUMMARY TABLE');
  logger.info('='.repeat(80));
  console.table(results);

  await prisma.$disconnect();
}

testMatching().catch((error) => {
  logger.error({ error: error.message }, 'Test failed');
  process.exit(1);
});
