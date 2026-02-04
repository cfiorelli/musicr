/**
 * Catalog Cleanup Script
 *
 * Removes placeholder/synthetic songs from CSV catalog files.
 * Outputs clean catalog and quarantine file for review.
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { isPlaceholderSong, getPlaceholderReason } from './utils/placeholder-detector.js';

interface SongRow {
  title: string;
  artist: string;
  year: string;
  popularity: string;
  tags: string;
  phrases: string;
}

interface CleanupStats {
  totalRows: number;
  placeholdersRemoved: number;
  realSongsKept: number;
  byArtist: Record<string, { removed: number; kept: number }>;
}

async function cleanCatalog(inputPath: string, outputCleanPath: string, outputQuarantinePath: string) {
  console.log(`\n🧹 Cleaning catalog: ${path.basename(inputPath)}\n`);

  // Read input CSV
  const csvContent = fs.readFileSync(inputPath, 'utf-8');
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as SongRow[];

  const stats: CleanupStats = {
    totalRows: rows.length,
    placeholdersRemoved: 0,
    realSongsKept: 0,
    byArtist: {}
  };

  const cleanRows: SongRow[] = [];
  const quarantineRows: Array<SongRow & { reason: string }> = [];

  // Process each row
  for (const row of rows) {
    const artist = row.artist;

    // Initialize artist stats
    if (!stats.byArtist[artist]) {
      stats.byArtist[artist] = { removed: 0, kept: 0 };
    }

    // Check if placeholder
    if (isPlaceholderSong(row)) {
      stats.placeholdersRemoved++;
      stats.byArtist[artist].removed++;

      const reason = getPlaceholderReason(row) || 'Unknown';
      quarantineRows.push({ ...row, reason });
    } else {
      stats.realSongsKept++;
      stats.byArtist[artist].kept++;
      cleanRows.push(row);
    }
  }

  // Write clean catalog
  const cleanCsv = stringify(cleanRows, {
    header: true,
    columns: ['title', 'artist', 'year', 'popularity', 'tags', 'phrases']
  });
  fs.writeFileSync(outputCleanPath, cleanCsv, 'utf-8');

  // Write quarantine file (with reasons)
  if (quarantineRows.length > 0) {
    const quarantineCsv = stringify(quarantineRows, {
      header: true,
      columns: ['title', 'artist', 'year', 'popularity', 'tags', 'phrases', 'reason']
    });
    fs.writeFileSync(outputQuarantinePath, quarantineCsv, 'utf-8');
  }

  // Print summary
  console.log('📊 Cleanup Summary\n');
  console.log(`Total rows processed: ${stats.totalRows}`);
  console.log(`✅ Real songs kept: ${stats.realSongsKept}`);
  console.log(`❌ Placeholders removed: ${stats.placeholdersRemoved}`);
  console.log(`\nRemoval rate: ${((stats.placeholdersRemoved / stats.totalRows) * 100).toFixed(1)}%\n`);

  // Show top artists with removals
  const artistsWithRemovals = Object.entries(stats.byArtist)
    .filter(([_, s]) => s.removed > 0)
    .sort((a, b) => b[1].removed - a[1].removed)
    .slice(0, 10);

  if (artistsWithRemovals.length > 0) {
    console.log('🎤 Top 10 Artists with Placeholders Removed:\n');
    for (const [artist, s] of artistsWithRemovals) {
      console.log(`  ${artist}: ${s.removed} removed, ${s.kept} kept`);
    }
  }

  console.log(`\n📁 Output files:`);
  console.log(`  Clean: ${outputCleanPath}`);
  console.log(`  Quarantine: ${outputQuarantinePath}\n`);

  return stats;
}

async function main() {
  const archiveDir = path.join(process.cwd(), '..', '..', 'docs', 'archive');
  const quarantineDir = path.join(process.cwd(), '..', '..', 'docs', 'quarantine');

  // IMPORTANT: This script processes the CONTAMINATED archive file
  // Output goes to quarantine folder, NOT production data folder
  console.log('⚠️  Processing contaminated archive file (catalog_contaminated_DO_NOT_USE.csv)');
  console.log('⚠️  Output will go to docs/quarantine/ folder\n');

  await cleanCatalog(
    path.join(archiveDir, 'catalog_contaminated_DO_NOT_USE.csv'),
    path.join(quarantineDir, 'catalog_clean.csv'),
    path.join(quarantineDir, 'catalog_placeholders.csv')
  );

  console.log('✅ Catalog cleanup complete!');
  console.log('\n⚠️  REMINDER: These output files are in docs/quarantine/');
  console.log('⚠️  To update production catalog, manually copy catalog_clean.csv to data/songs_seed.csv');
  console.log('⚠️  Then run: pnpm catalog:validate\n');
}

main().catch(console.error);
