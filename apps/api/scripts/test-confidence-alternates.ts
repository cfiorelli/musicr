#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { SongMatchingService } from '../src/services/song-matching-service.js';

async function testConfidenceAndAlternates() {
  console.log('🧪 Testing Enhanced Confidence & Alternates System');
  console.log('==================================================');
  
  const prisma = new PrismaClient();
  const songMatchingService = new SongMatchingService(prisma);
  
  try {
    const testCases = [
      {
        query: 'hey jude',
        expected: 'should have high confidence (exact match)',
      },
      {
        query: 'love song',
        expected: 'should have lower confidence (ambiguous), return alternates',
      },
      {
        query: 'bohemian rhapsody',
        expected: 'should have high confidence (exact match)',
      },
      {
        query: 'something about love',
        expected: 'should have medium confidence, diverse alternates',
      },
      {
        query: 'random gibberish xyz123',
        expected: 'should have low confidence, fallback alternates',
      }
    ];
    
    for (const testCase of testCases) {
      console.log(`\n🔍 Testing: "${testCase.query}"`);
      console.log(`Expected: ${testCase.expected}`);
      console.log('-'.repeat(60));
      
      try {
        const result = await songMatchingService.matchSongs(testCase.query, false);
        
        console.log(`✅ Primary: ${result.primary.title} — ${result.primary.artist} (${result.primary.year || 'N/A'})`);
        console.log(`   Strategy: ${result.scores.strategy}`);
        console.log(`   Confidence: ${result.scores.confidence}`);
        console.log(`   Reasoning: ${result.scores.reasoning}`);
        console.log(`   Why: ${result.why}`);
        
        console.log(`   Alternates: ${result.alternates.length}`);
        result.alternates.forEach((alt, i) => {
          console.log(`     ${i + 1}. ${alt.title} — ${alt.artist} (${alt.year || 'N/A'}) [score: ${alt.score}]`);
        });
        
        // Analyze diversity
        if (result.alternates.length > 0) {
          const artists = [result.primary.artist, ...result.alternates.map(a => a.artist)];
          const decades = [result.primary.year, ...result.alternates.map(a => a.year)]
            .filter(year => year)
            .map(year => Math.floor(year! / 10) * 10);
          
          const uniqueArtists = new Set(artists).size;
          const uniqueDecades = new Set(decades).size;
          
          console.log(`   Diversity: ${uniqueArtists}/${artists.length} unique artists, ${uniqueDecades}/${decades.length} unique decades`);
        }
        
      } catch (error) {
        console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await prisma.$disconnect();
  }
  
  console.log('\n🎉 Confidence and alternates testing completed!');
}

testConfidenceAndAlternates().catch(console.error);