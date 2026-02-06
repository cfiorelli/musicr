import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { SongMatchingService } from '../src/services/song-matching-service.js';
import { logger } from '../src/config/index.js';

/**
 * Quick test to verify semantic matching works with embeddings
 */
async function testSemanticMatching() {
  const service = new SongMatchingService(prisma);

  const testQueries = [
    "I'm feeling happy and energetic",
    "Something sad and melancholic",
    "Rock music for working out"
  ];

  logger.info('Testing semantic matching with sample queries...');

  for (const query of testQueries) {
    try {
      const result = await service.matchSongs(query);

      logger.info({
        query,
        match: {
          title: result.primary.title,
          artist: result.primary.artist,
          score: result.scores.confidence,
          similarity: result.why.similarity,
          strategy: result.scores.strategy
        }
      }, 'Match found');
    } catch (error: any) {
      logger.error({ error: error.message, query }, 'Match failed');
    }
  }

  await prisma.$disconnect();
}

testSemanticMatching().catch((error) => {
  logger.error({ error: error.message }, 'Test failed');
  process.exit(1);
});
