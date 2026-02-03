import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { logger } from '../../src/config/index.js';
import OpenAI from 'openai';

/**
 * Embedding Backfill Script
 *
 * Generates OpenAI embeddings for songs missing embedding_vector.
 * Features:
 * - Batched processing (50 songs at a time)
 * - Rate limiting
 * - Dry-run mode
 * - Progress tracking
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface EmbeddingStats {
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  cost: number; // Estimated cost in USD
}

class EmbeddingBackfill {
  private stats: EmbeddingStats = {
    total: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    cost: 0
  };
  private dryRun: boolean;
  private batchSize: number;

  constructor(dryRun = false, batchSize = 50) {
    this.dryRun = dryRun;
    this.batchSize = batchSize;
  }

  /**
   * Generate embedding text from song metadata
   */
  private generateEmbeddingText(song: {
    title: string;
    artist: string;
    album?: string | null;
    tags: string[];
  }): string {
    const parts = [
      song.title,
      song.artist
    ];

    if (song.album) {
      parts.push(song.album);
    }

    if (song.tags && song.tags.length > 0) {
      parts.push(song.tags.join(', '));
    }

    return parts.join(' — ');
  }

  /**
   * Generate embedding using OpenAI API
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float'
      });

      return response.data[0].embedding;
    } catch (error: any) {
      logger.error({ error: error.message, text }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Process a batch of songs
   */
  private async processBatch(songs: Array<{
    id: string;
    title: string;
    artist: string;
    album: string | null;
    tags: string[];
  }>): Promise<void> {
    logger.info({ count: songs.length }, 'Processing batch');

    for (const song of songs) {
      try {
        // Generate embedding text
        const text = this.generateEmbeddingText(song);

        if (this.dryRun) {
          logger.info({ id: song.id, title: song.title, text }, '[DRY RUN] Would generate embedding');
          this.stats.processed++;
          continue;
        }

        // Generate embedding
        const embedding = await this.generateEmbedding(text);
        const embeddingString = `[${embedding.join(',')}]`;

        // Update song with native vector
        await prisma.$executeRaw`
          UPDATE songs
          SET embedding_vector = ${embeddingString}::vector,
              embedding = ${JSON.stringify(embedding)}::jsonb,
              updated_at = NOW()
          WHERE id = ${song.id}::uuid
        `;

        logger.info({ id: song.id, title: song.title, artist: song.artist }, 'Generated embedding');

        this.stats.processed++;
        this.stats.cost += 0.00002; // $0.00002 per embedding (text-embedding-3-small pricing)

        // Rate limit: ~50 requests per minute
        await this.sleep(1200);

      } catch (error: any) {
        logger.error({ error: error.message, song }, 'Failed to process song');
        this.stats.errors++;
      }
    }
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Backfill embeddings for all missing songs
   */
  async backfillAll(limit?: number): Promise<void> {
    logger.info({ dryRun: this.dryRun, batchSize: this.batchSize, limit }, 'Starting embedding backfill');

    await prisma.$connect();

    try {
      // Count songs missing embeddings
      const countResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count
        FROM songs
        WHERE embedding_vector IS NULL
      `;

      const totalMissing = Number(countResult[0].count);
      this.stats.total = limit ? Math.min(totalMissing, limit) : totalMissing;

      logger.info({ total: this.stats.total, totalMissing }, 'Found songs missing embeddings');

      if (this.stats.total === 0) {
        logger.info('No songs need embedding generation');
        return;
      }

      // Process in batches
      let offset = 0;
      while (offset < this.stats.total) {
        const currentLimit = Math.min(this.batchSize, this.stats.total - offset);

        // Fetch batch of songs
        const songs = await prisma.song.findMany({
          where: {
            embeddingVector: null
          },
          select: {
            id: true,
            title: true,
            artist: true,
            album: true,
            tags: true
          },
          take: currentLimit,
          skip: offset
        });

        if (songs.length === 0) {
          break;
        }

        await this.processBatch(songs);

        offset += songs.length;

        // Log progress
        const percentComplete = ((this.stats.processed + this.stats.skipped + this.stats.errors) / this.stats.total * 100).toFixed(1);
        logger.info({
          progress: `${this.stats.processed + this.stats.skipped + this.stats.errors}/${this.stats.total}`,
          percent: percentComplete,
          processed: this.stats.processed,
          errors: this.stats.errors,
          estimatedCost: `$${this.stats.cost.toFixed(4)}`
        }, 'Backfill progress');
      }

      logger.info({
        processed: this.stats.processed,
        errors: this.stats.errors,
        cost: `$${this.stats.cost.toFixed(4)}`,
        dryRun: this.dryRun
      }, 'Backfill complete');

    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Get backfill statistics
   */
  getStats(): EmbeddingStats {
    return this.stats;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  const batchSizeArg = args.find(arg => arg.startsWith('--batch='));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 50;

  if (!process.env.OPENAI_API_KEY && !dryRun) {
    logger.error('OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  const backfill = new EmbeddingBackfill(dryRun, batchSize);
  await backfill.backfillAll(limit);

  const stats = backfill.getStats();

  logger.info('='.repeat(60));
  logger.info('EMBEDDING BACKFILL SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Total:     ${stats.total}`);
  logger.info(`Processed: ${stats.processed}`);
  logger.info(`Errors:    ${stats.errors}`);
  logger.info(`Cost:      $${stats.cost.toFixed(4)}`);
  logger.info(`Mode:      ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  logger.info('='.repeat(60));

  process.exit(0);
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Backfill failed');
  process.exit(1);
});
