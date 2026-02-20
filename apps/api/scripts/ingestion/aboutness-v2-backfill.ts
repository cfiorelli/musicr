import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { generateEmotionsAboutness, generateMomentsAboutness } from '../../src/services/aboutness/generator.js';
import { pipeline } from '@xenova/transformers';

/**
 * Aboutness V2 Backfill Script
 *
 * Generates emotions + moments aboutness profiles for songs using OpenAI (title+artist only),
 * embeds both texts with Xenova/all-MiniLM-L6-v2, and upserts into song_aboutness.
 *
 * Flow per song:
 *   1) SELECT id, title, artist, mbid
 *   2) generateEmotionsAboutness(title, artist)   → text + confidence
 *   3) generateMomentsAboutness(title, artist)    → text + confidence
 *   4) embed emotions_text → emotions_vector (384)
 *   5) embed moments_text  → moments_vector (384)
 *   6) UPSERT song_aboutness with generation_version = target version
 *
 * Resumable: skips songs with existing row at target version.
 * NO OFFSET: uses stable cursor on song_id for consistent resumability.
 * Safe to stop + restart at any time.
 *
 * Flags:
 *   --limit=N              Process at most N songs total
 *   --batchSize=N          Songs per iteration (default: 10)
 *   --concurrency=N        Parallel OpenAI calls per batch (default: 3)
 *   --version=N            Generation version to write (default: 2)
 *   --dry-run              Print sample, no DB writes, no OpenAI calls
 *   --ids=id1,id2,...      Process only these song IDs (for targeted testing)
 *
 * RUN:
 *   DATABASE_URL=<url> OPENAI_API_KEY=<key> \
 *     pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-backfill.ts \
 *     --limit=50 --batchSize=10 --concurrency=3
 */

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMS = 384;
const PROVIDER = 'openai';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_VERSION = 2;

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

  // We upsert: if a row for this song already exists (from any version), update it.
  // Legacy V1 columns get dummy values so NOT NULL constraints are satisfied.
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

async function processSong(
  song: SongRow,
  version: number,
  dryRun: boolean,
): Promise<{ success: boolean; emotionsLen: number; momentsLen: number }> {
  if (dryRun) {
    console.log(`  [DRY RUN] "${song.title}" by ${song.artist} (${song.id})`);
    return { success: true, emotionsLen: 0, momentsLen: 0 };
  }

  let emotionsResult, momentsResult;

  try {
    [emotionsResult, momentsResult] = await Promise.all([
      generateEmotionsAboutness(song.title, song.artist),
      generateMomentsAboutness(song.title, song.artist),
    ]);
  } catch (err: any) {
    console.error(`  ERROR generating for "${song.title}" by ${song.artist}: ${err.message}`);
    return { success: false, emotionsLen: 0, momentsLen: 0 };
  }

  const [emotionsVec, momentsVec] = await Promise.all([
    embedText(emotionsResult.text),
    embedText(momentsResult.text),
  ]);

  await upsertRow({
    songId: song.id,
    emotionsText: emotionsResult.text,
    emotionsVector: emotionsVec,
    emotionsConfidence: emotionsResult.confidence,
    momentsText: momentsResult.text,
    momentsVector: momentsVec,
    momentsConfidence: momentsResult.confidence,
    provider: PROVIDER,
    generationModel: emotionsResult.model,
    version,
  });

  return {
    success: true,
    emotionsLen: emotionsResult.text.length,
    momentsLen: momentsResult.text.length,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('Aboutness V2 Backfill');
  console.log('─'.repeat(60));
  console.log(`  Version:      ${opts.version}`);
  console.log(`  Batch size:   ${opts.batchSize}`);
  console.log(`  Concurrency:  ${opts.concurrency}`);
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

  let processed = 0;
  let errors = 0;
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

  while (processed < target) {
    const remaining = target - processed;
    const fetchSize = Math.min(opts.batchSize, remaining);

    // Stable cursor-based pagination (NO OFFSET)
    let songs: SongRow[];

    if (opts.ids) {
      // Targeted mode: process specific IDs
      const idsToProcess = opts.ids.slice(processed, processed + fetchSize);
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

    // Process in parallel up to concurrency limit
    for (let i = 0; i < songs.length; i += opts.concurrency) {
      const chunk = songs.slice(i, i + opts.concurrency);
      const results = await Promise.all(chunk.map(s => processSong(s, opts.version, opts.dryRun)));

      for (let j = 0; j < chunk.length; j++) {
        const s = chunk[j];
        const r = results[j];
        processed++;
        if (!r.success) {
          errors++;
        } else if (!opts.dryRun) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processed / elapsed;
          const eta = rate > 0 ? Math.round((target - processed) / rate) : '?';
          const pct = ((processed / target) * 100).toFixed(1);
          console.log(
            `  [${processed}/${target} ${pct}%] "${s.title}" by ${s.artist}` +
            ` | emo=${r.emotionsLen}c mom=${r.momentsLen}c` +
            ` | ${rate.toFixed(1)} songs/s | eta ${eta}s`,
          );
        }
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═'.repeat(60));
  console.log('BACKFILL SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Version:    ${opts.version}`);
  console.log(`  Processed:  ${processed}`);
  console.log(`  Errors:     ${errors}`);
  console.log(`  Time:       ${elapsed}s`);
  console.log(`  Mode:       ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('═'.repeat(60));

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
