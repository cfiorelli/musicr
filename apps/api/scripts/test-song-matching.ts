#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { SongMatchingService } from '../src/services/song-matching-service.js';

async function testSongMatchingService() {
  console.log('🧪 Testing Song Matching Service');
  console.log('================================');
  
  const prisma = new PrismaClient();
  const songMatchingService = new SongMatchingService(prisma);
  
  try {
    const testPhrases = [
      'hey jude',
      "can't stop",
      'bohemian rhapsody',
      'love you',
      'random text that should not match'
    ];
    
    for (const phrase of testPhrases) {
      console.log(`\n🔍 Testing: "${phrase}"`);
      console.log('-'.repeat(40));
      
      try {
        const result = await songMatchingService.matchSongs(phrase, false);
        
        console.log(`✅ Primary: ${result.primary.title} — ${result.primary.artist}`);
        console.log(`   Strategy: ${result.why.matchedPhrase ? 'phrase' : 'other'}`);
        if (result.why.matchedPhrase) {
          console.log(`   Matched phrase: "${result.why.matchedPhrase}"`);
        }
        if (result.why.similarity) {
          console.log(`   Similarity: ${result.why.similarity}`);
        }
        
        console.log(`   Alternates: ${result.alternates.length}`);
        
      } catch (error) {
        console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
  
  console.log('\n🎉 Song matching service test completed!');
}

testSongMatchingService().catch(console.error);