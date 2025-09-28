import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

const prisma = new PrismaClient();

interface SeedSong {
  title: string;
  artist: string;
  year: number;
  popularity: number;
  tags: string[];
  phrases: string[];
}

function parseTags(tagsStr: string): string[] {
  return tagsStr.split(',').map(tag => tag.trim()).filter(Boolean);
}

function parsePhrases(phrasesStr: string): string[] {
  return phrasesStr.split(',').map(phrase => phrase.trim()).filter(Boolean);
}

function normalizeSongData(row: any): SeedSong {
  return {
    title: row.title?.trim() || '',
    artist: row.artist?.trim() || '',
    year: parseInt(row.year) || 2000,
    popularity: parseInt(row.popularity) || 50,
    tags: parseTags(row.tags || ''),
    phrases: parsePhrases(row.phrases || '')
  };
}

async function readCSVFile(filePath: string): Promise<SeedSong[]> {
  const songs: SeedSong[] = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        try {
          const song = normalizeSongData(row);
          if (song.title && song.artist) {
            songs.push(song);
          }
        } catch (error) {
          console.warn('Failed to parse song row:', error);
        }
      })
      .on('end', () => {
        console.log(`✅ Parsed ${songs.length} songs from CSV`);
        resolve(songs);
      })
      .on('error', (error) => {
        console.error('Failed to read CSV file:', error);
        reject(error);
      });
  });
}

async function clearExistingSongs() {
  try {
    const result = await prisma.song.deleteMany({});
    console.log(`🗑️  Cleared ${result.count} existing songs`);
  } catch (error) {
    console.log('No existing songs to clear or error:', (error as Error).message);
  }
}

async function seedDatabase(songs: SeedSong[]) {
  console.log(`Starting to seed database with ${songs.length} songs (without embeddings)...`);
  
  let processed = 0;
  let errors = 0;

  for (const song of songs) {
    try {
      // Insert song without embedding (set to null)
      await prisma.song.create({
        data: {
          title: song.title,
          artist: song.artist,
          year: song.year,
          popularity: song.popularity,
          tags: song.tags,
          phrases: song.phrases
          // Skip embeddings for now
        }
      });

      processed++;

      if (processed % 25 === 0) {
        console.log(`✅ Processed ${processed}/${songs.length} songs...`);
      }

    } catch (error) {
      errors++;
      console.error(`❌ Failed to insert "${song.title}" by ${song.artist}:`, (error as Error).message);
      
      // Stop if too many errors
      if (errors > 10) {
        console.error('Too many errors, stopping...');
        break;
      }
    }
  }

  console.log(`🎉 Seeding complete! Processed: ${processed}, Errors: ${errors}`);
}

async function main() {
  try {
    console.log('🌱 Starting simple database seeding (no embeddings)...');

    // Read CSV file
    const csvPath = path.join(process.cwd(), 'data', 'songs_seed.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`❌ CSV file not found: ${csvPath}`);
      return;
    }

    const songs = await readCSVFile(csvPath);
    if (songs.length === 0) {
      console.warn('No songs found in CSV file');
      return;
    }

    // Clear existing songs first
    await clearExistingSongs();

    // Seed the database
    await seedDatabase(songs);

    // Verify seeded data
    const count = await prisma.song.count();
    console.log(`✅ Database now contains ${count} songs total`);

    // Show sample songs
    const samples = await prisma.$queryRaw`
      SELECT title, artist, year, array_length(tags, 1) as tag_count, array_length(phrases, 1) as phrase_count 
      FROM songs 
      LIMIT 5
    `;
    console.log('\n📝 Sample songs:');
    console.log(samples);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});