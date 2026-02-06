import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import { isPlaceholderSong, getPlaceholderReason } from './utils/placeholder-detector.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Catalog Safety Check
 *
 * Verifies that no placeholder/synthetic songs exist in:
 * - Database (songs table)
 * - Catalog files (data/songs_seed.csv)
 *
 * Exits with code 1 if any placeholders are found.
 * Use in CI/pre-deploy checks.
 */

interface CheckResult {
  location: string;
  totalChecked: number;
  placeholdersFound: number;
  violations: Array<{
    title: string;
    artist: string;
    reason: string;
  }>;
}

async function checkDatabase(): Promise<CheckResult> {
  const result: CheckResult = {
    location: 'database',
    totalChecked: 0,
    placeholdersFound: 0,
    violations: []
  };

  await prisma.$connect();

  try {
    // Get all songs
    const songs = await prisma.song.findMany({
      select: {
        title: true,
        artist: true,
        phrases: true
      }
    });

    result.totalChecked = songs.length;

    for (const song of songs) {
      const reason = getPlaceholderReason({
        title: song.title,
        artist: song.artist,
        phrases: song.phrases.join(',')
      });

      if (reason) {
        result.placeholdersFound++;
        result.violations.push({
          title: song.title,
          artist: song.artist,
          reason
        });
      }
    }

  } finally {
    await prisma.$disconnect();
  }

  return result;
}

async function checkCatalogFile(filePath: string): Promise<CheckResult> {
  const result: CheckResult = {
    location: filePath,
    totalChecked: 0,
    placeholdersFound: 0,
    violations: []
  };

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    // Skip header
    const dataLines = lines.slice(1);
    result.totalChecked = dataLines.length;

    for (const line of dataLines) {
      if (!line.trim()) continue;

      // Parse CSV (simple split by comma, assumes no commas in titles/artists)
      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      const [title, artist, , , , phrases] = parts;

      if (!title || !artist) continue;

      const reason = getPlaceholderReason({ title, artist, phrases });

      if (reason) {
        result.placeholdersFound++;
        result.violations.push({ title, artist, reason });
      }
    }

  } catch (error: any) {
    logger.warn({ error: error.message, filePath }, 'Could not read catalog file');
  }

  return result;
}

async function checkJsonlFile(filePath: string): Promise<CheckResult> {
  const result: CheckResult = {
    location: filePath,
    totalChecked: 0,
    placeholdersFound: 0,
    violations: []
  };

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    result.totalChecked = lines.length;

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const song = JSON.parse(line);

        const reason = getPlaceholderReason({
          title: song.title || '',
          artist: song.artist || '',
          phrases: Array.isArray(song.tags) ? song.tags.join(',') : '',
          source: song.source,
          mbid: song.mbid
        });

        if (reason) {
          result.placeholdersFound++;
          result.violations.push({
            title: song.title || '(unknown)',
            artist: song.artist || '(unknown)',
            reason
          });
        }
      } catch (parseError: any) {
        logger.warn({ error: parseError.message, line }, 'Failed to parse JSONL line');
      }
    }

  } catch (error: any) {
    logger.error({ error: error.message, filePath }, 'Could not read JSONL file');
  }

  return result;
}

async function main() {
  // Parse CLI args, filtering out pnpm's "--" delimiter
  const args = process.argv.slice(2).filter(arg => arg !== '--');

  // Support both --file=PATH and --file PATH
  let filePath: string | undefined;
  const fileArgIdx = args.findIndex(arg => arg === '--file' || arg.startsWith('--file='));
  if (fileArgIdx !== -1) {
    const fileArg = args[fileArgIdx];
    if (fileArg.startsWith('--file=')) {
      filePath = fileArg.split('=')[1];
    } else if (fileArgIdx + 1 < args.length) {
      filePath = args[fileArgIdx + 1];
    }
  }

  // Check if running in CI mode (--ci flag or CI env variable)
  const isCIMode = args.includes('--ci') || process.env.CI === 'true';

  logger.info('Starting catalog safety check...\n');

  const results: CheckResult[] = [];

  // If --file flag is provided, only check that file
  if (filePath) {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

    logger.info({ resolvedPath }, 'Checking JSONL file (database check skipped)...');

    const fileResult = await checkJsonlFile(resolvedPath);
    results.push(fileResult);
  } else if (isCIMode) {
    // CI mode: only check catalog files (no database)
    logger.info('CI mode: Skipping database check, checking catalog files only...');

    const catalogPath = path.join(process.cwd(), 'data', 'songs_seed.csv');
    logger.info({ catalogPath }, 'Checking catalog file...');
    const catalogResult = await checkCatalogFile(catalogPath);
    results.push(catalogResult);

    // Also check MusicBrainz JSONL if it exists
    const mbPath = path.join(process.cwd(), 'data', 'musicbrainz', 'musicbrainz_50k.jsonl');
    try {
      await fs.access(mbPath);
      logger.info({ mbPath }, 'Checking MusicBrainz JSONL...');
      const mbResult = await checkJsonlFile(mbPath);
      results.push(mbResult);
    } catch {
      logger.info('MusicBrainz JSONL not found, skipping...');
    }
  } else {
    // Normal mode: check database and catalog files
    // Check database
    logger.info('Checking database...');
    const dbResult = await checkDatabase();
    results.push(dbResult);

    // Check catalog files
    const catalogPath = path.join(process.cwd(), 'data', 'songs_seed.csv');
    logger.info({ catalogPath }, 'Checking catalog file...');
    const catalogResult = await checkCatalogFile(catalogPath);
    results.push(catalogResult);
  }

  // Report
  logger.info('\n' + '='.repeat(60));
  logger.info('CATALOG SAFETY CHECK RESULTS');
  logger.info('='.repeat(60));

  let totalPlaceholders = 0;
  for (const result of results) {
    logger.info(`\n${result.location}:`);
    logger.info(`  Total checked:    ${result.totalChecked}`);
    logger.info(`  Placeholders:     ${result.placeholdersFound}`);

    if (result.placeholdersFound > 0) {
      logger.warn('  ⚠️  VIOLATIONS FOUND:');

      // Group violations by reason
      const byReason = result.violations.reduce((acc, v) => {
        const key = v.reason.split(':')[0]; // Extract rule name before colon
        if (!acc[key]) acc[key] = [];
        acc[key].push(v);
        return acc;
      }, {} as Record<string, typeof result.violations>);

      logger.warn(`  Violations by rule:`);
      for (const [ruleName, violations] of Object.entries(byReason)) {
        logger.warn(`    ${ruleName}: ${violations.length}`);
      }

      logger.warn(`\n  Sample violations (first 10):`);
      for (const violation of result.violations.slice(0, 10)) {
        logger.warn(`    - "${violation.title}" by ${violation.artist} | ${violation.reason}`);
      }
      if (result.violations.length > 10) {
        logger.warn(`    ... and ${result.violations.length - 10} more`);
      }
    } else {
      logger.info('  ✅ PASS');
    }

    totalPlaceholders += result.placeholdersFound;
  }

  logger.info('\n' + '='.repeat(60));

  if (totalPlaceholders > 0) {
    logger.error(`\n❌ FAILED: Found ${totalPlaceholders} placeholder songs`);
    logger.error('These synthetic/fake songs must be removed before deployment.\n');
    process.exit(1);
  } else {
    logger.info('\n✅ PASSED: No placeholder songs detected');
    logger.info('Catalog is clean and ready for production.\n');

    // Show usage examples if checking database (not just a file)
    if (!filePath) {
      logger.info('Usage examples:');
      logger.info('  pnpm catalog:safety                              # Check database + CSV');
      logger.info('  pnpm catalog:safety -- --file ./songs.jsonl      # Check JSONL before import');
      logger.info('  pnpm catalog:safety -- --file=./songs.jsonl      # Alternative syntax');
      logger.info('');
    }

    process.exit(0);
  }
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Safety check failed');
  process.exit(1);
});
