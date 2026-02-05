import 'dotenv/config';
import { prisma } from '../../src/services/database.js';
import { logger } from '../../src/config/index.js';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { isPlaceholderSong, getPlaceholderReason } from '../utils/placeholder-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MusicBrainz Bulk Importer
 *
 * Imports songs from JSONL output of musicbrainz-genre-fetcher.ts
 * Features:
 * - Placeholder detection (rejects fake songs)
 * - MBID/ISRC deduplication
 * - Sets isPlaceholder=false for all imported songs
 * - Dry-run mode
 * - Progress tracking
 */

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
  placeholders: number;
  errors: number;
  quarantine: Array<{ song: SongRecord; reason: string }>;
}

class BulkImporter {
  private stats: Stats = {
    total: 0,
    imported: 0,
    skipped: 0,
    placeholders: 0,
    errors: 0,
    quarantine: []
  };
  private dryRun: boolean;
  private quarantineFile?: string;

  constructor(dryRun = false, quarantineFile?: string) {
    this.dryRun = dryRun;
    this.quarantineFile = quarantineFile;
  }

  /**
   * Check if song is placeholder
   */
  private checkPlaceholder(song: SongRecord): string | null {
    const reason = getPlaceholderReason({
      title: song.title,
      artist: song.artist,
      phrases: song.tags.join(',') // Check tags as phrases too
    });
    return reason;
  }

  /**
   * Upsert song into database
   */
  private async upsertSong(song: SongRecord): Promise<'imported' | 'skipped' | 'error'> {
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

      // Insert new song with isPlaceholder=false
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
          isPlaceholder: false // CRITICAL: Always false for MusicBrainz imports
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
   * Import from JSONL file
   */
  async importFromJsonl(filePath: string): Promise<void> {
    logger.info({ filePath, dryRun: this.dryRun }, 'Starting bulk import');

    await prisma.$connect();

    try {
      const fileStream = createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        this.stats.total++;

        try {
          const song: SongRecord = JSON.parse(line);

          // Placeholder detection
          const placeholderReason = this.checkPlaceholder(song);
          if (placeholderReason) {
            logger.warn({ song, reason: placeholderReason }, 'Rejected placeholder song');
            this.stats.placeholders++;
            this.stats.quarantine.push({ song, reason: placeholderReason });
            continue;
          }

          // Import
          const result = await this.upsertSong(song);

          if (result === 'imported') {
            this.stats.imported++;
          } else if (result === 'skipped') {
            this.stats.skipped++;
          } else {
            this.stats.errors++;
          }

          // Progress every 100 songs
          if (this.stats.total % 100 === 0) {
            logger.info({
              total: this.stats.total,
              imported: this.stats.imported,
              skipped: this.stats.skipped,
              placeholders: this.stats.placeholders,
              errors: this.stats.errors
            }, 'Import progress');
          }

        } catch (error: any) {
          logger.error({ error: error.message, line }, 'Failed to parse line');
          this.stats.errors++;
        }
      }

      // Write quarantine file if any placeholders found
      if (this.stats.quarantine.length > 0 && this.quarantineFile) {
        const quarantineContent = this.stats.quarantine
          .map(q => `${q.song.title} — ${q.song.artist} | Reason: ${q.reason}`)
          .join('\n');
        await fs.writeFile(this.quarantineFile, quarantineContent, 'utf-8');
        logger.info({ file: this.quarantineFile, count: this.stats.quarantine.length }, 'Wrote quarantine file');
      }

    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Get import statistics
   */
  getStats(): Stats {
    return this.stats;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArg = args.find(arg => !arg.startsWith('--'));
  const inputFile = fileArg || path.join(__dirname, 'musicbrainz-50k.jsonl');
  const quarantineFile = inputFile.replace(/\.jsonl$/, '.quarantine.txt');

  const importer = new BulkImporter(dryRun, quarantineFile);
  await importer.importFromJsonl(inputFile);

  const stats = importer.getStats();

  logger.info('='.repeat(60));
  logger.info('IMPORT SUMMARY');
  logger.info('='.repeat(60));
  logger.info(`Total:         ${stats.total}`);
  logger.info(`Imported:      ${stats.imported}`);
  logger.info(`Skipped:       ${stats.skipped} (already exist)`);
  logger.info(`Placeholders:  ${stats.placeholders} (REJECTED)`);
  logger.info(`Errors:        ${stats.errors}`);
  logger.info(`Mode:          ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  logger.info('='.repeat(60));

  if (stats.placeholders > 0) {
    logger.warn('⚠️  Placeholder songs were REJECTED and quarantined');
    logger.warn(`⚠️  See: ${quarantineFile}`);
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
