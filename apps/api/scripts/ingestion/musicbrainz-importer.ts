import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { logger } from '../../src/config/index.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MusicBrainz API Importer
 *
 * Imports song metadata from MusicBrainz with:
 * - Rate limiting (1 req/sec)
 * - ISRC/MBID deduplication
 * - Dry-run mode
 */

interface ArtistSeed {
  name: string;
  mbid: string;
  maxTracks: number;
}

interface Config {
  rateLimit: number;
  userAgent: string;
  targetTotal: number;
  maxPerArtist: number;
}

interface SeedData {
  artists: ArtistSeed[];
  config: Config;
}

interface MusicBrainzRecording {
  id: string;
  title: string;
  length?: number;
  'first-release-date'?: string;
  'artist-credit'?: Array<{
    artist: {
      name: string;
      id: string;
    };
  }>;
  releases?: Array<{
    title: string;
    date?: string;
  }>;
  isrcs?: string[];
  tags?: Array<{ count: number; name: string }>;
}

interface NormalizedSong {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  mbid: string;
  isrc?: string;
  tags: string[];
  source: string;
  sourceUrl: string;
}

class MusicBrainzImporter {
  private config: Config;
  private artists: ArtistSeed[];
  private importedCount = 0;
  private skippedCount = 0;
  private errorCount = 0;
  private dryRun: boolean;

  constructor(seedData: SeedData, dryRun = false) {
    this.config = seedData.config;
    this.artists = seedData.artists;
    this.dryRun = dryRun;
  }

  /**
   * Rate-limited fetch from MusicBrainz API
   */
  private async fetchMusicBrainz(url: string): Promise<any> {
    await this.sleep(this.config.rateLimit);

    const response = await fetch(url, {
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 503) {
        logger.warn('MusicBrainz rate limit hit, waiting 5 seconds...');
        await this.sleep(5000);
        return this.fetchMusicBrainz(url);
      }
      throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch recordings for an artist
   */
  private async fetchArtistRecordings(artistMbid: string, limit: number): Promise<MusicBrainzRecording[]> {
    const offset = 0;
    const recordings: MusicBrainzRecording[] = [];

    try {
      // Fetch recordings in batches
      const batchSize = 100;
      for (let i = 0; i < Math.ceil(limit / batchSize); i++) {
        const currentOffset = offset + (i * batchSize);
        const currentLimit = Math.min(batchSize, limit - recordings.length);

        const url = `https://musicbrainz.org/ws/2/recording?artist=${artistMbid}&limit=${currentLimit}&offset=${currentOffset}&inc=artist-credits+releases+isrcs+tags&fmt=json`;

        logger.info(`Fetching batch ${i + 1} for artist ${artistMbid} (offset: ${currentOffset}, limit: ${currentLimit})`);

        const data = await this.fetchMusicBrainz(url);

        if (!data.recordings || data.recordings.length === 0) {
          break;
        }

        recordings.push(...data.recordings);

        if (recordings.length >= limit || data.recordings.length < currentLimit) {
          break;
        }
      }

      return recordings;
    } catch (error: any) {
      logger.error({ error: error.message, artistMbid }, 'Failed to fetch recordings');
      return [];
    }
  }

  /**
   * Normalize MusicBrainz recording to our song format
   */
  private normalizeSong(recording: MusicBrainzRecording): NormalizedSong | null {
    try {
      // Extract artist name from first credit
      const artistName = recording['artist-credit']?.[0]?.artist?.name;
      if (!artistName) {
        return null;
      }

      // Extract title
      const title = recording.title?.trim();
      if (!title) {
        return null;
      }

      // Extract album from first release
      const album = recording.releases?.[0]?.title?.trim();

      // Extract year from first release date
      let year: number | undefined;
      const releaseDate = recording['first-release-date'] || recording.releases?.[0]?.date;
      if (releaseDate) {
        const yearMatch = releaseDate.match(/^(\d{4})/);
        if (yearMatch) {
          year = parseInt(yearMatch[1], 10);
        }
      }

      // Extract ISRC (prefer first one)
      const isrc = recording.isrcs?.[0];

      // Extract tags (top 5 by count)
      const tags = (recording.tags || [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(t => t.name);

      return {
        title: this.normalizeText(title),
        artist: this.normalizeText(artistName),
        album: album ? this.normalizeText(album) : undefined,
        year,
        mbid: recording.id,
        isrc: isrc ? this.normalizeIsrc(isrc) : undefined,
        tags,
        source: 'musicbrainz',
        sourceUrl: `https://musicbrainz.org/recording/${recording.id}`
      };
    } catch (error: any) {
      logger.error({ error: error.message, recording }, 'Failed to normalize recording');
      return null;
    }
  }

  /**
   * Normalize text: trim, collapse whitespace
   */
  private normalizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
  }

  /**
   * Normalize ISRC: uppercase, remove hyphens/spaces
   */
  private normalizeIsrc(isrc: string): string {
    return isrc.toUpperCase().replace(/[-\s]/g, '');
  }

  /**
   * Upsert song into database
   */
  private async upsertSong(song: NormalizedSong): Promise<'imported' | 'skipped' | 'error'> {
    if (this.dryRun) {
      logger.info({ song }, '[DRY RUN] Would import song');
      return 'imported';
    }

    try {
      // Check if song exists by ISRC or MBID
      const existing = await prisma.song.findFirst({
        where: {
          OR: [
            song.isrc ? { isrc: song.isrc } : {},
            { mbid: song.mbid }
          ].filter(obj => Object.keys(obj).length > 0)
        }
      });

      if (existing) {
        logger.debug({ title: song.title, artist: song.artist, id: existing.id }, 'Song already exists, skipping');
        return 'skipped';
      }

      // Insert new song
      await prisma.song.create({
        data: {
          title: song.title,
          artist: song.artist,
          album: song.album,
          year: song.year,
          mbid: song.mbid,
          isrc: song.isrc,
          tags: song.tags,
          source: song.source,
          sourceUrl: song.sourceUrl,
          popularity: 0
        }
      });

      logger.info({ title: song.title, artist: song.artist, mbid: song.mbid }, 'Imported song');
      return 'imported';

    } catch (error: any) {
      logger.error({ error: error.message, song }, 'Failed to upsert song');
      return 'error';
    }
  }

  /**
   * Import songs from all artists
   */
  async importAll(targetTotal?: number): Promise<void> {
    const target = targetTotal || this.config.targetTotal;
    logger.info({ target, artistCount: this.artists.length, dryRun: this.dryRun }, 'Starting MusicBrainz import');

    await prisma.$connect();

    try {
      for (const artist of this.artists) {
        if (this.importedCount >= target) {
          logger.info('Reached target count, stopping import');
          break;
        }

        logger.info({ artist: artist.name, mbid: artist.mbid }, 'Processing artist');

        const recordings = await this.fetchArtistRecordings(artist.mbid, artist.maxTracks);
        logger.info({ artist: artist.name, count: recordings.length }, 'Fetched recordings');

        for (const recording of recordings) {
          if (this.importedCount >= target) {
            break;
          }

          const normalized = this.normalizeSong(recording);
          if (!normalized) {
            this.errorCount++;
            continue;
          }

          const result = await this.upsertSong(normalized);

          if (result === 'imported') {
            this.importedCount++;
          } else if (result === 'skipped') {
            this.skippedCount++;
          } else {
            this.errorCount++;
          }

          // Log progress every 50 songs
          if ((this.importedCount + this.skippedCount) % 50 === 0) {
            logger.info({
              imported: this.importedCount,
              skipped: this.skippedCount,
              errors: this.errorCount,
              target
            }, 'Import progress');
          }
        }
      }

      logger.info({
        imported: this.importedCount,
        skipped: this.skippedCount,
        errors: this.errorCount,
        dryRun: this.dryRun
      }, 'Import complete');

    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Get import statistics
   */
  getStats() {
    return {
      imported: this.importedCount,
      skipped: this.skippedCount,
      errors: this.errorCount
    };
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetArg = args.find(arg => arg.startsWith('--target='));
  const target = targetArg ? parseInt(targetArg.split('=')[1], 10) : undefined;

  // Load seed data
  const seedPath = path.join(__dirname, 'artist-seeds.json');
  const seedData: SeedData = JSON.parse(await fs.readFile(seedPath, 'utf-8'));

  // Run importer
  const importer = new MusicBrainzImporter(seedData, dryRun);
  await importer.importAll(target);

  const stats = importer.getStats();

  logger.info('='.repeat(60));
  logger.info('IMPORT SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Imported: ${stats.imported}`);
  logger.info(`Skipped:  ${stats.skipped}`);
  logger.info(`Errors:   ${stats.errors}`);
  logger.info(`Mode:     ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  logger.info('='.repeat(60));

  process.exit(0);
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Import failed');
  process.exit(1);
});
