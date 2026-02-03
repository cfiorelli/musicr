import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import OpenAI from 'openai';

/**
 * Backfill Embeddings Script
 *
 * Generates embeddings for all songs that don't have them yet.
 * Uses OpenAI text-embedding-3-small model (1536 dimensions).
 *
 * Usage:
 *   DATABASE_URL="..." OPENAI_API_KEY="..." pnpm tsx scripts/backfill-embeddings.ts
 */

interface Song {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  tags: string[];
  phrases: string[];
  embedding: any;
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function createSearchableText(song: Song): string {
  // Create a comprehensive text representation for embedding
  const parts = [
    `${song.title} by ${song.artist}`,
    `Song: ${song.title}`,
    `Artist: ${song.artist}`
  ];

  if (song.year) {
    parts.push(`Year: ${song.year}`);
  }

  if (song.tags.length > 0) {
    parts.push(song.tags.join(' '));
  }

  if (song.phrases.length > 0) {
    parts.push(song.phrases.join(' '));
  }

  return parts.join(' ').toLowerCase();
}

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float'
    });

    return response.data[0].embedding;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to generate embedding via OpenAI');
    throw error;
  }
}

async function backfillEmbeddings() {
  try {
    logger.info('🔄 Starting embedding backfill process...');

    // Check if OPENAI_API_KEY is set
    if (!process.env.OPENAI_API_KEY) {
      logger.error('❌ OPENAI_API_KEY environment variable is not set');
      process.exit(1);
    }

    // Connect to database
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Get all songs
    const allSongs = await prisma.song.findMany({
      select: {
        id: true,
        title: true,
        artist: true,
        year: true,
        tags: true,
        phrases: true,
        embedding: true
      }
    });

    // Filter songs without embeddings in JavaScript
    const songsWithoutEmbeddings = allSongs.filter(song =>
      !song.embedding ||
      (Array.isArray(song.embedding) && song.embedding.length === 0) ||
      (typeof song.embedding === 'object' && Object.keys(song.embedding).length === 0)
    );

    logger.info(`Found ${songsWithoutEmbeddings.length} songs without embeddings`);

    if (songsWithoutEmbeddings.length === 0) {
      logger.info('✅ All songs already have embeddings!');
      return;
    }

    let processed = 0;
    let failed = 0;

    for (const song of songsWithoutEmbeddings) {
      try {
        const searchText = createSearchableText(song);
        const embedding = await generateEmbedding(searchText);

        await prisma.song.update({
          where: { id: song.id },
          data: { embedding }
        });

        processed++;

        if (processed % 10 === 0) {
          logger.info(`Progress: ${processed}/${songsWithoutEmbeddings.length} embeddings generated`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error: any) {
        failed++;
        logger.error({
          song: `${song.title} by ${song.artist}`,
          error: error.message
        }, 'Failed to generate embedding for song');

        // Continue with next song instead of failing completely
        continue;
      }
    }

    logger.info('');
    logger.info('='.repeat(80));
    logger.info(`✅ Backfill complete!`);
    logger.info(`   Processed: ${processed} songs`);
    logger.info(`   Failed: ${failed} songs`);
    logger.info(`   Success rate: ${((processed / songsWithoutEmbeddings.length) * 100).toFixed(1)}%`);
    logger.info('='.repeat(80));

    // Verify final state
    const totalSongs = await prisma.song.count();
    const songsWithEmbeddings = await prisma.song.count({
      where: { embedding: { not: null } }
    });

    logger.info('');
    logger.info('Final State:');
    logger.info(`  Total songs: ${totalSongs}`);
    logger.info(`  Songs with embeddings: ${songsWithEmbeddings}`);
    logger.info(`  Coverage: ${((songsWithEmbeddings / totalSongs) * 100).toFixed(1)}%`);

  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Backfill failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

backfillEmbeddings();
