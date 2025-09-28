const fs2 = require('fs');
const path2 = require('path');

interface SongData {
  title: string;
  artist: string;
  year: number;
  genre?: string;
  album?: string;
  popularity?: number;
}

async function importSongs() {
  console.log('🎵 Starting song library import...');
  
  // Import dependencies dynamically to avoid module issues
  const { PrismaClient } = await import('@prisma/client');
  const { getEmbeddingService } = await import('../src/embeddings/service');
  const { config } = await import('../src/config');
  
  const prisma = new PrismaClient();
  const embeddingService = await getEmbeddingService(config.embedding);
  
  // Song datasets to import
  const songDatasets = [
    './data/billboard-2020s.json',
    './data/billboard-2010s.json',
    './data/billboard-2000s.json',
    './data/billboard-90s.json',
    './data/diverse-genres.json'
  ];
  
  let totalImported = 0;
  
  for (const datasetPath of songDatasets) {
    const fullPath = path2.join(__dirname, '..', datasetPath);
    if (!fs2.existsSync(fullPath)) {
      console.log(`⚠️  Dataset not found: ${datasetPath}`);
      continue;
    }
    
    console.log(`📁 Processing ${datasetPath}...`);
    const songs: SongData[] = JSON.parse(fs2.readFileSync(fullPath, 'utf-8'));
    
    for (const song of songs) {
      try {
        // Check if song already exists
        const existing = await prisma.song.findFirst({
          where: {
            title: song.title,
            artist: song.artist
          }
        });
        
        if (existing) {
          console.log(`⏭️  Skipping duplicate: ${song.title} - ${song.artist}`);
          continue;
        }
        
        // Generate embedding for song metadata
        const songText = `${song.title} by ${song.artist} ${song.genre || ''} ${song.year}`;
        const embedding = await embeddingService.embedSingle(songText);
        
        // Create tags from genre and year
        const tags = [
          song.genre?.toLowerCase(),
          `${Math.floor(song.year / 10) * 10}s`, // e.g., "2020s"
          song.artist.toLowerCase().split(' ')[0] // First word of artist
        ].filter(Boolean) as string[];
        
        // Import song
        await prisma.song.create({
          data: {
            title: song.title,
            artist: song.artist,
            year: song.year,
            popularity: song.popularity || 50,
            tags,
            phrases: [
              song.title.toLowerCase(),
              song.artist.toLowerCase(),
              `${song.title.toLowerCase()} ${song.artist.toLowerCase()}`,
              ...(song.genre ? [song.genre.toLowerCase()] : [])
            ],
            embedding
          }
        });
        
        totalImported++;
        
        if (totalImported % 10 === 0) {
          console.log(`✅ Imported ${totalImported} songs...`);
        }
        
        // Rate limit to avoid API limits (1 request every 200ms)
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`❌ Error importing ${song.title}: ${error}`);
      }
    }
  }
  
  console.log(`🎉 Import complete! Added ${totalImported} songs to the library.`);
  await prisma.$disconnect();
}

// Run the import
importSongs().catch(console.error);