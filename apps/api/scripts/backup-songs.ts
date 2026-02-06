import 'dotenv/config';
import { prisma } from '../src/services/database.js';
import { logger } from '../src/config/index.js';
import fs from 'fs/promises';

async function main() {
  await prisma.$connect();

  try {
    logger.info('Backing up songs table...');

    const songs = await prisma.song.findMany({
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        year: true,
        mbid: true,
        isrc: true,
        tags: true,
        phrases: true,
        popularity: true,
        source: true,
        sourceUrl: true,
        isPlaceholder: true,
        createdAt: true,
        updatedAt: true
      }
    });

    const backupData = {
      timestamp: new Date().toISOString(),
      count: songs.length,
      songs
    };

    await fs.writeFile(
      'data/musicbrainz/backup_songs_before_import.json',
      JSON.stringify(backupData, null, 2)
    );

    logger.info(`✅ Backed up ${songs.length} songs to backup_songs_before_import.json`);
    logger.info(`File size: ${(JSON.stringify(backupData).length / 1024 / 1024).toFixed(2)} MB`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Backup failed');
  process.exit(1);
});
