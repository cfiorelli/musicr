import OpenAI from 'openai';

/**
 * Aboutness V2 — Canonical OpenAI generator
 *
 * Generates emotions and moments aboutness profiles using ONLY title + artist.
 * No album / year / tags / lyrics / external metadata in prompts.
 *
 * Both functions:
 *   - Use gpt-4o-mini (ABOUTNESS_OPENAI_MODEL override)
 *   - Enforce ≤500 char output
 *   - Retry once if output is invalid (bad tag | >500 chars | wrong format)
 *   - Return { text, confidence, model, provider }
 *
 * Output contract:
 *   - 220–420 chars target, hard cap 500
 *   - 1 paragraph, plain English, no lists
 *   - No lyric quotes, no invented facts
 *   - Ends with: [confidence: low] | [confidence: medium] | [confidence: high]
 *   - Confidence = how certain model is that description fits THIS specific song
 */

export type Confidence = 'low' | 'medium' | 'high';

export interface AboutnessResult {
  text: string;
  confidence: Confidence;
  model: string;
  provider: 'openai';
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_CHARS = 500;

// ── Prompts ───────────────────────────────────────────────────────────────────

const EMOTIONS_SYSTEM = `You write compact "aboutness" profiles describing what a song feels like to listen to.

Given only the song title and artist name, describe the song's mood, emotional arc, energy level, and sonic texture. Focus on the internal emotional experience a listener might have. Be vivid and specific. Avoid generic descriptors like "haunting" or "beautiful" without context. Do not quote lyrics. Do not invent facts unless you are very confident.

Requirements:
- 220 to 420 characters target (hard cap 500)
- 1 paragraph, plain English, no lists, no headers
- End with exactly one tag: [confidence: low] or [confidence: medium] or [confidence: high]
- confidence = how confident you are the description is correct for THIS specific song (not writing quality)
- If you are unsure, say so in the text and use [confidence: low]`;

const MOMENTS_SYSTEM = `You write compact "aboutness" profiles describing when and where a song fits — the scenes, activities, and moments it belongs to.

Given only the song title and artist name, describe the social context, time of day, activity, or setting that fits this song. Prefer concrete scene cues over generic phrases. For example: "sketching alone at 1am with one lamp on" rather than "ideal for late-night study." Avoid "perfect for", "ideal for", "great for" constructions. Do not quote lyrics. Do not invent facts unless you are very confident.

Requirements:
- 220 to 420 characters target (hard cap 500)
- 1 paragraph, plain English, no lists, no headers
- End with exactly one tag: [confidence: low] or [confidence: medium] or [confidence: high]
- confidence = how confident you are the description is correct for THIS specific song (not writing quality)
- If you are unsure, say so in the text and use [confidence: low]`;

// ── Validation ────────────────────────────────────────────────────────────────

function parseConfidence(text: string): Confidence | null {
  const m = text.match(/\[confidence:\s*(low|medium|high)\]\s*$/i);
  return m ? (m[1].toLowerCase() as Confidence) : null;
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
  title: string,
  artist: string,
  model: string,
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `"${title}" by ${artist}` },
    ],
    max_tokens: 200,
    temperature: 0.7,
  });
  return (response.choices[0]?.message?.content ?? '').trim();
}

async function generate(
  systemPrompt: string,
  title: string,
  artist: string,
): Promise<AboutnessResult> {
  const model = process.env.ABOUTNESS_OPENAI_MODEL ?? DEFAULT_MODEL;

  let text = await callOpenAI(systemPrompt, title, artist, model);
  text = truncate(text);

  let err = validateOutput(text);

  // Retry once if invalid
  if (err) {
    text = await callOpenAI(systemPrompt, title, artist, model);
    text = truncate(text);
    err = validateOutput(text);
    if (err) {
      // If still invalid after retry, force a minimal valid response
      // rather than crashing — caller gets low-confidence output
      if (!parseConfidence(text)) {
        text = truncate(text) + ' [confidence: low]';
        if (text.length > MAX_CHARS) {
          text = text.substring(0, MAX_CHARS - 20).trimEnd() + '… [confidence: low]';
        }
      }
    }
  }

  const confidence = parseConfidence(text) ?? 'low';

  return { text, confidence, model, provider: 'openai' };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate an emotions aboutness profile.
 * Describes what the song feels like: mood, energy, arc, texture.
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
 */
export async function generateMomentsAboutness(
  title: string,
  artist: string,
): Promise<AboutnessResult> {
  return generate(MOMENTS_SYSTEM, title, artist);
}
