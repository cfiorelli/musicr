import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { logger } from '../../src/config/index.js';
import { pipeline } from '@xenova/transformers';
import { generateAboutnessText } from '../../src/services/aboutness/openai.js';

/**
 * Aboutness OpenAI Pilot Script
 *
 * A controlled, reversible pilot that:
 *   A) Purges all metadata-derived (version=1) aboutness rows permanently
 *   B) Generates LLM aboutness for exactly 10 songs via OpenAI (title+artist only)
 *   C) Embeds each text using Xenova/all-MiniLM-L6-v2 (same model as runtime)
 *   D) Writes to DB as version=2, prints a review table, then DELETES the pilot rows
 *
 * The DB always ends clean: zero metadata-derived rows, zero pilot rows.
 *
 * Flags:
 *   --dry-run         Preview everything; no DB writes, no OpenAI calls
 *   --no-openai       Use placeholder text instead of calling OpenAI
 *   --skip-purge      Skip the metadata-derived purge step
 *
 * Default: purge runs unless --skip-purge or --dry-run.
 *
 * RUN:
 *   DATABASE_URL=<url> OPENAI_API_KEY=<key> \
 *     pnpm -C apps/api exec tsx scripts/ingestion/aboutness-backfill-openai-pilot.ts
 *
 * DRY RUN:
 *   DATABASE_URL=<url> \
 *     pnpm -C apps/api exec tsx scripts/ingestion/aboutness-backfill-openai-pilot.ts --dry-run
 */

const ABOUTNESS_VERSION = 2;
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMS = 384;
const PILOT_N = 10;

// ── Embedder ──────────────────────────────────────────────────────────────────

let embedder: any = null;

async function initEmbedder(): Promise<void> {
  logger.info({ model: EMBEDDING_MODEL }, 'Loading embedding model...');
  embedder = await pipeline('feature-extraction', EMBEDDING_MODEL);
  logger.info('Embedding model loaded');
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * DIMS;
    results.push(Array.from(output.data.slice(start, start + DIMS)));
  }
  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateDisplay(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 1) + '\u2026';
}

function printReviewTable(
  rows: Array<{
    title: string;
    artist: string;
    confidence: string;
    text: string;
  }>,
): void {
  const SEP = '─'.repeat(120);
  console.log('\n' + SEP);
  console.log('PILOT REVIEW TABLE — 10 LLM-generated aboutness profiles (version=2)');
  console.log(SEP);
  console.log(
    `${'#'.padEnd(3)} ${'Title'.padEnd(28)} ${'Artist'.padEnd(22)} ${'Conf'.padEnd(7)} ${'Text'}`,
  );
  console.log(SEP);
  rows.forEach((r, i) => {
    const num = String(i + 1).padEnd(3);
    const title = truncateDisplay(r.title, 28).padEnd(28);
    const artist = truncateDisplay(r.artist, 22).padEnd(22);
    const conf = r.confidence.padEnd(7);
    const text = truncateDisplay(r.text, 55);
    console.log(`${num} ${title} ${artist} ${conf} ${text}`);
  });
  console.log(SEP);
  console.log('Full texts:');
  console.log(SEP);
  rows.forEach((r, i) => {
    console.log(`\n[${i + 1}] "${r.title}" by ${r.artist} [confidence: ${r.confidence}]`);
    console.log(r.text);
  });
  console.log('\n' + SEP + '\n');
}

// ── Song row type ─────────────────────────────────────────────────────────────

interface SongRow {
  id: string;
  title: string;
  artist: string;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noOpenAI = args.includes('--no-openai');
  const skipPurge = args.includes('--skip-purge');

  logger.info(
    { dryRun, noOpenAI, skipPurge, pilotN: PILOT_N },
    'Aboutness OpenAI pilot starting',
  );

  if (dryRun) {
    logger.warn('DRY RUN — no DB writes, no OpenAI calls');
  }

  await prisma.$connect();

  // ── A. Purge metadata-derived rows ──────────────────────────────────────────

  const beforeCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM song_aboutness WHERE aboutness_version = 1
  `;
  const v1Count = Number(beforeCount[0]?.count ?? 0);

  logger.info({ v1Count }, 'Pre-purge: metadata-derived (version=1) rows');

  if (!skipPurge && !dryRun) {
    logger.info('Purging all version=1 (metadata-derived) rows...');
    const result = await prisma.$executeRaw`
      DELETE FROM song_aboutness WHERE aboutness_version = 1
    `;
    logger.info({ deleted: result }, 'Purge complete');
  } else if (skipPurge) {
    logger.info('Skipping purge (--skip-purge)');
  } else {
    logger.info(`[DRY RUN] Would delete ${v1Count} metadata-derived rows`);
  }

  const afterPurgeCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM song_aboutness WHERE aboutness_version = 1
  `;
  logger.info(
    { v1Count: Number(afterPurgeCount[0]?.count ?? 0) },
    'Post-purge: metadata-derived (version=1) rows',
  );

  // ── B. Select 10 songs missing version=2 ───────────────────────────────────

  const songs = await prisma.$queryRaw<SongRow[]>`
    SELECT s.id, s.title, s.artist
    FROM songs s
    LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${ABOUTNESS_VERSION}
    WHERE sa.song_id IS NULL
      AND s.is_placeholder = false
    ORDER BY s.id ASC
    LIMIT ${PILOT_N}
  `;

  if (songs.length === 0) {
    logger.info('No eligible songs found (all 10 already have version=2)');
    await prisma.$disconnect();
    return;
  }

  logger.info(
    { count: songs.length },
    `Selected ${songs.length} songs for LLM aboutness generation`,
  );

  // ── C. Generate text + embed ───────────────────────────────────────────────

  const pilotSongIds: string[] = [];
  const reviewRows: Array<{
    title: string;
    artist: string;
    confidence: string;
    text: string;
  }> = [];

  if (!dryRun) {
    await initEmbedder();
  }

  for (const song of songs) {
    let text: string;
    let confidence: 'low' | 'medium' | 'high';

    if (dryRun) {
      text = `[DRY RUN] "${song.title}" by ${song.artist} — no OpenAI call in dry-run mode. [confidence: low]`;
      confidence = 'low';
    } else if (noOpenAI) {
      text = `"${song.title}" by ${song.artist}. Placeholder text for --no-openai mode. [confidence: low]`;
      confidence = 'low';
    } else {
      logger.info({ title: song.title, artist: song.artist }, 'Calling OpenAI...');
      const result = await generateAboutnessText(song.title, song.artist);
      text = result.text;
      confidence = result.confidence;
    }

    reviewRows.push({ title: song.title, artist: song.artist, confidence, text });

    if (dryRun) continue;

    // Embed the text
    const [embedding] = await embedTexts([text]);
    const vec = `'[${embedding.join(',')}]'::vector(${DIMS})`;

    const textEscaped = text.replace(/'/g, "''");
    const json = JSON.stringify({
      mode: 'unknown',
      mood: [],
      sensory: [],
      setting: '',
      energy: { level: 50, motion: 'flowing' },
      arc: { start: '', peak: '', end: '' },
      themes: [],
      confidence,
      source: 'experience-only',
    }).replace(/'/g, "''");
    const now = new Date().toISOString();

    await prisma.$executeRawUnsafe(`
      INSERT INTO song_aboutness
        (song_id, aboutness_text, aboutness_json, aboutness_vector,
         aboutness_version, embedding_model, generated_at)
      VALUES
        ('${song.id}'::uuid, '${textEscaped}', '${json}'::jsonb, ${vec},
         ${ABOUTNESS_VERSION}, '${EMBEDDING_MODEL}', '${now}'::timestamptz)
      ON CONFLICT (song_id) DO UPDATE SET
        aboutness_text    = EXCLUDED.aboutness_text,
        aboutness_json    = EXCLUDED.aboutness_json,
        aboutness_vector  = EXCLUDED.aboutness_vector,
        aboutness_version = EXCLUDED.aboutness_version,
        embedding_model   = EXCLUDED.embedding_model,
        generated_at      = EXCLUDED.generated_at
    `);

    pilotSongIds.push(song.id);
    logger.info(
      { id: song.id, title: song.title, confidence, textLen: text.length },
      'Upserted pilot row',
    );
  }

  // ── D. Print review table ──────────────────────────────────────────────────

  printReviewTable(reviewRows);

  if (dryRun) {
    logger.info('[DRY RUN] No rows written; nothing to clean up');
    await prisma.$disconnect();
    return;
  }

  // ── E. Delete pilot rows ───────────────────────────────────────────────────

  if (pilotSongIds.length > 0) {
    const idList = pilotSongIds.map(id => `'${id}'::uuid`).join(', ');
    const deleted = await prisma.$executeRawUnsafe(`
      DELETE FROM song_aboutness
      WHERE song_id IN (${idList})
        AND aboutness_version = ${ABOUTNESS_VERSION}
    `);
    logger.info({ deleted }, 'Pilot rows deleted');
  }

  // ── F. Final counts ────────────────────────────────────────────────────────

  const finalCounts = await prisma.$queryRaw<Array<{ version: number; count: bigint }>>`
    SELECT aboutness_version AS version, COUNT(*) AS count
    FROM song_aboutness
    GROUP BY aboutness_version
    ORDER BY aboutness_version
  `;

  if (finalCounts.length === 0) {
    logger.info('Final state: song_aboutness table is EMPTY (clean)');
  } else {
    logger.info({ counts: finalCounts.map(r => ({ v: r.version, n: Number(r.count) })) }, 'Final song_aboutness row counts');
  }

  await prisma.$disconnect();
  logger.info('Pilot complete');
}

main().catch((err) => {
  logger.error({ error: err.message, stack: err.stack }, 'Pilot failed');
  process.exit(1);
});
