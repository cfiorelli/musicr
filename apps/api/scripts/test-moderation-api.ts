#!/usr/bin/env tsx
import { ModerationService } from '../src/services/moderation-service.js';
import { SongMatchingService } from '../src/services/song-matching-service.js';

// Mock database/services for testing
const mockDb = {
  song: {
    findMany: () => Promise.resolve([
      {
        id: 'hey-jude-123',
        title: 'Hey Jude',
        artist: 'The Beatles',
        album: '1',
        year: 1968,
        spotifyId: 'hey-jude',
        embedding: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ])
  },
  room: {
    findFirst: () => Promise.resolve({
      id: 'main-room',
      name: 'main',
      allowExplicit: false, // Family-friendly room
      createdAt: new Date(),
    })
  }
};

const mockEmbeddingService = {
  generateEmbedding: () => Promise.resolve(new Array(384).fill(0.1)),
  findSimilarSongs: () => Promise.resolve([
    { song: mockDb.song.findMany()[0], similarity: 0.95 }
  ])
};

const mockPhraseService = {
  findSongsForPhrase: () => Promise.resolve([]),
  analyzePhrases: () => Promise.resolve({ phrases: [], coverage: 0 })
};

async function testModerationIntegration() {
  console.log('🧪 Testing Complete Moderation Integration');
  console.log('==========================================');

  const moderationService = new ModerationService();
  const songMatchingService = new SongMatchingService(
    mockDb as any,
    mockEmbeddingService as any,
    mockPhraseService as any,
    moderationService
  );

  const testCases = [
    {
      input: 'hey jude',
      expected: 'Should return normal song match with high confidence',
      expectBlocked: false
    },
    {
      input: 'sexy time music',
      expected: 'Should be replaced with neutral mapping like "Smooth Criminal"',
      expectBlocked: true,
      expectReplacement: true
    },
    {
      input: 'kill yourself loser',
      expected: 'Should be replaced with "Bad" by Michael Jackson',
      expectBlocked: true,
      expectReplacement: true
    },
    {
      input: 'play some nazi music',
      expected: 'Should be completely blocked with policy message',
      expectBlocked: true,
      expectReplacement: false
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Testing: "${testCase.input}"`);
    console.log(`Expected: ${testCase.expected}`);
    
    try {
      const result = await songMatchingService.findSongs(
        testCase.input, 
        'main', // room name
        [], // message history
        'test-user'
      );

      if (testCase.expectBlocked) {
        if (result.primary) {
          // Check if it's a neutral mapping
          const isNeutralMapping = ['Bad', 'Smooth Criminal', 'Beat It'].includes(result.primary.title);
          if (isNeutralMapping && testCase.expectReplacement) {
            console.log(`✅ CORRECT: Replaced with neutral mapping "${result.primary.title}"`);
          } else if (!testCase.expectReplacement) {
            console.log(`❌ UNEXPECTED: Should have been completely blocked but got: ${result.primary.title}`);
          } else {
            console.log(`❌ UNEXPECTED: Expected neutral mapping but got: ${result.primary.title}`);
          }
        } else {
          if (!testCase.expectReplacement) {
            console.log(`✅ CORRECT: Completely blocked as expected`);
          } else {
            console.log(`❌ UNEXPECTED: Should have been replaced but was blocked`);
          }
        }
      } else {
        if (result.primary) {
          console.log(`✅ CORRECT: Normal processing - found "${result.primary.title}"`);
          console.log(`   Confidence: ${result.scores?.confidence || 'unknown'}`);
          if (result.alternates && result.alternates.length > 0) {
            console.log(`   Alternates: ${result.alternates.map(a => a.title).join(', ')}`);
          }
        } else {
          console.log(`❌ UNEXPECTED: Clean input was blocked or failed`);
        }
      }
    } catch (error: any) {
      if (testCase.expectBlocked && !testCase.expectReplacement) {
        console.log(`✅ CORRECT: Properly threw error - ${error.message}`);
      } else {
        console.log(`❌ ERROR: Unexpected error - ${error.message}`);
      }
    }
  }

  console.log('\n🎯 Integration Test Summary:');
  console.log('============================');
  console.log('✅ Clean content should pass through normally');
  console.log('🎵 NSFW/Harassment should get neutral song mappings');
  console.log('🚫 Slurs should be completely blocked');
  console.log('⚠️  All content filtered before song matching pipeline');
}

// Run the test
testModerationIntegration()
  .then(() => {
    console.log('\n🎉 Integration test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });