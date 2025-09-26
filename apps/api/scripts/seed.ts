import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import { pipeline, env } from '@huggingface/transformers';

interface SeedSong {
  title: string;
  artist: string;
  year: number;
  popularity: number;
  tags: string[];
  phrases: string[];
}

// Initialize the embedding pipeline
let embedder: any = null;

async function initializeEmbedder() {
  try {
    logger.info('Initializing sentence transformer model...');
    // Use a lightweight, fast sentence transformer
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: false,
    });
    logger.info('✅ Embedding model loaded successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize embedding model');
    throw error;
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!embedder) {
    throw new Error('Embedder not initialized');
  }

  try {
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    // Convert tensor to array and flatten if needed
    const embedding = Array.from(result.data);
    return embedding as number[];
  } catch (error) {
    logger.error({ error, text }, 'Failed to generate embedding');
    throw error;
  }
}

function createSearchableText(song: SeedSong): string {
  // Create a comprehensive text representation for embedding
  const searchText = [
    `${song.title} by ${song.artist}`,
    `Song: ${song.title}`,
    `Artist: ${song.artist}`,
    `Year: ${song.year}`,
    song.tags.join(' '),
    song.phrases.join(' ')
  ].join(' ').toLowerCase();

  return searchText;
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
          logger.warn({ error, row }, 'Failed to parse song row');
        }
      })
      .on('end', () => {
        logger.info(`✅ Parsed ${songs.length} songs from CSV`);
        resolve(songs);
      })
      .on('error', (error) => {
        logger.error({ error }, 'Failed to read CSV file');
        reject(error);
      });
  });
}

async function seedDatabase(songs: SeedSong[]) {
  logger.info(`Starting to seed database with ${songs.length} songs...`);
  
  let processed = 0;
  let skipped = 0;

  for (const song of songs) {
    try {
      // Check if song already exists
      const existing = await prisma.song.findFirst({
        where: {
          AND: [
            { title: { equals: song.title, mode: 'insensitive' } },
            { artist: { equals: song.artist, mode: 'insensitive' } }
          ]
        }
      });

      if (existing) {
        skipped++;
        continue;
      }

      // Generate embedding
      const searchText = createSearchableText(song);
      const embedding = await generateEmbedding(searchText);

      // Insert song with embedding
      await prisma.$executeRaw`
        INSERT INTO songs (id, title, artist, year, popularity, tags, phrases, embedding, "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid(),
          ${title}::text,
          ${artist}::text,
          ${year}::integer,
          ${popularity}::integer,
          ${tags}::text[],
          ${phrases}::text[],
          ${embedding ? `$${JSON.stringify(embedding)}::jsonb` : 'NULL'},
          NOW(),
          NOW()
        )`;

      processed++;

      if (processed % 10 === 0) {
        logger.info(`Processed ${processed}/${songs.length} songs...`);
      }

    } catch (error) {
      logger.error({ error, song }, 'Failed to insert song');
      // Continue with next song instead of failing completely
    }
  }

  logger.info(`✅ Seeding complete! Processed: ${processed}, Skipped: ${skipped}`);
}

async function main() {
  try {
    logger.info('🌱 Starting database seeding process...');

    // Connect to database
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Initialize embedding model
    await initializeEmbedder();

    // Read CSV file
    const csvPath = path.join(process.cwd(), 'data', 'songs_seed.csv');
    const songs = await readCSVFile(csvPath);

    if (songs.length === 0) {
      logger.warn('No songs found in CSV file');
      return;
    }

    // Seed the database
    await seedDatabase(songs);

    // Verify seeded data
    const count = await prisma.song.count();
    logger.info(`✅ Database now contains ${count} songs total`);

  } catch (error) {
    logger.error({ error }, '❌ Seeding failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((error) => {
  logger.error({ error }, 'Unhandled error in seeding process');
  process.exit(1);
});