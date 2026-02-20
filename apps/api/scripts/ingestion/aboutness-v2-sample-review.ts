import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { generateEmotionsAboutness, generateMomentsAboutness } from '../../src/services/aboutness/generator.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Aboutness V2 Sample Review
 *
 * Generates emotions + moments for 10 songs using OpenAI (title+artist only).
 * NO DB writes. NO embeddings. Text generation only.
 *
 * Writes:
 *   tmp/aboutness-v2-sample-review.md   — human-readable
 *   tmp/aboutness-v2-sample-review.json — structured
 *
 * RUN:
 *   DATABASE_URL=<url> OPENAI_API_KEY=<key> \
 *     pnpm -C apps/api exec tsx scripts/ingestion/aboutness-v2-sample-review.ts
 *
 * Optional:
 *   --deterministic   ORDER BY id ASC instead of RANDOM()
 */

const SAMPLE_N = 10;

interface SongRow {
  id: string;
  mbid: string | null;
  title: string;
  artist: string;
}

interface SampleResult {
  song_id: string;
  mbid: string | null;
  artist: string;
  title: string;
  emotions: {
    text: string;
    length: number;
    confidence: string;
    model: string;
  };
  moments: {
    text: string;
    length: number;
    confidence: string;
    model: string;
  };
}

function renderMarkdown(results: SampleResult[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  const model = process.env.ABOUTNESS_OPENAI_MODEL ?? 'gpt-4o-mini';

  lines.push('# Aboutness V2 — Sample Review (10 songs)');
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Model: \`${model}\` (OpenAI)`);
  lines.push(`Generation: title + artist only, no metadata`);
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push('| # | Artist | Title | MBID | Emo conf | Mom conf | Emo len | Mom len |');
  lines.push('|---|--------|-------|------|----------|----------|---------|---------|');
  results.forEach((r, i) => {
    const mbid = r.mbid ? r.mbid.substring(0, 8) + '…' : '—';
    lines.push(
      `| ${i + 1} | ${r.artist} | ${r.title} | ${mbid} | ${r.emotions.confidence} | ${r.moments.confidence} | ${r.emotions.length} | ${r.moments.length} |`,
    );
  });

  lines.push('');
  lines.push('---');
  lines.push('');

  results.forEach((r, i) => {
    lines.push(`## Song ${i + 1}: "${r.title}" by ${r.artist}`);
    lines.push('');
    lines.push(`- **song_id:** \`${r.song_id}\``);
    lines.push(`- **mbid:** \`${r.mbid ?? 'null'}\``);
    lines.push(`- **artist:** ${r.artist}`);
    lines.push(`- **title:** ${r.title}`);
    lines.push('');

    lines.push('### Emotions');
    lines.push(`_confidence: **${r.emotions.confidence}** | length: ${r.emotions.length} chars_`);
    lines.push('');
    lines.push('> ' + r.emotions.text.replace(/\n/g, '\n> '));
    lines.push('');

    lines.push('### Moments');
    lines.push(`_confidence: **${r.moments.confidence}** | length: ${r.moments.length} chars_`);
    lines.push('');
    lines.push('> ' + r.moments.text.replace(/\n/g, '\n> '));
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const deterministic = args.includes('--deterministic');

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set.');
    process.exit(1);
  }

  await prisma.$connect();

  const songs: SongRow[] = deterministic
    ? await prisma.$queryRaw<SongRow[]>`
        SELECT id, mbid, title, artist
        FROM songs
        WHERE is_placeholder = false
        ORDER BY id ASC
        LIMIT ${SAMPLE_N}
      `
    : await prisma.$queryRaw<SongRow[]>`
        SELECT id, mbid, title, artist
        FROM songs
        WHERE is_placeholder = false
        ORDER BY RANDOM()
        LIMIT ${SAMPLE_N}
      `;

  await prisma.$disconnect();

  console.log(`\nSelected ${songs.length} songs:`);
  songs.forEach((s, i) => console.log(`  ${i + 1}. "${s.title}" by ${s.artist}`));
  console.log('');

  const results: SampleResult[] = [];

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    console.log(`[${i + 1}/${songs.length}] "${song.title}" by ${song.artist}`);

    process.stdout.write('  Emotions... ');
    let emo, mom;
    try {
      emo = await generateEmotionsAboutness(song.title, song.artist);
      console.log(`done (${emo.text.length}c, ${emo.confidence})`);
    } catch (err: any) {
      emo = { text: `[ERROR: ${err.message}] [confidence: low]`, confidence: 'low' as const, model: '?', provider: 'openai' as const };
      console.log(`ERROR: ${err.message}`);
    }

    process.stdout.write('  Moments...  ');
    try {
      mom = await generateMomentsAboutness(song.title, song.artist);
      console.log(`done (${mom.text.length}c, ${mom.confidence})`);
    } catch (err: any) {
      mom = { text: `[ERROR: ${err.message}] [confidence: low]`, confidence: 'low' as const, model: '?', provider: 'openai' as const };
      console.log(`ERROR: ${err.message}`);
    }

    results.push({
      song_id: song.id,
      mbid: song.mbid ?? null,
      artist: song.artist,
      title: song.title,
      emotions: { text: emo.text, length: emo.text.length, confidence: emo.confidence, model: emo.model },
      moments: { text: mom!.text, length: mom!.text.length, confidence: mom!.confidence, model: mom!.model },
    });
  }

  // Resolve output directory relative to repo root (script runs from apps/api/)
  const outDir = path.resolve(process.cwd(), '../../tmp');
  fs.mkdirSync(outDir, { recursive: true });

  const mdPath = path.join(outDir, 'aboutness-v2-sample-review.md');
  const jsonPath = path.join(outDir, 'aboutness-v2-sample-review.json');

  fs.writeFileSync(mdPath, renderMarkdown(results), 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');

  console.log(`\nOutput:`);
  console.log(`  Markdown: ${mdPath}`);
  console.log(`  JSON:     ${jsonPath}`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
