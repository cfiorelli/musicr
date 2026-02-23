import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import {
  generateAboutnessBatch,
  type BatchSongInput,
} from '../../src/services/aboutness/generator.js';
import { pipeline } from '@xenova/transformers';

/**
 * Aboutness V2 Backfill Script — Batched Generation
 *
 * Generates emotions + moments aboutness profiles for songs using OpenAI
 * (title+artist only), via the batched generator (10 songs per API request).
 * Embeds both texts with Xenova/all-MiniLM-L6-v2, upserts into song_aboutness.
 *
 * Flow per batch of batchSize songs:
 *   1) SELECT id, title, artist, mbid  (cursor-based, skip existing V2 rows)
 *   2) generateAboutnessBatch([...])   → 1 OpenAI call for emotions + moments
 *   3) embed each emotions_text → emotions_vector (384-dim)
 *   4) embed each moments_text  → moments_vector (384-dim)
 *   5) UPSERT song_aboutness (generation_version = target version)
 *
 *   Fallback: if batch JSON parse fails, falls back to per-song calls.
 *   Retry:    429 errors handled by withRateLimitRetry in generator.ts.
 *
 * Resumable: skips songs with existing row at target version.
 * NO OFFSET:  uses stable cursor on song_id for consistent resumability.
 * Safe to stop + restart at any time.
 *
 * Flags:
 *   --limit=N              Process at most N songs total
 *   --batchSize=N          Songs per OpenAI request (default: 10)
 *   --concurrency=N        Parallel batches (default: 1; keep at 1 to stay within RPD)
 *   --version=N            Generation version to write (default: 2)
 *   --dry-run              Print sample, no DB writes, no OpenAI calls
 *   --ids=id1,id2,...      Process only these song IDs (for targeted testing)
 *
 * RUN:
 *   DATABASE_URL=<url> OPENAI_API_KEY=<key> \
 *     pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-backfill.ts \
 *     --batchSize=10 --concurrency=1
 */

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMS = 384;
const PROVIDER = 'openai';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_VERSION = 2;
const STORED_MAX_CHARS = 100;

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (prefix: string) => args.find(a => a.startsWith(prefix))?.split('=')[1];

  return {
    dryRun: args.includes('--dry-run'),
    limit: get('--limit=') ? parseInt(get('--limit=')!) : undefined,
    batchSize: get('--batchSize=') ? parseInt(get('--batchSize=')!) : DEFAULT_BATCH_SIZE,
    concurrency: get('--concurrency=') ? parseInt(get('--concurrency=')!) : DEFAULT_CONCURRENCY,
    version: get('--version=') ? parseInt(get('--version=')!) : DEFAULT_VERSION,
    ids: get('--ids=') ? get('--ids=')!.split(',').map(s => s.trim()) : undefined,
  };
}

// ── Embedder ──────────────────────────────────────────────────────────────────

let embedder: any = null;

async function initEmbedder(): Promise<void> {
  console.log(`Loading embedding model: ${EMBEDDING_MODEL}...`);
  embedder = await pipeline('feature-extraction', EMBEDDING_MODEL);
  console.log('Embedding model ready.');
}

async function embedText(text: string): Promise<number[]> {
  const output = await embedder([text], { pooling: 'mean', normalize: true });
  return Array.from(output.data.slice(0, DIMS));
}

// ── Song row ──────────────────────────────────────────────────────────────────

interface SongRow {
  id: string;
  title: string;
  artist: string;
  mbid: string | null;
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertRow(params: {
  songId: string;
  emotionsText: string;
  emotionsVector: number[];
  emotionsConfidence: string;
  momentsText: string;
  momentsVector: number[];
  momentsConfidence: string;
  provider: string;
  generationModel: string;
  version: number;
}): Promise<void> {
  const {
    songId,
    emotionsText,
    emotionsVector,
    emotionsConfidence,
    momentsText,
    momentsVector,
    momentsConfidence,
    provider,
    generationModel,
    version,
  } = params;

  const now = new Date().toISOString();

  const eVec = `'[${emotionsVector.join(',')}]'::vector(${DIMS})`;
  const mVec = `'[${momentsVector.join(',')}]'::vector(${DIMS})`;

  await prisma.$executeRawUnsafe(`
    INSERT INTO song_aboutness (
      song_id,
      emotions_text, emotions_vector, emotions_confidence,
      moments_text, moments_vector, moments_confidence,
      provider, generation_model,
      -- legacy V1 columns (required NOT NULL; placeholder values for V2 rows)
      aboutness_text, aboutness_json, aboutness_version, embedding_model, generated_at
    ) VALUES (
      '${songId}'::uuid,
      '${emotionsText.replace(/'/g, "''")}',
      ${eVec},
      '${emotionsConfidence}',
      '${momentsText.replace(/'/g, "''")}',
      ${mVec},
      '${momentsConfidence}',
      '${provider}',
      '${generationModel}',
      -- legacy placeholders
      '',
      '{}'::jsonb,
      ${version},
      '${EMBEDDING_MODEL}',
      '${now}'::timestamptz
    )
    ON CONFLICT (song_id) DO UPDATE SET
      emotions_text        = EXCLUDED.emotions_text,
      emotions_vector      = EXCLUDED.emotions_vector,
      emotions_confidence  = EXCLUDED.emotions_confidence,
      moments_text         = EXCLUDED.moments_text,
      moments_vector       = EXCLUDED.moments_vector,
      moments_confidence   = EXCLUDED.moments_confidence,
      provider             = EXCLUDED.provider,
      generation_model     = EXCLUDED.generation_model,
      aboutness_version    = EXCLUDED.aboutness_version,
      embedding_model      = EXCLUDED.embedding_model,
      generated_at         = EXCLUDED.generated_at
  `);
}

// ── Batch processor ───────────────────────────────────────────────────────────

interface BatchStats {
  processed: number;
  errors: number;
  batchCalls: number;
  fallbackSongs: number;
}

async function processBatch(
  songs: SongRow[],
  version: number,
  stats: BatchStats,
  startTime: number,
  target: number,
): Promise<void> {
  const batchInput: BatchSongInput[] = songs.map(s => ({
    song_id: s.id,
    title: s.title,
    artist: s.artist,
  }));

  stats.batchCalls++;

  let batchResults;
  try {
    batchResults = await generateAboutnessBatch(batchInput);
  } catch (err: any) {
    // generateAboutnessBatch itself handles fallback internally; this catch is
    // for truly fatal errors (e.g. DB/embedder failure before any results).
    console.error(`  BATCH ERROR: ${err.message}`);
    stats.errors += songs.length;
    return;
  }

  // Detect which songs fell back to individual calls
  // (generateAboutnessBatch logs fallbacks internally)
  const respondedIds = new Set(batchResults.map(r => r.song_id));
  for (const s of songs) {
    if (!respondedIds.has(s.id)) {
      stats.fallbackSongs++;
      stats.errors++;
    }
  }

  for (const result of batchResults) {
    const song = songs.find(s => s.id === result.song_id);
    if (!song) continue;

    // Marker for songs that failed even the individual fallback
    if (result.emotions.text === 'unknown') {
      stats.errors++;
      stats.processed++;
      continue;
    }

    // Count fallback songs (those that weren't handled by the batch call)
    // We detect this by checking if the batch had fewer entries than input;
    // generateAboutnessBatch reports internally but we recount here for stats.

    const emotionsText = result.emotions.text.substring(0, STORED_MAX_CHARS);
    const momentsText = result.moments.text.substring(0, STORED_MAX_CHARS);

    try {
      const [emotionsVec, momentsVec] = await Promise.all([
        embedText(emotionsText),
        embedText(momentsText),
      ]);

      await upsertRow({
        songId: song.id,
        emotionsText,
        emotionsVector: emotionsVec,
        emotionsConfidence: result.emotions.confidence,
        momentsText,
        momentsVector: momentsVec,
        momentsConfidence: result.moments.confidence,
        provider: PROVIDER,
        generationModel: result.emotions.model,
        version,
      });

      stats.processed++;

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = stats.processed / elapsed;
      const eta = rate > 0 ? Math.round((target - stats.processed) / rate) : '?';
      const pct = ((stats.processed / target) * 100).toFixed(1);
      console.log(
        `  [${stats.processed}/${target} ${pct}%] "${song.title}" by ${song.artist}` +
        ` | emo=${emotionsText.length}c[${result.emotions.confidence}]` +
        ` mom=${momentsText.length}c[${result.moments.confidence}]` +
        ` | ${rate.toFixed(2)} songs/s | eta ${eta}s`,
      );
    } catch (err: any) {
      console.error(`  ERROR embedding/upserting "${song.title}": ${err.message}`);
      stats.errors++;
      stats.processed++;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('Aboutness V2 Backfill [BATCHED]');
  console.log('─'.repeat(60));
  console.log(`  Version:      ${opts.version}`);
  console.log(`  Batch size:   ${opts.batchSize} songs/OpenAI request`);
  console.log(`  Concurrency:  ${opts.concurrency} batches parallel`);
  console.log(`  Limit:        ${opts.limit ?? 'none'}`);
  console.log(`  Dry run:      ${opts.dryRun}`);
  console.log(`  IDs filter:   ${opts.ids ? opts.ids.join(', ') : 'none'}`);
  console.log(`  Model:        ${EMBEDDING_MODEL} (${DIMS}-dim)`);
  console.log('─'.repeat(60));

  if (!opts.dryRun && !process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set. Use --dry-run to test without API calls.');
    process.exit(1);
  }

  await prisma.$connect();

  if (!opts.dryRun) {
    await initEmbedder();
  }

  const stats: BatchStats = { processed: 0, errors: 0, batchCalls: 0, fallbackSongs: 0 };
  let lastId = '00000000-0000-0000-0000-000000000000'; // cursor start
  const startTime = Date.now();

  // Determine total eligible for progress logging
  let totalEligible: number;
  if (opts.ids) {
    totalEligible = opts.ids.length;
  } else {
    const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM songs s
      LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${opts.version}
      WHERE sa.song_id IS NULL
        AND s.is_placeholder = false
    `;
    totalEligible = opts.limit
      ? Math.min(Number(countResult[0].count), opts.limit)
      : Number(countResult[0].count);
  }

  console.log(`Songs to process: ${totalEligible}`);
  if (totalEligible === 0) {
    console.log('Nothing to do — all songs already have version=2 aboutness.');
    await prisma.$disconnect();
    return;
  }

  const target = opts.limit ? Math.min(totalEligible, opts.limit) : totalEligible;

  while (stats.processed + stats.errors < target) {
    const remaining = target - (stats.processed + stats.errors);
    const fetchSize = Math.min(opts.batchSize * opts.concurrency, remaining);

    let songs: SongRow[];

    if (opts.ids) {
      const done = stats.processed + stats.errors;
      const idsToProcess = opts.ids.slice(done, done + fetchSize);
      songs = await prisma.$queryRaw<SongRow[]>`
        SELECT s.id, s.title, s.artist, s.mbid
        FROM songs s
        LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${opts.version}
        WHERE s.id = ANY(${idsToProcess}::uuid[])
          AND sa.song_id IS NULL
        ORDER BY s.id ASC
      `;
    } else {
      songs = await prisma.$queryRaw<SongRow[]>`
        SELECT s.id, s.title, s.artist, s.mbid
        FROM songs s
        LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${opts.version}
        WHERE sa.song_id IS NULL
          AND s.is_placeholder = false
          AND s.id > ${lastId}::uuid
        ORDER BY s.id ASC
        LIMIT ${fetchSize}
      `;
    }

    if (songs.length === 0) break;
    lastId = songs[songs.length - 1].id;

    if (opts.dryRun) {
      for (const s of songs) {
        console.log(`  [DRY RUN] "${s.title}" by ${s.artist} (${s.id})`);
      }
      stats.processed += songs.length;
      continue;
    }

    // Split into batchSize chunks and process up to concurrency batches in parallel
    const chunks: SongRow[][] = [];
    for (let i = 0; i < songs.length; i += opts.batchSize) {
      chunks.push(songs.slice(i, i + opts.batchSize));
    }

    for (let i = 0; i < chunks.length; i += opts.concurrency) {
      const parallel = chunks.slice(i, i + opts.concurrency);
      await Promise.all(
        parallel.map(chunk => processBatch(chunk, opts.version, stats, startTime, target)),
      );
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═'.repeat(60));
  console.log('BACKFILL SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Version:         ${opts.version}`);
  console.log(`  Processed:       ${stats.processed}`);
  console.log(`  Errors:          ${stats.errors}`);
  console.log(`  Batch calls:     ${stats.batchCalls}`);
  console.log(`  Fallback songs:  ${stats.fallbackSongs}`);
  console.log(`  Time:            ${elapsed}s`);
  console.log(`  Mode:            ${opts.dryRun ? 'DRY RUN' : 'LIVE [BATCHED]'}`);
  console.log('═'.repeat(60));

  await prisma.$disconnect();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
