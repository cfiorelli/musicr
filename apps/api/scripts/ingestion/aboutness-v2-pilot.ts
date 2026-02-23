import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../src/services/database.js';
import { generateAboutnessBatch, type BatchSongInput } from '../../src/services/aboutness/generator.js';
import { pipeline } from '@xenova/transformers';

/**
 * Aboutness V2 Pilot — Optimized Batch Generation
 *
 * Runs the optimized batch generator (10 songs/call) on exactly 100 songs
 * that don't yet have a V2 aboutness row.
 *
 * Produces:
 *   tmp/aboutness-v2-pilot-audit.md    — aggregate stats + quality check
 *   tmp/aboutness-v2-pilot-sample.json — raw row data for review
 *
 * RUN:
 *   DATABASE_URL=<url> OPENAI_API_KEY=<key> \
 *     pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-pilot.ts
 *
 * Flags:
 *   --dry-run          Print sample, no DB writes, no OpenAI calls
 *   --version=N        Generation version to write (default: 2)
 *   --limit=N          Override pilot song count (default: 100)
 *   --ids=id1,id2,...  Process only these specific song IDs
 */

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMS = 384;
const PROVIDER = 'openai';
const PILOT_LIMIT = 100;
const BATCH_SIZE = 10;
const DEFAULT_VERSION = 2;
const STORED_MAX_CHARS = 100;

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (prefix: string) => args.find(a => a.startsWith(prefix))?.split('=')[1];
  return {
    dryRun: args.includes('--dry-run'),
    limit: get('--limit=') ? parseInt(get('--limit=')!) : PILOT_LIMIT,
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
    songId, emotionsText, emotionsVector, emotionsConfidence,
    momentsText, momentsVector, momentsConfidence,
    provider, generationModel, version,
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

// ── Quality checks ────────────────────────────────────────────────────────────

interface SampleRow {
  song_id: string;
  title: string;
  artist: string;
  emotions_text: string;
  moments_text: string;
  emotions_confidence: string;
  moments_confidence: string;
  emotions_len: number;
  moments_len: number;
  emotions_has_tag: boolean;
  moments_has_tag: boolean;
  emotions_has_truncation: boolean;
  moments_has_truncation: boolean;
  emotions_has_ideal_for: boolean;
  moments_has_ideal_for: boolean;
}

function analyzeRow(row: {
  song_id: string;
  title: string;
  artist: string;
  emotions_text: string;
  moments_text: string;
  emotions_confidence: string;
  moments_confidence: string;
}): SampleRow {
  const emo = row.emotions_text;
  const mom = row.moments_text;
  const tagPattern = /\[confidence:\s*(low|medium|high)\]/i;
  const idealForPattern = /\b(ideal for|perfect for|great for)\b/i;

  return {
    ...row,
    emotions_len: emo.length,
    moments_len: mom.length,
    emotions_has_tag: tagPattern.test(emo),
    moments_has_tag: tagPattern.test(mom),
    emotions_has_truncation: emo.includes('…') || emo.includes('...'),
    moments_has_truncation: mom.includes('…') || mom.includes('...'),
    emotions_has_ideal_for: idealForPattern.test(emo),
    moments_has_ideal_for: idealForPattern.test(mom),
  };
}

// ── Audit doc generation ──────────────────────────────────────────────────────

function generateAuditDoc(
  rows: SampleRow[],
  stats: {
    songsProcessed: number;
    batchesAttempted: number;
    batchesSucceeded: number;
    fallbackCount: number;
    errorCount: number;
    elapsedSec: number;
    openaiCallCount: number;
    totalInputTokensEst: number;
    totalOutputTokensEst: number;
  },
): string {
  const n = rows.length;
  const avgEmoLen = n > 0 ? (rows.reduce((s, r) => s + r.emotions_len, 0) / n).toFixed(1) : '0';
  const avgMomLen = n > 0 ? (rows.reduce((s, r) => s + r.moments_len, 0) / n).toFixed(1) : '0';
  const pEmoTag = n > 0 ? ((rows.filter(r => r.emotions_has_tag).length / n) * 100).toFixed(1) : '0';
  const pMomTag = n > 0 ? ((rows.filter(r => r.moments_has_tag).length / n) * 100).toFixed(1) : '0';
  const pEmoTrunc = n > 0 ? ((rows.filter(r => r.emotions_has_truncation).length / n) * 100).toFixed(1) : '0';
  const pMomTrunc = n > 0 ? ((rows.filter(r => r.moments_has_truncation).length / n) * 100).toFixed(1) : '0';
  const pMomIdeal = n > 0 ? ((rows.filter(r => r.moments_has_ideal_for).length / n) * 100).toFixed(1) : '0';
  const pEmoIdeal = n > 0 ? ((rows.filter(r => r.emotions_has_ideal_for).length / n) * 100).toFixed(1) : '0';

  // Confidence distributions
  const emoConf = { low: 0, medium: 0, high: 0 };
  const momConf = { low: 0, medium: 0, high: 0 };
  for (const r of rows) {
    const ec = r.emotions_confidence as keyof typeof emoConf;
    const mc = r.moments_confidence as keyof typeof momConf;
    if (ec in emoConf) emoConf[ec]++;
    if (mc in momConf) momConf[mc]++;
  }

  // Length distribution buckets
  const emoBuckets = { '<20': 0, '20-49': 0, '50-90': 0, '91-100': 0, '>100': 0 };
  const momBuckets = { '<20': 0, '20-49': 0, '50-90': 0, '91-100': 0, '>100': 0 };
  for (const r of rows) {
    for (const [buckets, len] of [[emoBuckets, r.emotions_len], [momBuckets, r.moments_len]] as const) {
      if (len < 20) buckets['<20']++;
      else if (len < 50) buckets['20-49']++;
      else if (len <= 90) buckets['50-90']++;
      else if (len <= 100) buckets['91-100']++;
      else buckets['>100']++;
    }
  }

  const batchSuccessRate = stats.batchesAttempted > 0
    ? ((stats.batchesSucceeded / stats.batchesAttempted) * 100).toFixed(1)
    : '0';
  const fallbackRate = stats.songsProcessed > 0
    ? ((stats.fallbackCount / stats.songsProcessed) * 100).toFixed(1)
    : '0';

  // Cost estimation: gpt-4o-mini $0.15/1M input, $0.60/1M output
  const inputCost = (stats.totalInputTokensEst / 1_000_000) * 0.15;
  const outputCost = (stats.totalOutputTokensEst / 1_000_000) * 0.60;
  const totalCost = inputCost + outputCost;
  const costPerSong = stats.songsProcessed > 0 ? totalCost / stats.songsProcessed : 0;
  const projectedTotal = costPerSong * 114_336;
  const throughput = stats.elapsedSec > 0 ? (stats.songsProcessed / stats.elapsedSec).toFixed(2) : '?';
  const rpdCapacity = stats.elapsedSec > 0 && stats.openaiCallCount > 0
    ? Math.round((stats.openaiCallCount / stats.elapsedSec) * 86400)
    : 0;

  // Acceptance criteria evaluation
  function pass(condition: boolean) { return condition ? 'PASS' : 'FAIL'; }
  const batchSuccessNum = parseFloat(batchSuccessRate);
  const fallbackRateNum = parseFloat(fallbackRate);
  const avgEmoLenNum = parseFloat(avgEmoLen);
  const avgMomLenNum = parseFloat(avgMomLen);

  return `# Aboutness V2 Pilot — Audit Report

_Generated: ${new Date().toISOString()}_

## Pilot Parameters

| Parameter | Value |
|-----------|-------|
| Songs processed | ${stats.songsProcessed} |
| Batch size | ${BATCH_SIZE} songs/call |
| Batches attempted | ${stats.batchesAttempted} |
| Batches succeeded | ${stats.batchesSucceeded} |
| Fallback songs | ${stats.fallbackCount} |
| Errors | ${stats.errorCount} |
| Elapsed | ${stats.elapsedSec.toFixed(1)}s |

## Batch Performance

| Metric | Value |
|--------|-------|
| Batch success rate | ${batchSuccessRate}% |
| Per-song fallback rate | ${fallbackRate}% |
| OpenAI API calls | ${stats.openaiCallCount} |
| Est. throughput | ${throughput} songs/s |
| Est. RPD capacity | ${rpdCapacity.toLocaleString()} songs/day |

## Output Length Statistics

| Field | Avg length | Target (50-90) |
|-------|-----------|---------------|
| emotions_text | ${avgEmoLen}c | ${avgEmoLenNum >= 50 && avgEmoLenNum <= 90 ? 'IN RANGE' : 'OUT OF RANGE'} |
| moments_text | ${avgMomLen}c | ${avgMomLenNum >= 50 && avgMomLenNum <= 90 ? 'IN RANGE' : 'OUT OF RANGE'} |

### Emotions length distribution

| Bucket | Count | % |
|--------|-------|---|
| <20 chars | ${emoBuckets['<20']} | ${n > 0 ? ((emoBuckets['<20']/n)*100).toFixed(1) : 0}% |
| 20–49 chars | ${emoBuckets['20-49']} | ${n > 0 ? ((emoBuckets['20-49']/n)*100).toFixed(1) : 0}% |
| 50–90 chars (target) | ${emoBuckets['50-90']} | ${n > 0 ? ((emoBuckets['50-90']/n)*100).toFixed(1) : 0}% |
| 91–100 chars | ${emoBuckets['91-100']} | ${n > 0 ? ((emoBuckets['91-100']/n)*100).toFixed(1) : 0}% |
| >100 chars | ${emoBuckets['>100']} | ${n > 0 ? ((emoBuckets['>100']/n)*100).toFixed(1) : 0}% |

### Moments length distribution

| Bucket | Count | % |
|--------|-------|---|
| <20 chars | ${momBuckets['<20']} | ${n > 0 ? ((momBuckets['<20']/n)*100).toFixed(1) : 0}% |
| 20–49 chars | ${momBuckets['20-49']} | ${n > 0 ? ((momBuckets['20-49']/n)*100).toFixed(1) : 0}% |
| 50–90 chars (target) | ${momBuckets['50-90']} | ${n > 0 ? ((momBuckets['50-90']/n)*100).toFixed(1) : 0}% |
| 91–100 chars | ${momBuckets['91-100']} | ${n > 0 ? ((momBuckets['91-100']/n)*100).toFixed(1) : 0}% |
| >100 chars | ${momBuckets['>100']} | ${n > 0 ? ((momBuckets['>100']/n)*100).toFixed(1) : 0}% |

## Quality Checks

| Check | Rate | Status |
|-------|------|--------|
| Confidence tag in emotions_text | ${pEmoTag}% | ${parseFloat(pEmoTag) === 0 ? 'PASS (expected 0%)' : 'FAIL (must be 0%)'} |
| Confidence tag in moments_text | ${pMomTag}% | ${parseFloat(pMomTag) === 0 ? 'PASS (expected 0%)' : 'FAIL (must be 0%)'} |
| Truncation artifact in emotions | ${pEmoTrunc}% | ${parseFloat(pEmoTrunc) === 0 ? 'PASS' : 'FAIL'} |
| Truncation artifact in moments | ${pMomTrunc}% | ${parseFloat(pMomTrunc) === 0 ? 'PASS' : 'FAIL'} |
| "ideal for" violation (moments) | ${pMomIdeal}% | ${parseFloat(pMomIdeal) < 5 ? 'PASS' : 'FAIL'} |
| "ideal for" violation (emotions) | ${pEmoIdeal}% | — |

## Confidence Distributions

| Confidence | Emotions | Moments |
|-----------|---------|---------|
| low | ${emoConf.low} (${n > 0 ? ((emoConf.low/n)*100).toFixed(1) : 0}%) | ${momConf.low} (${n > 0 ? ((momConf.low/n)*100).toFixed(1) : 0}%) |
| medium | ${emoConf.medium} (${n > 0 ? ((emoConf.medium/n)*100).toFixed(1) : 0}%) | ${momConf.medium} (${n > 0 ? ((momConf.medium/n)*100).toFixed(1) : 0}%) |
| high | ${emoConf.high} (${n > 0 ? ((emoConf.high/n)*100).toFixed(1) : 0}%) | ${momConf.high} (${n > 0 ? ((momConf.high/n)*100).toFixed(1) : 0}%) |

## Cost Analysis

| Metric | Value |
|--------|-------|
| Est. input tokens | ${stats.totalInputTokensEst.toLocaleString()} |
| Est. output tokens | ${stats.totalOutputTokensEst.toLocaleString()} |
| Est. input cost | $${inputCost.toFixed(4)} |
| Est. output cost | $${outputCost.toFixed(4)} |
| Est. total cost (pilot) | $${totalCost.toFixed(4)} |
| Est. cost per song | $${costPerSong.toFixed(6)} |
| Projected cost (114k songs) | $${projectedTotal.toFixed(2)} |

## Acceptance Criteria

| Criterion | Threshold | Actual | Result |
|-----------|-----------|--------|--------|
| Pilot completes without fatal error | Required | ${stats.errorCount === 0 ? 'Yes' : 'No (' + stats.errorCount + ' errors)'} | ${pass(stats.errorCount === 0)} |
| Batch success rate | ≥ 70% | ${batchSuccessRate}% | ${pass(batchSuccessNum >= 70)} |
| Per-song fallback rate | ≤ 20% | ${fallbackRate}% | ${pass(fallbackRateNum <= 20)} |
| Avg emotions text length | 50–100 chars | ${avgEmoLen}c | ${pass(avgEmoLenNum >= 50 && avgEmoLenNum <= 100)} |
| Avg moments text length | 50–100 chars | ${avgMomLen}c | ${pass(avgMomLenNum >= 50 && avgMomLenNum <= 100)} |
| Zero truncation artifacts | Required | ${parseFloat(pEmoTrunc) === 0 && parseFloat(pMomTrunc) === 0 ? 'None' : 'PRESENT'} | ${pass(parseFloat(pEmoTrunc) === 0 && parseFloat(pMomTrunc) === 0)} |
| No confidence tags in stored text | Required | emo=${pEmoTag}% mom=${pMomTag}% | ${pass(parseFloat(pEmoTag) === 0 && parseFloat(pMomTag) === 0)} |
| Projected cost/song | ≤ $0.000120 | $${costPerSong.toFixed(6)} | ${pass(costPerSong <= 0.000120)} |
| Projected RPD capacity | ≥ 20,000/day | ${rpdCapacity.toLocaleString()} | ${pass(rpdCapacity >= 20_000)} |

## Sample Rows (first 10)

${rows.slice(0, 10).map((r, i) => `### ${i + 1}. "${r.title}" by ${r.artist}

**emotions** [${r.emotions_confidence}] (${r.emotions_len}c): ${r.emotions_text}

**moments** [${r.moments_confidence}] (${r.moments_len}c): ${r.moments_text}
`).join('\n')}
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('Aboutness V2 Pilot — Optimized Batch Generation');
  console.log('─'.repeat(60));
  console.log(`  Limit:      ${opts.limit} songs`);
  console.log(`  Batch size: ${BATCH_SIZE} songs/call`);
  console.log(`  Version:    ${opts.version}`);
  console.log(`  Dry run:    ${opts.dryRun}`);
  console.log('─'.repeat(60));

  if (!opts.dryRun && !process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set.');
    process.exit(1);
  }

  await prisma.$connect();

  if (!opts.dryRun) {
    await initEmbedder();
  }

  // Fetch songs to process
  let songs: Array<{ id: string; title: string; artist: string }>;

  if (opts.ids) {
    songs = await prisma.$queryRaw<Array<{ id: string; title: string; artist: string }>>`
      SELECT s.id, s.title, s.artist
      FROM songs s
      LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${opts.version}
      WHERE s.id = ANY(${opts.ids}::uuid[])
        AND sa.song_id IS NULL
      ORDER BY s.id ASC
      LIMIT ${opts.limit}
    `;
  } else {
    songs = await prisma.$queryRaw<Array<{ id: string; title: string; artist: string }>>`
      SELECT s.id, s.title, s.artist
      FROM songs s
      LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${opts.version}
      WHERE sa.song_id IS NULL
        AND s.is_placeholder = false
      ORDER BY RANDOM()
      LIMIT ${opts.limit}
    `;
  }

  console.log(`Songs to process: ${songs.length}`);

  if (songs.length === 0) {
    console.log('Nothing to do — no eligible songs found.');
    await prisma.$disconnect();
    return;
  }

  if (opts.dryRun) {
    console.log('DRY RUN — sample songs:');
    for (const s of songs.slice(0, 5)) {
      console.log(`  "${s.title}" by ${s.artist} (${s.id})`);
    }
    await prisma.$disconnect();
    return;
  }

  const sampleRows: SampleRow[] = [];
  const startTime = Date.now();

  let batchesAttempted = 0;
  let batchesSucceeded = 0;
  let fallbackCount = 0;
  let errorCount = 0;
  let openaiCallCount = 0;
  // Token estimates: batch call ~120 input/song + 70 output/song; fallback ~525 in + 50 out
  let totalInputTokensEst = 0;
  let totalOutputTokensEst = 0;

  const batchSuccessTracker: boolean[] = [];

  for (let i = 0; i < songs.length; i += BATCH_SIZE) {
    const chunk = songs.slice(i, i + BATCH_SIZE);
    const batchInput: BatchSongInput[] = chunk.map(s => ({
      song_id: s.id,
      title: s.title,
      artist: s.artist,
    }));

    batchesAttempted++;
    console.log(`\nBatch ${batchesAttempted} [${i + 1}–${i + chunk.length}/${songs.length}]:`);

    // Track whether this batch was a clean parse (vs fallback)
    let batchHadFallback = false;

    let batchResults;
    try {
      batchResults = await generateAboutnessBatch(batchInput);
      openaiCallCount++; // at minimum 1 batch call
      // Estimate tokens: batch call
      totalInputTokensEst += chunk.length * 35 + 300; // system + per-song input
      totalOutputTokensEst += chunk.length * 70; // ~70 tokens per song output
    } catch (err: any) {
      console.error(`  Batch failed entirely: ${err.message}`);
      errorCount += chunk.length;
      continue;
    }

    // Count fallbacks (songs that weren't in batch response → had individual calls)
    const batchIds = new Set(batchResults.map(r => r.song_id));
    for (const input of batchInput) {
      if (!batchIds.has(input.song_id)) {
        fallbackCount++;
        batchHadFallback = true;
        openaiCallCount += 2; // 2 individual calls
        totalInputTokensEst += 525;
        totalOutputTokensEst += 50;
      }
    }

    // Also detect if any result came via individual fallback (text = 'unknown' is error marker)
    const errorResults = batchResults.filter(r => r.emotions.text === 'unknown');
    if (errorResults.length > 0) {
      errorCount += errorResults.length;
      batchHadFallback = true;
    }

    if (!batchHadFallback) {
      batchesSucceeded++;
    }
    batchSuccessTracker.push(!batchHadFallback);

    // Upsert and collect samples
    for (const result of batchResults) {
      if (result.emotions.text === 'unknown') continue; // error, skip

      const song = chunk.find(s => s.id === result.song_id);
      if (!song) continue;

      const [emotionsVec, momentsVec] = await Promise.all([
        embedText(result.emotions.text),
        embedText(result.moments.text),
      ]);

      try {
        await upsertRow({
          songId: song.id,
          emotionsText: result.emotions.text.substring(0, STORED_MAX_CHARS),
          emotionsVector: emotionsVec,
          emotionsConfidence: result.emotions.confidence,
          momentsText: result.moments.text.substring(0, STORED_MAX_CHARS),
          momentsVector: momentsVec,
          momentsConfidence: result.moments.confidence,
          provider: PROVIDER,
          generationModel: result.emotions.model,
          version: opts.version,
        });

        const sampleRow = analyzeRow({
          song_id: song.id,
          title: song.title,
          artist: song.artist,
          emotions_text: result.emotions.text,
          moments_text: result.moments.text,
          emotions_confidence: result.emotions.confidence,
          moments_confidence: result.moments.confidence,
        });
        sampleRows.push(sampleRow);

        console.log(
          `  ✓ "${song.title}" by ${song.artist}` +
          ` | emo=${result.emotions.text.length}c[${result.emotions.confidence}]` +
          ` mom=${result.moments.text.length}c[${result.moments.confidence}]`,
        );
      } catch (err: any) {
        console.error(`  ERROR upserting "${song.title}": ${err.message}`);
        errorCount++;
      }
    }
  }

  const elapsedSec = (Date.now() - startTime) / 1000;
  const songsProcessed = sampleRows.length;

  console.log('');
  console.log('═'.repeat(60));
  console.log('PILOT SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Songs processed:    ${songsProcessed}`);
  console.log(`  Batches attempted:  ${batchesAttempted}`);
  console.log(`  Batches succeeded:  ${batchesSucceeded}`);
  console.log(`  Fallback songs:     ${fallbackCount}`);
  console.log(`  Errors:             ${errorCount}`);
  console.log(`  OpenAI calls:       ${openaiCallCount}`);
  console.log(`  Elapsed:            ${elapsedSec.toFixed(1)}s`);
  console.log('═'.repeat(60));

  // Write output files
  const tmpDir = path.join(process.cwd(), '../../tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const auditPath = path.join(tmpDir, 'aboutness-v2-pilot-audit.md');
  const samplePath = path.join(tmpDir, 'aboutness-v2-pilot-sample.json');

  const auditStats = {
    songsProcessed,
    batchesAttempted,
    batchesSucceeded,
    fallbackCount,
    errorCount,
    elapsedSec,
    openaiCallCount,
    totalInputTokensEst,
    totalOutputTokensEst,
  };

  fs.writeFileSync(auditPath, generateAuditDoc(sampleRows, auditStats), 'utf-8');
  fs.writeFileSync(samplePath, JSON.stringify(sampleRows, null, 2), 'utf-8');

  console.log(`\nAudit report:  ${auditPath}`);
  console.log(`Sample JSON:   ${samplePath}`);

  await prisma.$disconnect();
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
