import OpenAI from 'openai';

/**
 * OpenAI-backed aboutness generator (V2).
 *
 * Generates a compact experiential description of a song using ONLY the song
 * title and artist name — no lyrics, no tags, no external lookups.
 *
 * Output contract:
 *   - ≤500 characters (enforced via truncation)
 *   - Ends with exactly one of: [confidence: low] | [confidence: medium] | [confidence: high]
 *
 * Env vars:
 *   OPENAI_API_KEY          — required
 *   ABOUTNESS_OPENAI_MODEL  — override model (default: gpt-4o-mini)
 *   ABOUTNESS_MAX_CHARS     — override max output length (default: 500)
 */

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_CHARS = 500;

const SYSTEM_PROMPT = `You write compact "aboutness" profiles for songs — sensory, experiential descriptions of what a song feels like to listen to.

Given only the song title and artist name, describe the song's mood, energy, emotional themes, and setting. Be specific and evocative. Avoid generic filler like "a timeless classic" or "beloved by many".

End your response with exactly one of:
[confidence: low]    — you are guessing from the name alone
[confidence: medium] — the title/artist is familiar
[confidence: high]   — you know this specific song well

Total response must be ≤500 characters including the confidence tag. No preamble, no explanations — just the description.`;

export interface OpenAIAboutnessResult {
  text: string;
  confidence: 'low' | 'medium' | 'high';
}

export async function generateAboutnessText(
  title: string,
  artist: string,
  opts?: { model?: string; maxChars?: number },
): Promise<OpenAIAboutnessResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const model = opts?.model ?? process.env.ABOUTNESS_OPENAI_MODEL ?? DEFAULT_MODEL;
  const maxChars =
    opts?.maxChars ?? Number(process.env.ABOUTNESS_MAX_CHARS || DEFAULT_MAX_CHARS);

  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `"${title}" by ${artist}` },
    ],
    max_tokens: 200,
    temperature: 0.7,
  });

  let text = (response.choices[0]?.message?.content ?? '').trim();

  // Enforce max length (truncate before confidence tag if needed)
  if (text.length > maxChars) {
    text = text.substring(0, maxChars - 1).trimEnd() + '\u2026';
  }

  // Parse confidence from the trailing tag
  const confMatch = text.match(/\[confidence:\s*(low|medium|high)\]/i);
  const confidence = (confMatch?.[1]?.toLowerCase() ?? 'low') as 'low' | 'medium' | 'high';

  return { text, confidence };
}
