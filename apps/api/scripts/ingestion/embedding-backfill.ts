import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { logger } from '../../src/config/index.js';
import { pipeline } from '@xenova/transformers';

/**
 * Embedding Backfill Script (Local Model)
 *
 * Generates embeddings using Xenova/all-MiniLM-L6-v2 (same model as runtime)
 * for ALL songs, replacing any prior OpenAI embeddings.
 *
 * Flags:
 *   --all          Re-embed every song (default: only WHERE embedding_vector IS NULL)
 *   --clear-jsonb  NULL out the legacy JSONB embedding column to reclaim storage
 *   --dry-run      Preview without writing
 *   --limit=N      Process at most N songs
 *   --batch=N      Batch size (default 64)
 */

let embedder: any = null;

async function initEmbedder(): Promise<void> {
  logger.info('Loading Xenova/all-MiniLM-L6-v2 model...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  logger.info('Model loaded');
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const output = await embedder(texts, { pooling: 'mean', normalize: true });

  // output.data is a flat Float32Array, reshape into per-text vectors
  const dims = 384;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * dims;
    results.push(Array.from(output.data.slice(start, start + dims)));
  }
  return results;
}

function generateEmbeddingText(song: {
  title: string;
  artist: string;
  album?: string | null;
  tags: string[];
}): string {
  const parts = [song.title, song.artist];
  if (song.album) parts.push(song.album);
  if (song.tags?.length) parts.push(song.tags.join(', '));
  return parts.join(' — ');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reAll = args.includes('--all');
  const clearJsonb = args.includes('--clear-jsonb');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  const batchArg = args.find(a => a.startsWith('--batch='));
  const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 64;

  await prisma.$connect();

  // --- Phase 1: Clear JSONB embedding column ---
  if (clearJsonb) {
    logger.info('Clearing JSONB embedding column to reclaim storage...');
    if (!dryRun) {
      const result = await prisma.$executeRaw`
        UPDATE songs SET embedding = NULL WHERE embedding IS NOT NULL
      `;
      logger.info({ rowsUpdated: result }, 'JSONB embedding column cleared');
    } else {
      const countRes = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM songs WHERE embedding IS NOT NULL
      `;
      logger.info({ wouldClear: Number(countRes[0].count) }, '[DRY RUN] Would clear JSONB embeddings');
    }
  }

  // --- Phase 2: Re-embed songs with local model ---
  const totalRows = reAll
    ? Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM songs`)[0].count)
    : Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM songs WHERE embedding_vector IS NULL`)[0].count);

  const total = limit ? Math.min(totalRows, limit) : totalRows;
  logger.info({ total, reAll, batchSize, dryRun }, 'Starting local-model embedding backfill');

  if (total === 0) {
    logger.info('Nothing to embed');
    await prisma.$disconnect();
    return;
  }

  if (!dryRun) {
    await initEmbedder();
  }

  let processed = 0;
  let errors = 0;
  let offset = 0;
  const startTime = Date.now();

  while (processed < total) {
    const songs = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      artist: string;
      album: string | null;
      tags: string[];
    }>>(
      `SELECT id, title, artist, album, tags
       FROM songs
       WHERE ${reAll ? 'TRUE' : 'embedding_vector IS NULL'}
       ORDER BY "createdAt" ASC
       LIMIT $1 OFFSET $2`,
      batchSize,
      reAll ? offset : 0  // When re-all, use offset; otherwise rows disappear after update
    );

    if (songs.length === 0) break;

    const texts = songs.map(s => generateEmbeddingText(s));

    if (dryRun) {
      processed += songs.length;
      offset += songs.length;
      logger.info({ processed, total, sample: texts[0] }, '[DRY RUN] Would embed batch');
      continue;
    }

    try {
      const embeddings = await embedBatch(texts);

      // Batch UPDATE using a single VALUES list for minimal round-trips
      const valueRows = songs.map((s, i) => {
        const vec = `'[${embeddings[i].join(',')}]'::vector`;
        return `('${s.id}'::uuid, ${vec})`;
      }).join(',\n');

      await prisma.$executeRawUnsafe(`
        UPDATE songs AS s
        SET embedding_vector = v.vec, "updatedAt" = NOW()
        FROM (VALUES ${valueRows}) AS v(id, vec)
        WHERE s.id = v.id
      `);

      processed += songs.length;
      offset += songs.length;
    } catch (err: any) {
      logger.error({ error: err.message }, 'Batch failed');
      errors += songs.length;
      offset += songs.length;
    }

    // Progress logging every batch
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const eta = ((total - processed) / rate).toFixed(0);
    const pct = ((processed / total) * 100).toFixed(1);
    logger.info({
      progress: `${processed}/${total} (${pct}%)`,
      rate: `${rate.toFixed(1)} songs/s`,
      eta: `${eta}s`,
      errors
    }, 'Backfill progress');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info('='.repeat(60));
  logger.info('LOCAL-MODEL EMBEDDING BACKFILL SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Model:     Xenova/all-MiniLM-L6-v2 (384-dim)`);
  logger.info(`Total:     ${total}`);
  logger.info(`Processed: ${processed}`);
  logger.info(`Errors:    ${errors}`);
  logger.info(`Time:      ${elapsed}s`);
  logger.info(`Mode:      ${dryRun ? 'DRY RUN' : 'LIVE'}${reAll ? ' (--all)' : ''}${clearJsonb ? ' (--clear-jsonb)' : ''}`);
  logger.info('='.repeat(60));

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Backfill failed');
  process.exit(1);
});
