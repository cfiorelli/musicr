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

async function main() {
  logger.info('Starting catalog safety check...\n');

  const results: CheckResult[] = [];

  // Check database
  logger.info('Checking database...');
  const dbResult = await checkDatabase();
  results.push(dbResult);

  // Check catalog files
  const catalogPath = path.join(process.cwd(), '..', '..', 'data', 'songs_seed.csv');
  logger.info({ catalogPath }, 'Checking catalog file...');
  const catalogResult = await checkCatalogFile(catalogPath);
  results.push(catalogResult);

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
    process.exit(0);
  }
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Safety check failed');
  process.exit(1);
});
