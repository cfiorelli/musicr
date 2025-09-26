import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import { pipeline } from '@huggingface/transformers';

// Initialize the same embedding model used in seeding
let embedder: any = null;

async function initializeEmbedder() {
  try {
    logger.info('Loading embedding model...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    logger.info('✅ Embedding model loaded');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize embedding model');
    throw error;
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!embedder) {
    throw new Error('Embedder not initialized');
  }

  try {
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data) as number[];
  } catch (error) {
    logger.error({ error }, 'Failed to generate embedding');
    throw error;
  }
}

async function findSimilarSongs(query: string, limit: number = 5) {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    
    // Use pgvector cosine similarity search
    const results = await prisma.$queryRaw`
      SELECT 
        id,
        title,
        artist,
        year,
        popularity,
        tags,
        phrases,
        embedding <=> ${queryEmbedding}::vector as similarity
      FROM songs 
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${queryEmbedding}::vector
      LIMIT ${limit}
    `;

    return results;
  } catch (error) {
    logger.error({ error }, 'Failed to search for similar songs');
    throw error;
  }
}

async function testSimilaritySearch() {
  try {
    await prisma.$connect();
    await initializeEmbedder();
    
    const testQueries = [
      "I'm feeling sad and lonely",
      "Let's party and dance all night",
      "Missing someone I love", 
      "Feeling confident and strong",
      "Road trip with friends"
    ];

    for (const query of testQueries) {
      logger.info(`\n🔍 Testing query: "${query}"`);
      const results = await findSimilarSongs(query, 3);
      
      (results as any[]).forEach((song: any, index: number) => {
        logger.info(`${index + 1}. "${song.title}" by ${song.artist} (${song.year}) - Similarity: ${song.similarity.toFixed(3)}`);
        logger.info(`   Tags: ${song.tags.join(', ')}`);
        logger.info(`   Phrases: ${song.phrases.slice(0, 2).join(', ')}...`);
      });
    }

  } catch (error) {
    logger.error({ error }, 'Test failed');
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testSimilaritySearch();