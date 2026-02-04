/**
 * Catalog Validation Script
 *
 * Validates that the canonical catalog (songs_seed.csv) contains no placeholder songs.
 * Fails with non-zero exit code if placeholders detected.
 *
 * Run before seeding/importing to ensure data quality.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { isPlaceholderSong, getPlaceholderReason } from './utils/placeholder-detector.js';

interface SongRow {
  title: string;
  artist: string;
  year: string;
  popularity: string;
  tags: string;
  phrases: string;
}

const CANONICAL_CATALOG = path.join(process.cwd(), 'data', 'songs_seed.csv');

async function validateCatalog() {
  console.log(`\n🔍 Validating canonical catalog: ${path.basename(CANONICAL_CATALOG)}\n`);

  // Check file exists
  if (!fs.existsSync(CANONICAL_CATALOG)) {
    console.error(`❌ ERROR: Canonical catalog not found at ${CANONICAL_CATALOG}`);
    process.exit(1);
  }

  // Read CSV
  const csvContent = fs.readFileSync(CANONICAL_CATALOG, 'utf-8');
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as SongRow[];

  console.log(`📊 Total rows: ${rows.length}`);

  // Check for placeholders
  const placeholders: Array<SongRow & { reason: string }> = [];

  for (const row of rows) {
    if (isPlaceholderSong(row)) {
      const reason = getPlaceholderReason(row) || 'Unknown';
      placeholders.push({ ...row, reason });
    }
  }

  // Report results
  if (placeholders.length === 0) {
    console.log(`✅ PASS: No placeholder songs detected`);
    console.log(`✅ Catalog is clean and ready for import\n`);
    process.exit(0);
  } else {
    console.error(`\n❌ FAIL: Found ${placeholders.length} placeholder songs in canonical catalog!\n`);

    console.error(`First 10 offending titles:\n`);
    for (const p of placeholders.slice(0, 10)) {
      console.error(`  - "${p.title}" by ${p.artist}`);
      console.error(`    Reason: ${p.reason}\n`);
    }

    if (placeholders.length > 10) {
      console.error(`  ... and ${placeholders.length - 10} more\n`);
    }

    console.error(`❌ Catalog validation FAILED`);
    console.error(`❌ DO NOT import this catalog into production`);
    console.error(`\nTo fix:`);
    console.error(`  1. Run: pnpm tsx scripts/clean-catalog.ts`);
    console.error(`  2. Replace songs_seed.csv with catalog_clean.csv output`);
    console.error(`  3. Run this validation script again\n`);

    process.exit(1);
  }
}

validateCatalog().catch((error) => {
  console.error('❌ Validation script error:', error);
  process.exit(1);
});
