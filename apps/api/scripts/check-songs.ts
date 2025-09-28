import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSongs() {
  try {
    const totalSongs = await prisma.song.count();
    console.log(`Total songs in database: ${totalSongs}`);
    
    // Get a few sample songs to verify they have proper data
    const samples = await prisma.song.findMany({
      take: 5,
      select: {
        title: true,
        artist: true,
        year: true,
        popularity: true,
        tags: true,
        phrases: true
      }
    });
    
    console.log('\nSample songs:');
    samples.forEach((song: any, i: number) => {
      console.log(`${i + 1}. "${song.title}" by ${song.artist} (${song.year})`);
      console.log(`   Popularity: ${song.popularity}, Tags: ${song.tags?.length || 0}, Phrases: ${song.phrases?.length || 0}`);
    });
    
  } catch (error) {
    console.error('Error checking songs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSongs();