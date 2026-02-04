import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import { pipeline } from '@xenova/transformers';

async function reembedOldSongs() {
  try {
    logger.info('🔄 Starting re-embedding process for old songs...');

    // Find songs with embeddings but no vector (old 1536-dim embeddings)
    const songsToReembed = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      artist: string;
      year: number | null;
      tags: string[];
      phrases: string[];
    }>>`
      SELECT id, title, artist, year, tags, phrases
      FROM songs
      WHERE embedding IS NOT NULL
        AND embedding_vector IS NULL
      ORDER BY popularity DESC
    `;

    if (songsToReembed.length === 0) {
      logger.info('✅ No songs need re-embedding');
      return;
    }

    logger.info(`Found ${songsToReembed.length} songs to re-embed`);

    // Initialize the embedding model
    logger.info('Loading embedding model...');
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    logger.info('✅ Embedding model loaded');

    let processed = 0;
    let failed = 0;

    for (const song of songsToReembed) {
      try {
        // Create searchable text (same format as seeding)
        const searchText = [
          `${song.title} by ${song.artist}`,
          `Song: ${song.title}`,
          `Artist: ${song.artist}`,
          song.year ? `Year: ${song.year}` : '',
          song.tags.join(' '),
          song.phrases.join(' ')
        ].filter(Boolean).join(' ').toLowerCase();

        // Generate new 384-dim embedding
        const result = await embedder(searchText, { pooling: 'mean', normalize: true });
        const embedding = Array.from(result.data);

        // Update the song with new embedding
        await prisma.song.update({
          where: { id: song.id },
          data: {
            embedding: embedding
          }
        });

        processed++;

        if (processed % 10 === 0) {
          logger.info(`Re-embedded ${processed}/${songsToReembed.length} songs...`);
        }

      } catch (error) {
        logger.error({ error, song: { title: song.title, artist: song.artist } }, 'Failed to re-embed song');
        failed++;
      }
    }

    logger.info(`✅ Re-embedding complete: ${processed} succeeded, ${failed} failed`);

    // Now backfill the vector column
    logger.info('🔄 Backfilling pgvector column...');
    await prisma.$executeRaw`
      UPDATE songs
      SET embedding_vector = (embedding::text)::vector
      WHERE embedding IS NOT NULL
        AND embedding_vector IS NULL
        AND jsonb_typeof(embedding) = 'array'
        AND jsonb_array_length(embedding) = 384
    `;

    logger.info('✅ Pgvector backfill complete');

    // Verify results
    const stats = await prisma.$queryRaw<Array<{
      total: bigint;
      with_vector: bigint;
      missing_vector: bigint;
    }>>`
      SELECT
        COUNT(*) as total,
        COUNT(embedding_vector) as with_vector,
        COUNT(CASE WHEN embedding_vector IS NULL AND embedding IS NOT NULL THEN 1 END) as missing_vector
      FROM songs
    `;

    const result = stats[0];
    logger.info({
      totalSongs: Number(result.total),
      withVector: Number(result.with_vector),
      missingVector: Number(result.missing_vector),
      coverage: ((Number(result.with_vector) / Number(result.total)) * 100).toFixed(1) + '%'
    }, '📊 Final statistics');

  } catch (error) {
    logger.error({ error }, '❌ Re-embedding failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

reembedOldSongs().catch((error) => {
  logger.error({ error }, 'Unhandled error in re-embedding process');
  process.exit(1);
});
