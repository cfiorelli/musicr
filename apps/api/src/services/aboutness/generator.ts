import OpenAI from 'openai';

/**
 * Aboutness V2 — Canonical OpenAI generator
 *
 * Generates emotions and moments aboutness profiles using ONLY title + artist.
 * No album / year / tags / lyrics / external metadata in prompts.
 *
 * Both functions:
 *   - Use gpt-4o-mini (ABOUTNESS_OPENAI_MODEL override)
 *   - Enforce ≤100 char output (clean text, no confidence tag suffix)
 *   - Retry once if output is invalid
 *   - Return { text, confidence, model, provider }
 *
 * Output contract:
 *   - 50–90 chars target, hard cap 100
 *   - 1 sentence or very short phrase, plain English
 *   - No lyric quotes, no invented facts
 *   - Ends with: [confidence: low] | [confidence: medium] | [confidence: high]
 *     (tag parsed and stripped before storing; only clean text stored)
 *   - Confidence = how certain model is that description fits THIS specific song
 *
 * Batch API:
 *   - generateAboutnessBatch(songs): 10 songs per OpenAI call as JSON
 *   - Falls back to individual calls on parse error or missing entries
 */

export type Confidence = 'low' | 'medium' | 'high';

export interface AboutnessResult {
  text: string;
  confidence: Confidence;
  model: string;
  provider: 'openai';
}

export interface BatchSongInput {
  song_id: string;
  title: string;
  artist: string;
}

export interface BatchSongResult {
  song_id: string;
  emotions: AboutnessResult;
  moments: AboutnessResult;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_CHARS = 120; // buffer for confidence tag during generation; stored text capped at 100
const STORED_MAX_CHARS = 100;

// ── Prompts ───────────────────────────────────────────────────────────────────

const EMOTIONS_SYSTEM = `You write ultra-compact "aboutness" phrases describing what a song feels like.

Given only the song title and artist name, describe the song's mood, energy, and emotional texture in ONE short phrase. Be vivid and specific. Avoid "haunting", "beautiful", "heartfelt" without context.

Requirements:
- 50 to 90 characters target (hard cap 100)
- One phrase or very short sentence, plain English, no lists
- End with exactly one tag: [confidence: low] or [confidence: medium] or [confidence: high]
- confidence = how confident you are the description fits THIS specific song
- If unsure, use [confidence: low]`;

const MOMENTS_SYSTEM = `You write ultra-compact "aboutness" phrases describing when and where a song fits.

Given only the song title and artist name, describe the social context, activity, or setting in ONE short phrase. Prefer concrete scene cues. Avoid "perfect for", "ideal for", "great for" constructions.

Requirements:
- 50 to 90 characters target (hard cap 100)
- One phrase or very short sentence, plain English, no lists
- End with exactly one tag: [confidence: low] or [confidence: medium] or [confidence: high]
- confidence = how confident you are the description fits THIS specific song
- If unsure, use [confidence: low]`;

const BATCH_SYSTEM = `You write ultra-compact "aboutness" phrases for songs. For each song provided, output a JSON array where each element has:
- "song_id": the provided id (copy exactly)
- "emotions": one short phrase (50–90 chars) describing mood/energy/texture, ending with [confidence: low/medium/high]
- "moments": one short phrase (50–90 chars) describing scene/activity/setting, ending with [confidence: low/medium/high]

Rules for each phrase:
- Hard cap 100 characters including the confidence tag
- Plain English, no lists, no "perfect for", no "ideal for", no "great for"
- Specific over generic; avoid "haunting", "beautiful", "heartfelt" without context
- If unsure about a song, use [confidence: low]

Output ONLY valid JSON array, no markdown, no prose.`;

// ── Validation & helpers ───────────────────────────────────────────────────────

function parseConfidence(text: string): Confidence | null {
  const m = text.match(/\[confidence:\s*(low|medium|high)\]\s*$/i);
  return m ? (m[1].toLowerCase() as Confidence) : null;
}

function stripConfidenceTag(text: string): string {
  return text.replace(/\s*\[confidence:\s*(low|medium|high)\]\s*$/i, '').trim();
}

function validateOutput(text: string): string | null {
  if (!text || text.trim().length === 0) return 'empty response';
  if (text.length > MAX_CHARS) return `too long: ${text.length} chars`;
  if (!parseConfidence(text)) return 'missing or malformed confidence tag';
  if (/^confidence:/i.test(text.trim())) return 'starts with "Confidence:" — bad format';
  return null; // valid
}

function truncate(s: string): string {
  if (s.length <= MAX_CHARS) return s;
  return s.substring(0, MAX_CHARS - 1).trimEnd() + '\u2026';
}

// ── Rate-limit retry ───────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [15_000, 30_000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if ((status === 429 || err?.message?.includes('429')) && attempt < delays.length) {
        console.warn(`  [429] Rate limit hit, waiting ${delays[attempt] / 1000}s before retry ${attempt + 1}...`);
        await sleep(delays[attempt]);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Rate limit retry exhausted'); // unreachable but satisfies TS
}

// ── Core caller ───────────────────────────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

async function callOpenAI(
  systemPrompt: string,
  userContent: string,
  model: string,
  maxTokens: number,
): Promise<string> {
  const client = getClient();
  const response = await withRateLimitRetry(() =>
    client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  );
  return (response.choices[0]?.message?.content ?? '').trim();
}

async function generate(
  systemPrompt: string,
  title: string,
  artist: string,
): Promise<AboutnessResult> {
  const model = process.env.ABOUTNESS_OPENAI_MODEL ?? DEFAULT_MODEL;

  let text = await callOpenAI(systemPrompt, `"${title}" by ${artist}`, model, 50);
  text = truncate(text);

  let err = validateOutput(text);

  // Retry once if invalid
  if (err) {
    text = await callOpenAI(systemPrompt, `"${title}" by ${artist}`, model, 50);
    text = truncate(text);
    err = validateOutput(text);
    if (err) {
      // Still invalid — force a minimal valid response
      if (!parseConfidence(text)) {
        const base = text.substring(0, 80).trimEnd();
        text = `${base} [confidence: low]`.substring(0, MAX_CHARS);
      }
    }
  }

  const confidence = parseConfidence(text) ?? 'low';
  const cleanText = stripConfidenceTag(text).substring(0, STORED_MAX_CHARS);

  return { text: cleanText, confidence, model, provider: 'openai' };
}

// ── Batch generation ───────────────────────────────────────────────────────────

interface BatchResponseEntry {
  song_id: string;
  emotions: string;
  moments: string;
}

async function generateAboutnessBatchRaw(
  songs: BatchSongInput[],
  model: string,
): Promise<BatchResponseEntry[]> {
  const userContent = songs
    .map(s => `{"song_id":"${s.song_id}","title":${JSON.stringify(s.title)},"artist":${JSON.stringify(s.artist)}}`)
    .join('\n');

  const maxTokens = songs.length * 150; // ~150 tokens per song (generous buffer for JSON structure)
  const raw = await callOpenAI(BATCH_SYSTEM, userContent, model, maxTokens);

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned) as BatchResponseEntry[];
}

/**
 * Generate emotions + moments aboutness profiles for a batch of songs in a
 * single OpenAI call. Falls back to individual calls for any song that
 * fails JSON parsing or is missing from the response.
 *
 * Batch size: up to 10 songs per call (caller should chunk).
 */
export async function generateAboutnessBatch(
  songs: BatchSongInput[],
): Promise<BatchSongResult[]> {
  const model = process.env.ABOUTNESS_OPENAI_MODEL ?? DEFAULT_MODEL;
  const results: BatchSongResult[] = [];
  const fallbackIds = new Set<string>();

  // Attempt batch call
  let batchEntries: BatchResponseEntry[] = [];
  try {
    batchEntries = await generateAboutnessBatchRaw(songs, model);
  } catch (err: any) {
    console.warn(`  [batch] JSON parse/call failed (${err.message}), falling back all ${songs.length} songs to individual calls`);
    fallbackIds.add('ALL');
  }

  if (!fallbackIds.has('ALL')) {
    // Build a lookup for fast access
    const entryMap = new Map<string, BatchResponseEntry>();
    for (const e of batchEntries) {
      if (e && typeof e.song_id === 'string') entryMap.set(e.song_id, e);
    }

    for (const song of songs) {
      const entry = entryMap.get(song.song_id);
      if (!entry || typeof entry.emotions !== 'string' || typeof entry.moments !== 'string') {
        fallbackIds.add(song.song_id);
        continue;
      }

      // Parse and validate emotions
      const eConf = parseConfidence(entry.emotions) ?? 'low';
      const eText = stripConfidenceTag(entry.emotions).substring(0, STORED_MAX_CHARS);

      // Parse and validate moments
      const mConf = parseConfidence(entry.moments) ?? 'low';
      const mText = stripConfidenceTag(entry.moments).substring(0, STORED_MAX_CHARS);

      results.push({
        song_id: song.song_id,
        emotions: { text: eText, confidence: eConf, model, provider: 'openai' },
        moments: { text: mText, confidence: mConf, model, provider: 'openai' },
      });
    }
  }

  // Individual fallback for failed songs
  const fallbackSongs = fallbackIds.has('ALL')
    ? songs
    : songs.filter(s => fallbackIds.has(s.song_id));

  for (const song of fallbackSongs) {
    try {
      const [emotions, moments] = await Promise.all([
        generate(EMOTIONS_SYSTEM, song.title, song.artist),
        generate(MOMENTS_SYSTEM, song.title, song.artist),
      ]);
      results.push({ song_id: song.song_id, emotions, moments });
    } catch (err: any) {
      console.error(`  [fallback] Failed for "${song.title}" by ${song.artist}: ${err.message}`);
      // Return placeholder so caller can track the failure
      results.push({
        song_id: song.song_id,
        emotions: { text: 'unknown', confidence: 'low', model, provider: 'openai' },
        moments: { text: 'unknown', confidence: 'low', model, provider: 'openai' },
      });
    }
  }

  return results;
}

// ── Public API (single-song) ───────────────────────────────────────────────────

/**
 * Generate an emotions aboutness profile.
 * Describes what the song feels like: mood, energy, arc, texture.
 * Returns clean text (no confidence tag suffix).
 */
export async function generateEmotionsAboutness(
  title: string,
  artist: string,
): Promise<AboutnessResult> {
  return generate(EMOTIONS_SYSTEM, title, artist);
}

/**
 * Generate a moments aboutness profile.
 * Describes when/where the song fits: scene, activity, time, social context.
 * Returns clean text (no confidence tag suffix).
 */
export async function generateMomentsAboutness(
  title: string,
  artist: string,
): Promise<AboutnessResult> {
  return generate(MOMENTS_SYSTEM, title, artist);
}
