import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Aboutness A/B Text Pilot
 *
 * Generates 2 aboutness descriptions for the same 10 songs:
 *   A) OpenAI  (gpt-4o-mini or ABOUTNESS_OPENAI_MODEL)
 *   B) Ollama  (qwen2.5:1.5b or ABOUTNESS_OLLAMA_MODEL, localhost:11434)
 *
 * No DB writes. No embeddings. Text generation only.
 * Writes results to tmp/aboutness-ab-pilot-results.md and .json
 *
 * RUN:
 *   DATABASE_URL=<url> OPENAI_API_KEY=<key> \
 *     pnpm -C apps/api exec tsx scripts/ingestion/aboutness-ab-text-pilot.ts
 */

// ── Config ────────────────────────────────────────────────────────────────────

const OPENAI_MODEL = process.env.ABOUTNESS_OPENAI_MODEL ?? 'gpt-4o-mini';
const OLLAMA_MODEL = process.env.ABOUTNESS_OLLAMA_MODEL ?? 'qwen2.5:1.5b';
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const MAX_CHARS = 500;

// Same system prompt for both providers
const SYSTEM_PROMPT = `You write compact "aboutness" profiles for songs — sensory, experiential descriptions of what a song feels like to listen to.

Given only the song title and artist name, describe the song's mood, energy, emotional themes, and setting. Be specific and evocative. Avoid generic filler. Do not quote lyrics. Do not invent specific facts or backstory unless you are very confident. If unsure, say so.

Requirements:
- Max 500 characters total
- Plain English
- End with exactly one tag:
  [confidence: low] or [confidence: medium] or [confidence: high]`;

function userMessage(title: string, artist: string): string {
  return `"${title}" by ${artist}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 1).trimEnd() + '\u2026';
}

function parseConfidence(text: string): 'low' | 'medium' | 'high' {
  const m = text.match(/\[confidence:\s*(low|medium|high)\]/i);
  return (m?.[1]?.toLowerCase() ?? 'low') as 'low' | 'medium' | 'high';
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function generateOpenAI(title: string, artist: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(title, artist) },
    ],
    max_tokens: 200,
    temperature: 0.7,
  });

  return truncate((response.choices[0]?.message?.content ?? '').trim(), MAX_CHARS);
}

// ── Ollama ────────────────────────────────────────────────────────────────────

async function generateOllama(title: string, artist: string): Promise<string> {
  const url = `${OLLAMA_HOST}/api/chat`;
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    options: { temperature: 0.7, num_predict: 200 },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(title, artist) },
    ],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`Ollama request failed: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as any;
  const text = (data?.message?.content ?? '').trim();
  return truncate(text, MAX_CHARS);
}

// ── Song row ──────────────────────────────────────────────────────────────────

interface SongRow {
  id: string;
  mbid: string | null;
  artist: string;
  title: string;
}

interface PilotResult {
  song_id: string;
  mbid: string | null;
  artist: string;
  title: string;
  openai: {
    text: string;
    length: number;
    confidence: string;
  };
  local: {
    model: string;
    text: string;
    length: number;
    confidence: string;
  };
}

// ── Markdown output ───────────────────────────────────────────────────────────

function renderMarkdown(results: PilotResult[]): string {
  const lines: string[] = [];

  lines.push('# Aboutness A/B Pilot Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`OpenAI model: \`${OPENAI_MODEL}\``);
  lines.push(`Local model:  \`${OLLAMA_MODEL}\` (Ollama)`);
  lines.push('');

  // Summary table
  lines.push('## Summary Table');
  lines.push('');
  lines.push('| # | Artist | Title | MBID | OpenAI conf | Local conf | OpenAI len | Local len |');
  lines.push('|---|--------|-------|------|-------------|------------|------------|-----------|');
  results.forEach((r, i) => {
    const mbid = r.mbid ?? '—';
    lines.push(
      `| ${i + 1} | ${r.artist} | ${r.title} | ${mbid} | ${r.openai.confidence} | ${r.local.confidence} | ${r.openai.length} | ${r.local.length} |`,
    );
  });

  lines.push('');
  lines.push('---');
  lines.push('');

  // Per-song detail
  lines.push('## Song Details');
  results.forEach((r, i) => {
    lines.push('');
    lines.push(`### Song ${i + 1}: "${r.title}" by ${r.artist}`);
    lines.push('');
    lines.push(`- **song_id:** \`${r.song_id}\``);
    lines.push(`- **mbid:** \`${r.mbid ?? 'null'}\``);
    lines.push(`- **artist:** ${r.artist}`);
    lines.push(`- **title:** ${r.title}`);
    lines.push('');

    lines.push('#### OpenAI (`' + OPENAI_MODEL + '`)');
    lines.push('');
    lines.push(`- **confidence:** ${r.openai.confidence}`);
    lines.push(`- **length:** ${r.openai.length} chars`);
    lines.push('');
    lines.push('> ' + r.openai.text.replace(/\n/g, '\n> '));
    lines.push('');

    lines.push('#### Local Ollama (`' + OLLAMA_MODEL + '`)');
    lines.push('');
    lines.push(`- **confidence:** ${r.local.confidence}`);
    lines.push(`- **length:** ${r.local.length} chars`);
    lines.push('');
    lines.push('> ' + r.local.text.replace(/\n/g, '\n> '));
    lines.push('');
    lines.push('---');
  });

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`OpenAI model:  ${OPENAI_MODEL}`);
  console.log(`Ollama model:  ${OLLAMA_MODEL} @ ${OLLAMA_HOST}`);
  console.log('');

  // Verify Ollama is reachable
  try {
    const check = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!check.ok) throw new Error(`Status ${check.status}`);
    const tags = await check.json() as any;
    const models = (tags.models ?? []).map((m: any) => m.name);
    if (!models.includes(OLLAMA_MODEL)) {
      console.error(`Ollama model "${OLLAMA_MODEL}" not found. Installed: ${models.join(', ') || '(none)'}`);
      process.exit(1);
    }
    console.log(`Ollama OK — model "${OLLAMA_MODEL}" available`);
  } catch (err: any) {
    console.error(`Cannot reach Ollama at ${OLLAMA_HOST}: ${err.message}`);
    process.exit(1);
  }

  // Verify OpenAI key
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    process.exit(1);
  }
  console.log('OpenAI OK — key present');
  console.log('');

  await prisma.$connect();

  // Select 10 songs
  const songs = await prisma.$queryRaw<SongRow[]>`
    SELECT id, mbid, artist, title
    FROM songs
    WHERE is_placeholder = false
    ORDER BY RANDOM()
    LIMIT 10
  `;

  console.log('Selected songs:');
  songs.forEach((s, i) => {
    console.log(`  ${i + 1}. "${s.title}" by ${s.artist} [${s.id}]`);
  });
  console.log('');

  const results: PilotResult[] = [];

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    console.log(`[${i + 1}/${songs.length}] "${song.title}" by ${song.artist}`);

    // OpenAI
    process.stdout.write('  OpenAI... ');
    let openaiText = '';
    try {
      openaiText = await generateOpenAI(song.title, song.artist);
      console.log(`done (${openaiText.length} chars, ${parseConfidence(openaiText)})`);
    } catch (err: any) {
      openaiText = `[ERROR: ${err.message}] [confidence: low]`;
      console.log(`ERROR: ${err.message}`);
    }

    // Ollama
    process.stdout.write('  Ollama...  ');
    let ollamaText = '';
    try {
      ollamaText = await generateOllama(song.title, song.artist);
      console.log(`done (${ollamaText.length} chars, ${parseConfidence(ollamaText)})`);
    } catch (err: any) {
      ollamaText = `[ERROR: ${err.message}] [confidence: low]`;
      console.log(`ERROR: ${err.message}`);
    }

    results.push({
      song_id: song.id,
      mbid: song.mbid ?? null,
      artist: song.artist,
      title: song.title,
      openai: {
        text: openaiText,
        length: openaiText.length,
        confidence: parseConfidence(openaiText),
      },
      local: {
        model: OLLAMA_MODEL,
        text: ollamaText,
        length: ollamaText.length,
        confidence: parseConfidence(ollamaText),
      },
    });
  }

  await prisma.$disconnect();

  // Write output files
  const outDir = path.resolve(process.cwd(), '../../tmp');
  fs.mkdirSync(outDir, { recursive: true });

  const mdPath = path.join(outDir, 'aboutness-ab-pilot-results.md');
  const jsonPath = path.join(outDir, 'aboutness-ab-pilot-results.json');

  fs.writeFileSync(mdPath, renderMarkdown(results), 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');

  console.log('');
  console.log('Output files:');
  console.log(`  Markdown: ${mdPath}`);
  console.log(`  JSON:     ${jsonPath}`);
  console.log('');
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
