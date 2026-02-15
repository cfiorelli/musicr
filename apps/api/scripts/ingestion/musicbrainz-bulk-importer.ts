import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { logger } from '../../src/config/index.js';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { isPlaceholderSong, getPlaceholderReason } from '../utils/placeholder-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MusicBrainz Bulk Importer
 *
 * Imports songs from JSONL output of musicbrainz-genre-fetcher.ts
 * Features:
 * - Placeholder detection (rejects fake songs)
 * - MBID/ISRC/title+artist deduplication
 * - Diversity caps: MAX_PER_ARTIST_NEW, MAX_PER_ALBUM_PER_ARTIST_NEW
 * - import_batch_id for rollback
 * - DB size safety check (stops at STOP_THRESHOLD)
 * - Dry-run mode
 * - Progress tracking
 */

const MAX_PER_ARTIST_NEW = 50;
const MAX_PER_ALBUM_PER_ARTIST_NEW = 25;
const STOP_THRESHOLD_BYTES = 3.5 * 1024 * 1024 * 1024; // 3.5 GB
const DB_CHECK_INTERVAL = 500; // Check DB size every N imports

interface SongRecord {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  tags: string[];
  mbid: string;
  isrc?: string;
  source: string;
  sourceUrl: string;
}

interface Stats {
  total: number;
  imported: number;
  skipped: number;
  skippedDiversity: number;
  placeholders: number;
  errors: number;
  quarantine: Array<{ song: SongRecord; reason: string }>;
}

class BulkImporter {
  private stats: Stats = {
    total: 0,
    imported: 0,
    skipped: 0,
    skippedDiversity: 0,
    placeholders: 0,
    errors: 0,
    quarantine: []
  };
  private dryRun: boolean;
  private quarantineFile?: string;
  private importBatchId: string;
  private dbSizeStopped = false;

  // Diversity tracking for NEW imports only (this batch)
  private artistNewCount = new Map<string, number>();
  private albumNewCount = new Map<string, number>(); // key: "artist|||album"

  constructor(dryRun = false, quarantineFile?: string, importBatchId?: string) {
    this.dryRun = dryRun;
    this.quarantineFile = quarantineFile;
    this.importBatchId = importBatchId || randomUUID();
  }

  /**
   * Check if song is placeholder
   */
  private checkPlaceholder(song: SongRecord): string | null {
    const reason = getPlaceholderReason({
      title: song.title,
      artist: song.artist,
      phrases: song.tags.join(','),
      source: song.source,
      mbid: song.mbid
    });
    return reason;
  }

  /**
   * Check diversity caps for a candidate song (NEW imports only)
   */
  private checkDiversityCaps(song: SongRecord): string | null {
    const artistKey = song.artist.toLowerCase();
    const artistCount = this.artistNewCount.get(artistKey) || 0;
    if (artistCount >= MAX_PER_ARTIST_NEW) {
      return `artist cap reached (${MAX_PER_ARTIST_NEW})`;
    }

    if (song.album) {
      const albumKey = `${artistKey}|||${song.album.toLowerCase()}`;
      const albumCount = this.albumNewCount.get(albumKey) || 0;
      if (albumCount >= MAX_PER_ALBUM_PER_ARTIST_NEW) {
        return `album cap reached (${MAX_PER_ALBUM_PER_ARTIST_NEW})`;
      }
    }

    return null;
  }

  /**
   * Track diversity counts after successful import
   */
  private trackDiversity(song: SongRecord): void {
    const artistKey = song.artist.toLowerCase();
    this.artistNewCount.set(artistKey, (this.artistNewCount.get(artistKey) || 0) + 1);
    if (song.album) {
      const albumKey = `${artistKey}|||${song.album.toLowerCase()}`;
      this.albumNewCount.set(albumKey, (this.albumNewCount.get(albumKey) || 0) + 1);
    }
  }

  /**
   * Check DB size; return true if safe to continue
   */
  private async checkDbSize(): Promise<boolean> {
    try {
      const result = await prisma.$queryRaw<Array<{ bytes: bigint }>>`
        SELECT pg_database_size(current_database()) AS bytes
      `;
      const bytes = Number(result[0].bytes);
      const prettyMB = (bytes / (1024 * 1024)).toFixed(0);
      logger.info({ dbSizeMB: prettyMB, thresholdMB: (STOP_THRESHOLD_BYTES / (1024 * 1024)).toFixed(0) }, 'DB size check');
      return bytes < STOP_THRESHOLD_BYTES;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to check DB size, continuing cautiously');
      return true;
    }
  }

  /**
   * Upsert song into database
   */
  private async upsertSong(song: SongRecord): Promise<'imported' | 'skipped' | 'error'> {
    if (this.dryRun) {
      logger.info({ song: { title: song.title, artist: song.artist } }, '[DRY RUN] Would import song');
      return 'imported';
    }

    try {
      // Check if song exists by ISRC, MBID, or lower(title)+lower(artist)
      const existing = await prisma.song.findFirst({
        where: {
          OR: [
            song.isrc ? { isrc: song.isrc } : {},
            { mbid: song.mbid },
            { title: { equals: song.title, mode: 'insensitive' }, artist: { equals: song.artist, mode: 'insensitive' } }
          ].filter(obj => Object.keys(obj).length > 0)
        }
      });

      if (existing) {
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
          popularity: 0,
          isPlaceholder: false,
          importBatchId: this.importBatchId
        }
      });

      return 'imported';

    } catch (error: any) {
      // Unique constraint violations are expected (ISRC/MBID race)
      if (error.code === 'P2002') {
        return 'skipped';
      }
      logger.error({ error: error.message, song: { title: song.title, artist: song.artist } }, 'Failed to upsert song');
      return 'error';
    }
  }

  /**
   * Import from JSONL file
   */
  async importFromJsonl(filePath: string): Promise<void> {
    logger.info({ filePath, dryRun: this.dryRun, importBatchId: this.importBatchId }, 'Starting bulk import');

    if (!this.dryRun) {
      await prisma.$connect();
    }

    // Initial DB size check
    if (!this.dryRun) {
      const safe = await this.checkDbSize();
      if (!safe) {
        logger.error('DB size already at/above threshold. Aborting.');
        this.dbSizeStopped = true;
        return;
      }
    }

    try {
      const fileStream = createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        if (this.dbSizeStopped) break;

        this.stats.total++;

        try {
          const song: SongRecord = JSON.parse(line);

          // Placeholder detection
          const placeholderReason = this.checkPlaceholder(song);
          if (placeholderReason) {
            this.stats.placeholders++;
            this.stats.quarantine.push({ song, reason: placeholderReason });
            continue;
          }

          // Diversity cap check
          const diversityReason = this.checkDiversityCaps(song);
          if (diversityReason) {
            this.stats.skippedDiversity++;
            continue;
          }

          // Import
          const result = await this.upsertSong(song);

          if (result === 'imported') {
            this.stats.imported++;
            this.trackDiversity(song);
          } else if (result === 'skipped') {
            this.stats.skipped++;
          } else {
            this.stats.errors++;
          }

          // Progress every 500 songs
          if (this.stats.total % 500 === 0) {
            logger.info({
              total: this.stats.total,
              imported: this.stats.imported,
              skipped: this.stats.skipped,
              skippedDiversity: this.stats.skippedDiversity,
              placeholders: this.stats.placeholders,
              errors: this.stats.errors,
              importBatchId: this.importBatchId
            }, 'Import progress');
          }

          // Periodic DB size check
          if (!this.dryRun && this.stats.imported > 0 && this.stats.imported % DB_CHECK_INTERVAL === 0) {
            const safe = await this.checkDbSize();
            if (!safe) {
              logger.error({ imported: this.stats.imported }, 'DB size threshold reached. Stopping import safely.');
              this.dbSizeStopped = true;
              break;
            }
          }

        } catch (error: any) {
          logger.error({ error: error.message }, 'Failed to parse line');
          this.stats.errors++;
        }
      }

      // Write quarantine file
      if (this.stats.quarantine.length > 0 && this.quarantineFile) {
        const quarantineContent = this.stats.quarantine
          .map(q => `${q.song.title} — ${q.song.artist} | Reason: ${q.reason}`)
          .join('\n');
        await fs.writeFile(this.quarantineFile, quarantineContent, 'utf-8');
        logger.info({ file: this.quarantineFile, count: this.stats.quarantine.length }, 'Wrote quarantine file');
      }

    } finally {
      if (!this.dryRun) {
        await prisma.$disconnect();
      }
    }
  }

  getStats(): Stats {
    return this.stats;
  }

  getImportBatchId(): string {
    return this.importBatchId;
  }

  wasDbSizeStopped(): boolean {
    return this.dbSizeStopped;
  }
}

/**
 * Main execution
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const dryRun = args.includes('--dry-run');

  // Parse --in=PATH
  let inputFile: string;
  const inArgIdx = args.findIndex(arg => arg === '--in' || arg.startsWith('--in='));
  if (inArgIdx !== -1) {
    const inArg = args[inArgIdx];
    if (inArg.startsWith('--in=')) {
      inputFile = inArg.split('=')[1];
    } else if (inArgIdx + 1 < args.length) {
      inputFile = args[inArgIdx + 1];
    } else {
      inputFile = path.join(__dirname, 'musicbrainz-50k.jsonl');
    }
  } else {
    const fileArg = args.find(arg => !arg.startsWith('--'));
    inputFile = fileArg || path.join(__dirname, 'musicbrainz-50k.jsonl');
  }

  if (!path.isAbsolute(inputFile)) {
    inputFile = path.resolve(process.cwd(), inputFile);
  }

  const quarantineFile = inputFile.replace(/\.jsonl$/, '.quarantine.txt');

  logger.info({ inputFile, dryRun, quarantineFile }, 'MusicBrainz Bulk Importer - Starting');

  const importer = new BulkImporter(dryRun, quarantineFile);
  await importer.importFromJsonl(inputFile);

  const stats = importer.getStats();

  logger.info('='.repeat(60));
  logger.info('IMPORT SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Batch ID:      ${importer.getImportBatchId()}`);
  logger.info(`Total:         ${stats.total}`);
  logger.info(`Imported:      ${stats.imported}`);
  logger.info(`Skipped:       ${stats.skipped} (already exist)`);
  logger.info(`Skip/Diversity:${stats.skippedDiversity} (diversity caps)`);
  logger.info(`Placeholders:  ${stats.placeholders} (REJECTED)`);
  logger.info(`Errors:        ${stats.errors}`);
  logger.info(`Mode:          ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (importer.wasDbSizeStopped()) {
    logger.warn('⚠️  Import stopped early due to DB size threshold (3.5 GB)');
  }
  logger.info('='.repeat(60));
  logger.info(`ROLLBACK: DELETE FROM songs WHERE import_batch_id = '${importer.getImportBatchId()}';`);
  logger.info('='.repeat(60));

  if (stats.placeholders > 0) {
    logger.warn(`Placeholder songs REJECTED and quarantined: ${quarantineFile}`);
  }

  if (stats.imported > 0) {
    logger.info('Next steps:');
    logger.info('  1. Run: pnpm catalog:embed');
    logger.info('  2. Run: pnpm catalog:verify');
  }

  process.exit(0);
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Import failed');
  process.exit(1);
});
