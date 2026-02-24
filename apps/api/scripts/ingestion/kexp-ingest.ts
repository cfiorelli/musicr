/**
 * KEXP Ingestion Script
 *
 * Fetches KEXP public play history and imports track plays into Musicr.
 *
 * Usage:
 *   pnpm tsx scripts/ingestion/kexp-ingest.ts [flags]
 *
 * Flags:
 *   --dry-run          Fetch and log only; no DB writes
 *   --limit=N          Stop after N track plays processed
 *   --page-limit=N     Stop after N API pages fetched
 *   --incremental      Resume from checkpoint cursor (last stored airdate)
 *   --start-date=ISO   Fetch plays from this date onward (e.g. 2025-01-01)
 *   --end-date=ISO     Fetch plays up to this date
 *
 * After running, queue embedding backfill for new songs:
 *   pnpm tsx scripts/ingestion/embedding-backfill.ts --limit=5000
 */

import 'dotenv/config';
import { prisma } from '../../src/services/database.js';

const KEXP_API = 'https://api.kexp.org/v2/plays/';
const PAGE_SIZE = 200;
const SOURCE = 'kexp';
const RETRY_DELAYS = [1000, 2000, 4000]; // ms

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const INCREMENTAL = args.includes('--incremental');
const LIMIT = (() => {
  const a = args.find(a => a.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : Infinity;
})();
const PAGE_LIMIT = (() => {
  const a = args.find(a => a.startsWith('--page-limit='));
  return a ? parseInt(a.split('=')[1], 10) : Infinity;
})();
const START_DATE = (() => {
  const a = args.find(a => a.startsWith('--start-date='));
  return a ? a.split('=')[1] : undefined;
})();
const END_DATE = (() => {
  const a = args.find(a => a.startsWith('--end-date='));
  return a ? a.split('=')[1] : undefined;
})();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface KexpPlay {
  id: number;
  airdate: string;
  play_type: string;
  song: string | null;
  artist: string | null;
  album: string | null;
  recording_id: string | null; // MusicBrainz recording ID
  release_date: string | null; // e.g. "2003" or "2003-01-15"
  comment: string | null;
}

interface KexpPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: KexpPlay[];
}

interface Stats {
  pagesFetched: number;
  playsTotal: number;
  trackPlays: number;
  provenanceInserted: number;
  songsMatchedExisting: number;
  songsInserted: number;
  skippedInvalid: number;
  duplicatesSkipped: number;
  errors: number;
  newSongsNeedingEmbedding: string[]; // song IDs
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function parseYear(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

async function fetchWithRetry(url: string): Promise<KexpPage> {
  let lastError: unknown;
  for (let i = 0; i < RETRY_DELAYS.length + 1; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        const delay = RETRY_DELAYS[i] ?? 8000;
        console.log(`  [rate limit] waiting ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json() as KexpPage;
    } catch (err) {
      lastError = err;
      if (i < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[i];
        console.log(`  [retry ${i + 1}] waiting ${delay}ms after error: ${(err as Error).message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

async function loadCheckpoint(): Promise<string | null> {
  const cp = await prisma.ingestionCheckpoint.findUnique({ where: { source: SOURCE } });
  return cp?.cursor ?? null;
}

async function saveCheckpoint(cursor: string, extra?: Record<string, unknown>): Promise<void> {
  await prisma.ingestionCheckpoint.upsert({
    where: { source: SOURCE },
    create: { source: SOURCE, cursor, metadata: extra ?? {} },
    update: { cursor, metadata: extra ?? {} },
  });
}

// Match a play to an existing song. Returns songId or null.
async function findExistingSong(play: KexpPlay): Promise<string | null> {
  // 1. MBID match (most reliable)
  if (play.recording_id) {
    const song = await prisma.song.findFirst({
      where: { mbid: play.recording_id },
      select: { id: true },
    });
    if (song) return song.id;
  }

  // 2. Normalized title + artist match (raw SQL for case-insensitive compare)
  const normTitle = normalizeName(play.song!);
  const normArtist = normalizeName(play.artist!);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM songs
    WHERE lower(trim(title)) = ${normTitle}
      AND lower(trim(artist)) = ${normArtist}
      AND is_placeholder = false
    LIMIT 1
  `;
  if (rows.length > 0) return rows[0].id;

  return null;
}

// Insert a new song from KEXP data. Returns new songId.
async function insertNewSong(play: KexpPlay): Promise<string> {
  const year = parseYear(play.release_date);
  const created = await prisma.song.create({
    data: {
      title: play.song!,
      artist: play.artist!,
      album: play.album ?? undefined,
      year,
      source: SOURCE,
      mbid: play.recording_id ?? undefined,
      isPlaceholder: false,
      embeddingVersion: 0, // signals "needs embedding"
    },
    select: { id: true },
  });
  return created.id;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== KEXP Ingestion ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'WRITE'} | incremental=${INCREMENTAL} | limit=${LIMIT} | page-limit=${PAGE_LIMIT}`);
  if (START_DATE) console.log(`  start-date: ${START_DATE}`);
  if (END_DATE)   console.log(`  end-date:   ${END_DATE}`);
  console.log('');

  const stats: Stats = {
    pagesFetched: 0,
    playsTotal: 0,
    trackPlays: 0,
    provenanceInserted: 0,
    songsMatchedExisting: 0,
    songsInserted: 0,
    skippedInvalid: 0,
    duplicatesSkipped: 0,
    errors: 0,
    newSongsNeedingEmbedding: [],
  };

  // Determine starting cursor for incremental mode
  let incrementalCursor: string | null = null;
  if (INCREMENTAL) {
    incrementalCursor = await loadCheckpoint();
    if (incrementalCursor) {
      console.log(`Resuming from checkpoint cursor: ${incrementalCursor}`);
    } else {
      console.log('No checkpoint found — starting from most recent plays');
    }
  }

  // Build initial URL
  let url = `${KEXP_API}?limit=${PAGE_SIZE}&ordering=-airdate`;
  if (END_DATE)   url += `&before=${encodeURIComponent(END_DATE)}`;
  if (START_DATE) url += `&after=${encodeURIComponent(START_DATE)}`;

  let trackPlaysProcessed = 0;
  let done = false;
  let lastAirdateSeen: string | null = null;

  while (url && !done) {
    // Enforce page limit
    if (stats.pagesFetched >= PAGE_LIMIT) {
      console.log(`Page limit (${PAGE_LIMIT}) reached — stopping`);
      break;
    }

    console.log(`Fetching page ${stats.pagesFetched + 1}: ${url.slice(0, 100)}...`);
    let page: KexpPage;
    try {
      page = await fetchWithRetry(url);
    } catch (err) {
      console.error(`  [ERROR] Failed to fetch page: ${(err as Error).message}`);
      stats.errors++;
      break;
    }

    stats.pagesFetched++;
    stats.playsTotal += page.results.length;
    console.log(`  → ${page.results.length} plays on this page (total in API: ${page.count})`);

    for (const play of page.results) {
      // Incremental: stop if we've reached plays older than checkpoint
      if (incrementalCursor && play.airdate <= incrementalCursor) {
        console.log(`  Reached checkpoint cursor (${incrementalCursor}) — stopping`);
        done = true;
        break;
      }

      // Track most recent airdate for checkpoint
      if (!lastAirdateSeen || play.airdate > lastAirdateSeen) {
        lastAirdateSeen = play.airdate;
      }

      // Filter: track plays only
      if (play.play_type !== 'trackplay') continue;

      stats.trackPlays++;

      // Validate required fields
      if (!play.song?.trim() || !play.artist?.trim()) {
        stats.skippedInvalid++;
        continue;
      }

      const sourcePlayId = String(play.id);

      if (DRY_RUN) {
        console.log(`  [dry-run] Would process: "${play.song}" — ${play.artist} (${play.airdate})`);
        trackPlaysProcessed++;
        if (trackPlaysProcessed >= LIMIT) { done = true; break; }
        continue;
      }

      // Check for duplicate provenance row
      const existingProvenance = await prisma.externalPlay.findUnique({
        where: { source_sourcePlayId: { source: SOURCE, sourcePlayId } },
        select: { id: true },
      });
      if (existingProvenance) {
        stats.duplicatesSkipped++;
        continue;
      }

      try {
        // Find or create song
        let songId: string | null = await findExistingSong(play);
        let isNewSong = false;

        if (songId) {
          stats.songsMatchedExisting++;
        } else {
          songId = await insertNewSong(play);
          stats.songsInserted++;
          stats.newSongsNeedingEmbedding.push(songId);
          isNewSong = true;
        }

        // Insert provenance record
        await prisma.externalPlay.create({
          data: {
            source: SOURCE,
            sourcePlayId,
            title: play.song!.trim(),
            artist: play.artist!.trim(),
            album: play.album?.trim() ?? undefined,
            airdate: play.airdate ? new Date(play.airdate) : undefined,
            mbid: play.recording_id ?? undefined,
            year: parseYear(play.release_date),
            songId,
          },
        });
        stats.provenanceInserted++;

        console.log(`  [${isNewSong ? 'NEW' : 'matched'}] "${play.song}" — ${play.artist} (${play.airdate})`);
      } catch (err) {
        console.error(`  [ERROR] play ${sourcePlayId}: ${(err as Error).message}`);
        stats.errors++;
      }

      trackPlaysProcessed++;
      if (trackPlaysProcessed >= LIMIT) {
        console.log(`Track play limit (${LIMIT}) reached — stopping`);
        done = true;
        break;
      }
    }

    // Save checkpoint after each page (most recent airdate processed)
    if (!DRY_RUN && lastAirdateSeen) {
      await saveCheckpoint(lastAirdateSeen, {
        pagesFetched: stats.pagesFetched,
        lastRun: new Date().toISOString(),
      });
    }

    // Advance to next page
    url = page.next ?? '';
    if (!url) {
      console.log('No more pages — done');
      break;
    }

    // Polite delay between pages
    await new Promise(r => setTimeout(r, 250));
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('');
  console.log('=== KEXP Ingestion Summary ===');
  console.log(`  Pages fetched:            ${stats.pagesFetched}`);
  console.log(`  Total plays seen:         ${stats.playsTotal}`);
  console.log(`  Track plays:              ${stats.trackPlays}`);
  console.log(`  Provenance rows inserted: ${stats.provenanceInserted}`);
  console.log(`  Songs matched existing:   ${stats.songsMatchedExisting}`);
  console.log(`  New songs inserted:       ${stats.songsInserted}`);
  console.log(`  Skipped (no title/artist):${stats.skippedInvalid}`);
  console.log(`  Duplicates skipped:       ${stats.duplicatesSkipped}`);
  console.log(`  Errors:                   ${stats.errors}`);
  if (stats.newSongsNeedingEmbedding.length > 0) {
    console.log('');
    console.log(`  ⚠️  ${stats.newSongsNeedingEmbedding.length} new songs need embedding backfill. Run:`);
    console.log('    pnpm tsx scripts/ingestion/embedding-backfill.ts --limit=5000');
  }
  if (DRY_RUN) {
    console.log('');
    console.log('  [DRY-RUN] No changes were written to the database.');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
