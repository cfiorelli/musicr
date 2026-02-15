import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MusicBrainz Genre-Based Fetcher
 *
 * Fetches 50k+ REAL recordings from MusicBrainz by querying popular genres/tags.
 * Outputs JSONL for import via musicbrainz-bulk-importer.ts
 *
 * Features:
 * - Genre/tag-based querying (not artist-based)
 * - Resumable with checkpoint file
 * - Deduplication by MBID
 * - Rate limiting (1 req/sec)
 * - Outputs JSONL (one JSON object per line)
 */

interface MBRecording {
  id: string;
  title: string;
  'artist-credit'?: Array<{
    artist: {
      name: string;
      id: string;
    };
  }>;
  'first-release-date'?: string;
  releases?: Array<{
    title: string;
    date?: string;
  }>;
  tags?: Array<{ count: number; name: string }>;
  isrcs?: string[];
}

interface SongRecord {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  tags: string[];
  mbid: string;
  isrc?: string;
  source: 'musicbrainz';
  sourceUrl: string;
}

interface Checkpoint {
  totalFetched: number;
  totalUnique: number;
  tagIndex: number;
  offset: number;
  seenMbids: string[];
  lastUpdate: string;
}

const BROAD_GENRES = [
  // Core genres (original 24)
  'rock', 'pop', 'hip hop', 'electronic', 'jazz', 'metal',
  'indie', 'punk', 'country', 'r&b', 'folk', 'classical',
  'reggae', 'soul', 'blues', 'alternative', 'dance', 'funk',
  'disco', 'house', 'techno', 'dubstep', 'ska', 'grunge',
  // Expanded genres for diversity
  'latin', 'bossa nova', 'k-pop', 'j-pop', 'afrobeat', 'world',
  'gospel', 'new wave', 'shoegaze', 'post-punk', 'emo', 'trap',
  'ambient', 'lo-fi', 'synthwave', 'noise', 'experimental',
  'progressive rock', 'psychedelic', 'garage rock', 'britpop',
  'trip hop', 'drum and bass', 'trance', 'downtempo', 'idm',
  'swing', 'bebop', 'fusion', 'smooth jazz',
  'bluegrass', 'americana', 'outlaw country', 'honky tonk',
  'hardcore', 'death metal', 'black metal', 'doom metal', 'thrash metal',
  'indie pop', 'indie rock', 'chamber pop', 'dream pop', 'noise pop',
  'singer-songwriter', 'acoustic', 'ballad',
  'samba', 'cumbia', 'reggaeton', 'bachata', 'salsa', 'merengue',
  'afro-cuban', 'highlife', 'mbalax', 'soukous',
  'opera', 'choral', 'baroque', 'romantic', 'contemporary classical',
  'soundtrack', 'musical', 'spoken word',
  'new age', 'meditation', 'chillout',
];

class MusicBrainzGenreFetcher {
  private outputFile: string;
  private checkpointFile: string;
  private userAgent = 'Musicr/1.0 (https://github.com/yourorg/musicr; contact@musicr.app)';
  private rateLimit = 1000; // 1 req/sec
  private targetTotal: number;
  private checkpoint: Checkpoint;

  constructor(outputPath: string, targetTotal = 50000) {
    this.outputFile = outputPath;
    this.checkpointFile = outputPath.replace(/\.(jsonl|json)$/, '.checkpoint.json');
    this.targetTotal = targetTotal;
    this.checkpoint = {
      totalFetched: 0,
      totalUnique: 0,
      tagIndex: 0,
      offset: 0,
      seenMbids: [],
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Load checkpoint if exists
   */
  private async loadCheckpoint(): Promise<void> {
    try {
      const data = await fs.readFile(this.checkpointFile, 'utf-8');
      this.checkpoint = JSON.parse(data);
      logger.info({ checkpoint: this.checkpoint }, 'Loaded checkpoint, resuming...');
    } catch (error) {
      logger.info('No checkpoint found, starting fresh');
    }
  }

  /**
   * Save checkpoint
   */
  private async saveCheckpoint(): Promise<void> {
    this.checkpoint.lastUpdate = new Date().toISOString();
    await fs.writeFile(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2));
  }

  /**
   * Rate-limited fetch from MusicBrainz
   */
  private async fetchMB(url: string): Promise<any> {
    await this.sleep(this.rateLimit);

    const response = await fetch(url, {
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 503 || response.status === 429) {
        logger.warn('Rate limit hit, waiting 5 seconds...');
        await this.sleep(5000);
        return this.fetchMB(url); // Retry
      }
      throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Normalize text
   */
  private normalizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ').replace(/^["']|["']$/g, '');
  }

  /**
   * Normalize song record
   */
  private normalizeSong(rec: MBRecording): SongRecord | null {
    try {
      const artistName = rec['artist-credit']?.[0]?.artist?.name;
      if (!artistName || !rec.title) return null;

      const album = rec.releases?.[0]?.title;
      let year: number | undefined;
      const releaseDate = rec['first-release-date'] || rec.releases?.[0]?.date;
      if (releaseDate) {
        const match = releaseDate.match(/^(\d{4})/);
        if (match) year = parseInt(match[1], 10);
      }

      const tags = (rec.tags || [])
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(t => t.name);

      return {
        title: this.normalizeText(rec.title),
        artist: this.normalizeText(artistName),
        album: album ? this.normalizeText(album) : undefined,
        year,
        tags,
        mbid: rec.id,
        isrc: rec.isrcs?.[0],
        source: 'musicbrainz',
        sourceUrl: `https://musicbrainz.org/recording/${rec.id}`
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to normalize recording');
      return null;
    }
  }

  /**
   * Fetch recordings for a tag
   */
  private async fetchTag(tag: string, limit: number, offset: number): Promise<MBRecording[]> {
    const query = `tag:${encodeURIComponent(tag)}`;
    const url = `https://musicbrainz.org/ws/2/recording?query=${query}&limit=${limit}&offset=${offset}&inc=artist-credits+releases+tags+isrcs&fmt=json`;

    logger.info({ tag, limit, offset }, 'Fetching tag batch');

    try {
      const data = await this.fetchMB(url);
      return data.recordings || [];
    } catch (error: any) {
      logger.error({ error: error.message, tag }, 'Failed to fetch tag');
      return [];
    }
  }

  /**
   * Append song to JSONL file
   */
  private async appendSong(song: SongRecord): Promise<void> {
    const line = JSON.stringify(song) + '\n';
    await fs.appendFile(this.outputFile, line, 'utf-8');
  }

  /**
   * Main fetch loop
   */
  async fetch(): Promise<void> {
    await this.loadCheckpoint();

    logger.info({
      target: this.targetTotal,
      resuming: this.checkpoint.totalUnique > 0,
      progress: `${this.checkpoint.totalUnique}/${this.targetTotal}`
    }, 'Starting genre-based fetch');

    const seenMbids = new Set(this.checkpoint.seenMbids);

    // Resume from last tag and offset
    for (let tagIdx = this.checkpoint.tagIndex; tagIdx < BROAD_GENRES.length; tagIdx++) {
      if (this.checkpoint.totalUnique >= this.targetTotal) {
        logger.info('Reached target count, stopping');
        break;
      }

      const tag = BROAD_GENRES[tagIdx];
      const startOffset = (tagIdx === this.checkpoint.tagIndex) ? this.checkpoint.offset : 0;

      logger.info({ tag, tagIdx: `${tagIdx + 1}/${BROAD_GENRES.length}` }, 'Processing tag');

      // Fetch in batches of 100 (MusicBrainz max)
      for (let offset = startOffset; offset < 5000; offset += 100) {
        if (this.checkpoint.totalUnique >= this.targetTotal) {
          break;
        }

        const recordings = await this.fetchTag(tag, 100, offset);

        if (recordings.length === 0) {
          logger.info({ tag }, 'No more recordings for tag, moving to next');
          break;
        }

        this.checkpoint.totalFetched += recordings.length;

        for (const rec of recordings) {
          if (this.checkpoint.totalUnique >= this.targetTotal) {
            break;
          }

          // Skip if already seen
          if (seenMbids.has(rec.id)) {
            continue;
          }

          const song = this.normalizeSong(rec);
          if (!song) {
            continue;
          }

          // Write to JSONL
          await this.appendSong(song);

          seenMbids.add(rec.id);
          this.checkpoint.totalUnique++;

          // Log progress every 100 unique songs
          if (this.checkpoint.totalUnique % 100 === 0) {
            logger.info({
              unique: this.checkpoint.totalUnique,
              fetched: this.checkpoint.totalFetched,
              target: this.targetTotal,
              percent: ((this.checkpoint.totalUnique / this.targetTotal) * 100).toFixed(1),
              tag,
              offset
            }, 'Fetch progress');
          }
        }

        // Update checkpoint
        this.checkpoint.tagIndex = tagIdx;
        this.checkpoint.offset = offset + 100;
        this.checkpoint.seenMbids = Array.from(seenMbids);
        await this.saveCheckpoint();
      }

      // Reset offset for next tag
      this.checkpoint.offset = 0;
    }

    logger.info({
      totalUnique: this.checkpoint.totalUnique,
      totalFetched: this.checkpoint.totalFetched,
      dedupeRate: ((1 - (this.checkpoint.totalUnique / this.checkpoint.totalFetched)) * 100).toFixed(1)
    }, 'Fetch complete');
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  const targetArg = args.find(arg => arg.startsWith('--target='));
  const target = targetArg ? parseInt(targetArg.split('=')[1], 10) : 50000;

  const outArg = args.find(arg => arg.startsWith('--out='));
  const defaultOutput = path.join(__dirname, 'musicbrainz-50k.jsonl');
  let outputPath = outArg ? outArg.split('=')[1] : defaultOutput;

  // Resolve relative paths
  if (!path.isAbsolute(outputPath)) {
    outputPath = path.resolve(process.cwd(), outputPath);
  }

  const checkpointArg = args.find(arg => arg.startsWith('--checkpoint='));
  let checkpointPath: string | undefined;
  if (checkpointArg) {
    checkpointPath = checkpointArg.split('=')[1];
    if (!path.isAbsolute(checkpointPath)) {
      checkpointPath = path.resolve(process.cwd(), checkpointPath);
    }
  }

  logger.info({
    target,
    outputPath,
    checkpointPath: checkpointPath || `${outputPath.replace(/\.(jsonl|json)$/, '.checkpoint.json')}`,
    genres: BROAD_GENRES
  }, 'MusicBrainz Genre Fetcher');

  const fetcher = new MusicBrainzGenreFetcher(outputPath, target);

  // Override checkpoint path if provided
  if (checkpointPath) {
    (fetcher as any).checkpointFile = checkpointPath;
  }

  await fetcher.fetch();

  logger.info('='.repeat(60));
  logger.info('FETCH COMPLETE');
  logger.info('='.repeat(60));
  logger.info(`Output: ${outputPath}`);
  logger.info(`Checkpoint: ${(fetcher as any).checkpointFile}`);
  logger.info('='.repeat(60));
  logger.info('Next steps:');
  logger.info('  1. Run: pnpm catalog:mb:import');
  logger.info('  2. Run: pnpm catalog:embed');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info('Usage examples:');
  logger.info('  pnpm catalog:mb:fetch');
  logger.info('  pnpm catalog:mb:fetch --target=10000');
  logger.info('  pnpm catalog:mb:fetch --out=./custom.jsonl');
  logger.info('  pnpm catalog:mb:fetch --out=./foo.jsonl --checkpoint=./foo.checkpoint.json');
  logger.info('');

  process.exit(0);
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Fetch failed');
  process.exit(1);
});
