import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { logger } from '../../src/config/index.js';
import { pipeline } from '@xenova/transformers';

/**
 * Aboutness Backfill Script (V1 — metadata-derived, no LLM)
 *
 * Derives structured "aboutness" profiles from existing song fields
 * (title/artist/album/year/tags/popularity), embeds the aboutness text
 * using the SAME Xenova/all-MiniLM-L6-v2 model as the runtime, and
 * upserts into the song_aboutness table.
 *
 * Flags:
 *   --limit=N         Process at most N songs (default: all)
 *   --batchSize=N     Batch size (default: 32)
 *   --onlyTopN=10000  Limit to top N songs by popularity (default: 10000)
 *   --dry-run         Preview without writing to DB
 *   --version=N       Aboutness version (default: 1)
 *
 * Resume safety:
 *   By default skips songs that already have an aboutness row for the
 *   target version. Safe to re-run at any time.
 *
 * Critical: MUST use same model as runtime (Xenova/all-MiniLM-L6-v2, 384-dim).
 */

const ABOUTNESS_VERSION = 1;
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMS = 384;
const MAX_ABOUTNESS_TEXT = 500;

// ── Embedder ─────────────────────────────────────────────────────────────────

let embedder: any = null;

async function initEmbedder(): Promise<void> {
  logger.info({ model: EMBEDDING_MODEL }, 'Loading embedding model...');
  embedder = await pipeline('feature-extraction', EMBEDDING_MODEL);
  logger.info('Embedding model loaded');
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * DIMS;
    results.push(Array.from(output.data.slice(start, start + DIMS)));
  }
  return results;
}

// ── Aboutness derivation ──────────────────────────────────────────────────────

type AboutnessMode = 'instrumental' | 'lyrics' | 'unknown';
type AboutnessConfidence = 'low' | 'medium' | 'high';

interface AboutnessJson {
  mode: AboutnessMode;
  mood: string[];
  sensory: string[];
  setting: string;
  energy: { level: number; motion: string };
  arc: { start: string; peak: string; end: string };
  themes: string[];
  confidence: AboutnessConfidence;
  source: 'experience-only' | 'metadata-derived' | 'lyrics-provided-by-user';
}

interface SongRow {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  tags: string[];
  popularity: number;
}

// Tag-set vocabulary → meaning mappings
const TAG_MOODS: Record<string, string[]> = {
  'happy': ['joyful', 'upbeat'],
  'sad': ['melancholy', 'wistful'],
  'romantic': ['tender', 'longing'],
  'angry': ['intense', 'fierce'],
  'chill': ['relaxed', 'mellow'],
  'energetic': ['driving', 'kinetic'],
  'melancholy': ['melancholy', 'reflective'],
  'upbeat': ['upbeat', 'bright'],
  'dark': ['brooding', 'shadowy'],
  'uplifting': ['hopeful', 'soaring'],
  'dreamy': ['dreamy', 'hazy'],
  'groovy': ['groovy', 'fluid'],
  'aggressive': ['fierce', 'raw'],
  'peaceful': ['serene', 'still'],
  'nostalgic': ['nostalgic', 'bittersweet'],
  'tense': ['tense', 'unsettled'],
  'playful': ['playful', 'light'],
  'epic': ['grand', 'sweeping'],
  'intimate': ['intimate', 'hushed'],
  'soulful': ['soulful', 'warm'],
};

const TAG_THEMES: Record<string, string[]> = {
  'love': ['love', 'connection'],
  'heartbreak': ['heartbreak', 'loss'],
  'dance': ['movement', 'celebration'],
  'party': ['celebration', 'freedom'],
  'summer': ['warmth', 'sun'],
  'winter': ['cold', 'isolation'],
  'night': ['night', 'darkness'],
  'road': ['journey', 'escape'],
  'rain': ['melancholy', 'rain'],
  'nature': ['nature', 'solitude'],
  'freedom': ['freedom', 'flight'],
  'rebellion': ['rebellion', 'resistance'],
  'nostalgia': ['nostalgia', 'memory'],
  'faith': ['faith', 'transcendence'],
  'struggle': ['struggle', 'perseverance'],
  'triumph': ['triumph', 'victory'],
  'loneliness': ['loneliness', 'isolation'],
  'yearning': ['yearning', 'desire'],
};

const TAG_SETTINGS: Record<string, string> = {
  'night': 'Late night, dim light',
  'summer': 'A hot, hazy afternoon',
  'rain': 'Rain-soaked streets',
  'dance': 'A packed dance floor',
  'road': 'An open highway at dusk',
  'winter': 'A cold, still evening',
  'party': 'A room full of people',
  'nature': 'Open sky and wide spaces',
  'club': 'A crowded club',
  'acoustic': 'A quiet room with bare walls',
  'ambient': 'A vast, echoing space',
};

const TAG_INSTRUMENTALS = new Set([
  'instrumental', 'ambient', 'classical', 'jazz', 'orchestral',
  'electronic', 'post-rock', 'drone', 'new-age', 'folk-instrumental',
]);

const DECADE_THEMES: Record<number, string[]> = {
  1950: ['nostalgia', 'innocence'],
  1960: ['rebellion', 'counterculture'],
  1970: ['freedom', 'groove'],
  1980: ['ambition', 'neon'],
  1990: ['angst', 'discovery'],
  2000: ['identity', 'connection'],
  2010: ['vulnerability', 'self-expression'],
  2020: ['isolation', 'resilience'],
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.substring(0, max - 1).trimEnd() + '…';
}

function pickUnique<T>(arr: T[], n: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const key = String(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
    if (out.length >= n) break;
  }
  return out;
}

function deriveAboutness(song: SongRow): { json: AboutnessJson; text: string } {
  const tags = (song.tags || []).map(t => t.toLowerCase());
  const decade = song.year ? Math.floor(song.year / 10) * 10 : null;

  // ── Mode ─────────────────────────────────────────────────────────────────
  let mode: AboutnessMode = 'unknown';
  const hasInstrumentalTag = tags.some(t => TAG_INSTRUMENTALS.has(t));
  if (hasInstrumentalTag) {
    mode = 'instrumental';
  } else if (tags.some(t => ['pop', 'rock', 'hip-hop', 'r&b', 'country', 'folk', 'soul'].includes(t))) {
    mode = 'lyrics';
  }

  // ── Mood ─────────────────────────────────────────────────────────────────
  const moodSet: string[] = [];
  for (const tag of tags) {
    const mapped = TAG_MOODS[tag];
    if (mapped) moodSet.push(...mapped);
  }
  // Popularity-based mood heuristic
  if (moodSet.length === 0) {
    if (song.popularity >= 70) moodSet.push('bright', 'accessible');
    else if (song.popularity >= 40) moodSet.push('measured', 'considered');
    else moodSet.push('understated', 'sparse');
  }
  const mood = pickUnique(moodSet, 6);
  if (mood.length < 3) mood.push('evocative', 'textured', 'resonant');

  // ── Themes ───────────────────────────────────────────────────────────────
  const themeSet: string[] = [];
  for (const tag of tags) {
    const mapped = TAG_THEMES[tag];
    if (mapped) themeSet.push(...mapped);
  }
  if (decade && DECADE_THEMES[decade]) {
    themeSet.push(...DECADE_THEMES[decade]);
  }
  if (themeSet.length === 0) {
    themeSet.push('experience', 'feeling');
  }
  const themes = pickUnique(themeSet, 6);
  if (themes.length < 3) themes.push('moment', 'texture');

  // ── Setting ──────────────────────────────────────────────────────────────
  let setting = '';
  for (const tag of tags) {
    if (TAG_SETTINGS[tag]) {
      setting = TAG_SETTINGS[tag];
      break;
    }
  }
  if (!setting) {
    if (song.popularity >= 70) setting = 'Any room that needs filling';
    else if (mode === 'instrumental') setting = 'A quiet space to think';
    else setting = 'Wherever the mood finds you';
  }

  // ── Energy ───────────────────────────────────────────────────────────────
  const hasHighEnergy = tags.some(t => ['energetic', 'dance', 'party', 'aggressive', 'club', 'punk', 'metal', 'fast'].includes(t));
  const hasLowEnergy = tags.some(t => ['chill', 'ambient', 'acoustic', 'slow', 'peaceful', 'ballad', 'dream', 'drone'].includes(t));
  let energyLevel: number;
  let energyMotion: string;
  if (hasHighEnergy && !hasLowEnergy) {
    energyLevel = 70 + Math.round((song.popularity / 100) * 25);
    energyMotion = 'driving';
  } else if (hasLowEnergy && !hasHighEnergy) {
    energyLevel = 15 + Math.round((song.popularity / 100) * 25);
    energyMotion = 'drifting';
  } else {
    energyLevel = 35 + Math.round((song.popularity / 100) * 30);
    energyMotion = 'flowing';
  }
  energyLevel = Math.min(100, Math.max(0, energyLevel));

  // ── Arc ──────────────────────────────────────────────────────────────────
  let arc = { start: '', peak: '', end: '' };
  if (hasHighEnergy) {
    arc = {
      start: truncate('Opens with momentum', 60),
      peak: truncate('Builds to full release', 60),
      end: truncate('Fades with energy spent', 60),
    };
  } else if (hasLowEnergy) {
    arc = {
      start: truncate('Begins quietly', 60),
      peak: truncate('Settles into stillness', 60),
      end: truncate('Dissolves softly', 60),
    };
  } else {
    arc = {
      start: truncate('Opens with intention', 60),
      peak: truncate('Reaches its emotional centre', 60),
      end: truncate('Resolves with feeling', 60),
    };
  }

  // ── Sensory phrases ──────────────────────────────────────────────────────
  const sensoryPool: string[] = [];
  if (hasHighEnergy) sensoryPool.push('rhythmic pulse', 'forward motion');
  if (hasLowEnergy) sensoryPool.push('gentle drift', 'soft warmth');
  if (mode === 'instrumental') sensoryPool.push('wordless expression', 'pure tone');
  if (tags.includes('bass')) sensoryPool.push('deep resonance');
  if (tags.includes('vocal')) sensoryPool.push('human voice, close and present');
  if (sensoryPool.length === 0) sensoryPool.push('layered texture', 'dynamic arc');
  const sensory = pickUnique(sensoryPool, 4);
  if (sensory.length < 2) sensory.push('tonal depth', 'rhythmic breath');

  // ── Confidence ───────────────────────────────────────────────────────────
  const tagRichness = tags.length;
  let confidence: AboutnessConfidence;
  if (tagRichness >= 5) confidence = 'medium';
  else if (tagRichness >= 2) confidence = 'low';
  else confidence = 'low';

  const json: AboutnessJson = {
    mode,
    mood: mood.slice(0, 8),
    sensory: sensory.slice(0, 5),
    setting: truncate(setting, 120),
    energy: { level: energyLevel, motion: energyMotion },
    arc,
    themes: themes.slice(0, 8),
    confidence,
    source: 'metadata-derived',
  };

  // ── Text rendering ───────────────────────────────────────────────────────
  const yearStr = song.year ? ` (${song.year})` : '';
  const moodStr = mood.slice(0, 3).join(', ');
  const themeStr = themes.slice(0, 3).join(', ');
  const text = truncate(
    `${song.title} by ${song.artist}${yearStr}. ` +
    `Mood: ${moodStr}. ` +
    `Themes: ${themeStr}. ` +
    `Setting: ${setting}. ` +
    `Energy: ${energyMotion} (${energyLevel}/100). ` +
    `${mode !== 'unknown' ? `Mode: ${mode}. ` : ''}` +
    `Sensory: ${sensory.slice(0, 2).join('; ')}.`,
    MAX_ABOUTNESS_TEXT
  );

  return { json, text };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const cmdLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  const batchArg = args.find(a => a.startsWith('--batchSize='));
  const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 32;
  const topNArg = args.find(a => a.startsWith('--onlyTopN='));
  const onlyTopN = topNArg ? parseInt(topNArg.split('=')[1], 10) : 10_000;
  const versionArg = args.find(a => a.startsWith('--version='));
  const version = versionArg ? parseInt(versionArg.split('=')[1], 10) : ABOUTNESS_VERSION;

  logger.info({
    dryRun,
    batchSize,
    onlyTopN,
    version,
    limit: cmdLimit ?? 'none',
  }, 'Aboutness backfill starting');

  await prisma.$connect();

  // Count how many songs in scope (top N by popularity, missing aboutness for this version)
  const totalEligible = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM (
      SELECT s.id
      FROM songs s
      LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${version}
      WHERE sa.song_id IS NULL
        AND s.is_placeholder = false
      ORDER BY s.popularity DESC
      LIMIT ${onlyTopN}
    ) sub
  `;

  const totalRows = Number(totalEligible[0]?.count ?? 0);
  const total = cmdLimit ? Math.min(totalRows, cmdLimit) : totalRows;

  logger.info({ total, onlyTopN, version }, 'Songs needing aboutness generation');

  if (total === 0) {
    logger.info('Nothing to do — all eligible songs already have aboutness for this version');
    await prisma.$disconnect();
    return;
  }

  if (!dryRun) {
    await initEmbedder();
  }

  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  while (processed < total) {
    // Select next batch: top-N by popularity, missing aboutness for this version
    // Consistent ordering is important for resumability — same songs every run
    const songs = await prisma.$queryRaw<SongRow[]>`
      SELECT s.id, s.title, s.artist, s.album, s.year, s.tags, s.popularity
      FROM songs s
      LEFT JOIN song_aboutness sa ON sa.song_id = s.id AND sa.aboutness_version = ${version}
      WHERE sa.song_id IS NULL
        AND s.is_placeholder = false
      ORDER BY s.popularity DESC, s.id ASC
      LIMIT ${onlyTopN}
      OFFSET ${processed}
    `;

    if (songs.length === 0) break;

    // Apply cmd limit slice
    const batch = songs.slice(0, Math.min(batchSize, total - processed));
    if (batch.length === 0) break;

    if (dryRun) {
      for (const s of batch) {
        const { text, json } = deriveAboutness(s);
        logger.info({ id: s.id, title: s.title, textLen: text.length, text, json }, '[DRY RUN] Would generate');
      }
      processed += batch.length;
      continue;
    }

    // Derive aboutness for batch
    const derived = batch.map(s => ({ song: s, ...deriveAboutness(s) }));

    try {
      // Batch embed all aboutness texts
      const texts = derived.map(d => d.text);
      const embeddings = await embedBatch(texts);

      // Build bulk upsert values
      const valueRows = derived.map((d, i) => {
        const vec = `'[${embeddings[i].join(',')}]'::vector(384)`;
        const textEscaped = d.text.replace(/'/g, "''");
        const jsonStr = JSON.stringify(d.json).replace(/'/g, "''");
        const now = new Date().toISOString();
        return (
          `('${d.song.id}'::uuid, '${textEscaped}', '${jsonStr}'::jsonb, ${vec}, ` +
          `${version}, '${EMBEDDING_MODEL}', '${now}'::timestamptz)`
        );
      }).join(',\n');

      await prisma.$executeRawUnsafe(`
        INSERT INTO song_aboutness
          (song_id, aboutness_text, aboutness_json, aboutness_vector,
           aboutness_version, embedding_model, generated_at)
        VALUES ${valueRows}
        ON CONFLICT (song_id) DO UPDATE SET
          aboutness_text    = EXCLUDED.aboutness_text,
          aboutness_json    = EXCLUDED.aboutness_json,
          aboutness_vector  = EXCLUDED.aboutness_vector,
          aboutness_version = EXCLUDED.aboutness_version,
          embedding_model   = EXCLUDED.embedding_model,
          generated_at      = EXCLUDED.generated_at
      `);

      processed += batch.length;
    } catch (err: any) {
      logger.error({ error: err.message }, 'Batch failed');
      errors += batch.length;
      processed += batch.length; // advance to avoid infinite loop on bad batch
    }

    // Progress log
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const eta = rate > 0 ? ((total - processed) / rate).toFixed(0) : '?';
    const pct = ((processed / total) * 100).toFixed(1);
    logger.info({
      progress: `${processed}/${total} (${pct}%)`,
      rate: `${rate.toFixed(1)} songs/s`,
      eta: `${eta}s remaining`,
      errors,
    }, 'Aboutness backfill progress');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info('='.repeat(60));
  logger.info('ABOUTNESS BACKFILL SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Version:   ${version}`);
  logger.info(`Model:     ${EMBEDDING_MODEL} (${DIMS}-dim)`);
  logger.info(`Scope:     top ${onlyTopN} by popularity`);
  logger.info(`Total:     ${total}`);
  logger.info(`Processed: ${processed}`);
  logger.info(`Errors:    ${errors}`);
  logger.info(`Time:      ${elapsed}s`);
  logger.info(`Mode:      ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  logger.info('='.repeat(60));

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ error: err.message }, 'Aboutness backfill failed');
  process.exit(1);
});
