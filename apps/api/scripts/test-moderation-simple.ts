#!/usr/bin/env tsx

import { ModerationService } from '../src/services/moderation-service.js';

async function testModerationOnly() {
  console.log('🛡️ Testing Moderation Service Only');
  console.log('==================================');
  
  const moderationService = new ModerationService();
  
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
      input: 'play some nazi music',
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
  
  console.log('\n🔍 Testing Moderation Results:');
  console.log('-'.repeat(50));
  
  for (const testCase of testCases) {
    console.log(`\n📝 Input: "${testCase.input}"`);
    console.log(`   Expected: ${testCase.expected}`);
    
    try {
      // Test with family-friendly settings (no NSFW)
      const result = await moderationService.moderateContent(testCase.input, {
        strictMode: false,
        allowNSFW: false,
        logViolations: false // Don't spam logs during testing
      });
      
      console.log(`   Result: ${result.allowed ? '✅ ALLOWED' : '🚫 BLOCKED'}`);
      console.log(`   Category: ${result.category}`);
      console.log(`   Confidence: ${result.confidence.toFixed(2)}`);
      if (result.reason) {
        console.log(`   Reason: ${result.reason}`);
      }
      if (result.replacementText) {
        console.log(`   🎵 Replacement: "${result.replacementText}"`);
      }
      
      // Test policy messages
      if (!result.allowed) {
        const policyMessage = moderationService.getPolicyDeclineMessage(result.category!);
        console.log(`   📋 Policy Message: "${policyMessage}"`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  console.log('\n🔒 Testing with NSFW Allowed:');
  console.log('-'.repeat(40));
  
  const nsfwTest = 'sexy music for tonight';
  console.log(`\n📝 Input: "${nsfwTest}"`);
  
  // Test with NSFW allowed
  const nsfwAllowedResult = await moderationService.moderateContent(nsfwTest, {
    strictMode: false,
    allowNSFW: true,
    logViolations: false
  });
  
  console.log(`   NSFW Allowed: ${nsfwAllowedResult.allowed ? '✅ ALLOWED' : '🚫 BLOCKED'}`);
  console.log(`   Category: ${nsfwAllowedResult.category}`);
  
  // Test with NSFW blocked
  const nsfwBlockedResult = await moderationService.moderateContent(nsfwTest, {
    strictMode: false,
    allowNSFW: false,
    logViolations: false
  });
  
  console.log(`   NSFW Blocked: ${nsfwBlockedResult.allowed ? '✅ ALLOWED' : '🚫 BLOCKED'}`);
  console.log(`   Category: ${nsfwBlockedResult.category}`);
  if (nsfwBlockedResult.replacementText) {
    console.log(`   🎵 Replacement: "${nsfwBlockedResult.replacementText}"`);
  }
  
  console.log('\n🎉 Moderation service testing completed!');
}

testModerationOnly().catch(console.error);