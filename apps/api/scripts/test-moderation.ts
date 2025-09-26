#!/usr/bin/env tsx

import { moderationService } from '../src/services/moderation-service.js';
import { PrismaClient } from '@prisma/client';
import { SongMatchingService } from '../src/services/song-matching-service.js';

async function testModerationSystem() {
  console.log('🛡️ Testing Moderation & Safety System');
  console.log('====================================');
  
  const prisma = new PrismaClient();
  const songMatchingService = new SongMatchingService(prisma);
  
  try {
    const testCases = [
      // Clean content
      {
        input: 'hey jude',
        expected: 'should pass through cleanly',
        category: 'clean'
      },
      {
        input: 'love song',
        expected: 'should pass through cleanly', 
        category: 'clean'
      },
      
      // NSFW content (family-friendly room)
      {
        input: 'sexy time music',
        expected: 'should be replaced with neutral mapping',
        category: 'nsfw'
      },
      {
        input: 'fuck yeah this song rocks',
        expected: 'should be replaced with neutral mapping',
        category: 'nsfw'
      },
      
      // Harassment content
      {
        input: 'kill yourself loser',
        expected: 'should be replaced with neutral mapping',
        category: 'harassment'
      },
      {
        input: 'you are worthless and should die',
        expected: 'should be replaced with neutral mapping', 
        category: 'harassment'
      },
      
      // Slur content (should be blocked completely)
      {
        input: 'play some n***er music',
        expected: 'should be completely blocked',
        category: 'slur'
      },
      {
        input: 'f****t songs',
        expected: 'should be completely blocked',
        category: 'slur'
      },
      
      // Spam content
      {
        input: 'test test test test test test test',
        expected: 'should be flagged as spam but allowed',
        category: 'spam'
      }
    ];
    
    console.log('\n🔍 Testing Direct Moderation Service:');
    console.log('-'.repeat(50));
    
    for (const testCase of testCases) {
      console.log(`\nInput: "${testCase.input}"`);
      console.log(`Expected: ${testCase.expected}`);
      
      try {
        // Test with family-friendly settings (no NSFW)
        const result = await moderationService.moderateContent(testCase.input, {
          strictMode: false,
          allowNSFW: false,
          logViolations: false // Don't spam logs during testing
        });
        
        console.log(`✅ Result: ${result.allowed ? 'ALLOWED' : 'BLOCKED'}`);
        console.log(`   Category: ${result.category}`);
        console.log(`   Confidence: ${result.confidence}`);
        if (result.reason) {
          console.log(`   Reason: ${result.reason}`);
        }
        if (result.replacementText) {
          console.log(`   Replacement: "${result.replacementText}"`);
        }
        
      } catch (error) {
        console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    console.log('\n🎵 Testing Integrated Song Matching with Moderation:');
    console.log('-'.repeat(60));
    
    const integrationTests = [
      'hey jude',              // Clean - should work normally
      'sexy love song',        // NSFW - should get neutral mapping
      'kill yourself music',   // Harassment - should get neutral mapping  
      'n***er beats'          // Slur - should throw error
    ];
    
    for (const testInput of integrationTests) {
      console.log(`\nTesting: "${testInput}"`);
      
      try {
        const result = await songMatchingService.matchSongs(
          testInput, 
          false, // allowExplicit
          undefined, // userId
          false // roomAllowsExplicit (family-friendly)
        );
        
        console.log(`✅ Success: ${result.primary.title} — ${result.primary.artist}`);
        console.log(`   Strategy: ${result.scores.strategy}`);
        console.log(`   Confidence: ${result.scores.confidence}`);
        console.log(`   Reasoning: ${result.scores.reasoning}`);
        
      } catch (error) {
        if (error instanceof Error && error.message.includes('inappropriate language')) {
          console.log(`🚫 Blocked: ${error.message}`);
        } else {
          console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await prisma.$disconnect();
  }
  
  console.log('\n🎉 Moderation system testing completed!');
}

testModerationSystem().catch(console.error);