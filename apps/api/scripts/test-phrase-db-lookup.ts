#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { phraseLexicon } from '../src/services/phrase-lexicon-service.js';

async function testPhraseDatabaseLookup() {
  console.log('🧪 Testing Phrase → Database Lookup');
  console.log('===================================');
  
  const prisma = new PrismaClient();
  
  try {
    // Initialize the phrase lexicon
    await phraseLexicon.initialize();
    
    // Test phrase matching and database lookup
    const phrase = 'hey jude';
    console.log(`\n🔍 Testing: "${phrase}"`);
    
    const phraseMatches = phraseLexicon.findPhraseMatches(phrase);
    console.log(`Found ${phraseMatches.length} phrase matches:`);
    
    for (const phraseMatch of phraseMatches.slice(0, 3)) {
      console.log(`  - Phrase: "${phraseMatch.phrase}"`);
      console.log(`  - Song IDs: ${phraseMatch.songIds.join(', ')}`);
      console.log(`  - Confidence: ${phraseMatch.confidence}`);
      console.log(`  - Match type: ${phraseMatch.matchType}`);
      
      // Look up songs in database
      try {
        const songs = await prisma.song.findMany({
          where: {
            id: { in: phraseMatch.songIds }
          }
        });
        
        console.log(`  - Database lookup found ${songs.length} songs:`);
        songs.forEach(song => {
          console.log(`    * ${song.title} — ${song.artist} (${song.id})`);
        });
      } catch (dbError) {
        console.log(`  - Database lookup failed: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
      }
    }
    
    if (phraseMatches.length === 0) {
      console.log('❌ No phrase matches found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
  
  console.log('\n🎉 Phrase database lookup test completed!');
}

testPhraseDatabaseLookup().catch(console.error);