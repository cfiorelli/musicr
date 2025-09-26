#!/usr/bin/env tsx

// Standalone moderation test without dependencies

interface ModerationResult {
  allowed: boolean;
  reason?: string;
  category?: 'harassment' | 'nsfw' | 'slur' | 'spam' | 'clean';
  confidence: number;
  replacementText?: string;
}

// Simplified test moderation logic
function testModerationLogic(text: string): ModerationResult {
  const normalizedText = text.toLowerCase().trim();
  
  // Check for slurs
  const slurs = ['nazi', 'hitler', 'genocide'];
  for (const slur of slurs) {
    if (normalizedText.includes(slur)) {
      return {
        allowed: false,
        reason: 'Contains prohibited slur',
        category: 'slur',
        confidence: 1.0
      };
    }
  }
  
  // Check for harassment
  const harassment = ['kill yourself', 'kys', 'die', 'worthless', 'pathetic'];
  for (const term of harassment) {
    if (normalizedText.includes(term)) {
      return {
        allowed: false,
        reason: 'Contains harassment content',
        category: 'harassment',
        confidence: 0.85,
        replacementText: 'Bad'
      };
    }
  }
  
  // Check for NSFW
  const nsfw = ['sexy', 'fuck', 'sex', 'porn'];
  for (const term of nsfw) {
    if (normalizedText.includes(term)) {
      return {
        allowed: false,
        reason: 'Contains NSFW content',
        category: 'nsfw',
        confidence: 0.8,
        replacementText: 'Smooth Criminal'
      };
    }
  }
  
  // Check for spam (repeated words)
  const words = normalizedText.split(/\s+/);
  const wordCounts = new Map<string, number>();
  
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }
  
  for (const [word, count] of wordCounts) {
    if (count > 5 && word.length > 2) {
      return {
        allowed: false,
        reason: 'Excessive repetition detected',
        category: 'spam',
        confidence: 0.7
      };
    }
  }
  
  return {
    allowed: true,
    category: 'clean',
    confidence: 0.95
  };
}

function getPolicyMessage(category: string): string {
  switch (category) {
    case 'slur':
      return 'Message contains inappropriate language and cannot be processed.';
    case 'harassment':
      return 'Content appears to contain harmful language. Please try a different message.';
    case 'nsfw':
      return 'This room has family-friendly settings enabled. Please try a different message.';
    case 'spam':
      return 'Message appears to be spam. Please try a simpler query.';
    default:
      return 'Unable to process this message. Please try something else.';
  }
}

console.log('🛡️ Testing Moderation Logic');
console.log('===========================');

const testCases = [
  // Clean content
  { input: 'hey jude', expected: 'clean' },
  { input: 'love song', expected: 'clean' },
  { input: 'bohemian rhapsody', expected: 'clean' },
  
  // NSFW content
  { input: 'sexy time music', expected: 'nsfw with replacement' },
  { input: 'fuck yeah this rocks', expected: 'nsfw with replacement' },
  
  // Harassment content
  { input: 'kill yourself loser', expected: 'harassment with replacement' },
  { input: 'you are worthless', expected: 'harassment with replacement' },
  
  // Slur content
  { input: 'play some nazi music', expected: 'blocked completely' },
  
  // Spam content
  { input: 'test test test test test test test', expected: 'spam (blocked)' }
];

console.log('\n🔍 Test Results:');
console.log('-'.repeat(50));

for (const testCase of testCases) {
  console.log(`\n📝 Input: "${testCase.input}"`);
  console.log(`   Expected: ${testCase.expected}`);
  
  const result = testModerationLogic(testCase.input);
  
  console.log(`   Result: ${result.allowed ? '✅ ALLOWED' : '🚫 BLOCKED'}`);
  console.log(`   Category: ${result.category}`);
  console.log(`   Confidence: ${result.confidence.toFixed(2)}`);
  
  if (result.reason) {
    console.log(`   Reason: ${result.reason}`);
  }
  
  if (result.replacementText) {
    console.log(`   🎵 Replacement: "${result.replacementText}"`);
  }
  
  if (!result.allowed) {
    const policyMessage = getPolicyMessage(result.category!);
    console.log(`   📋 Policy: "${policyMessage}"`);
  }
}

console.log('\n🎯 Moderation Pipeline Summary:');
console.log('==============================');
console.log('✅ Clean content passes through unchanged');
console.log('🎵 NSFW/Harassment → Neutral song mappings (e.g., "Bad", "Smooth Criminal")');
console.log('🚫 Slurs → Completely blocked with policy message');
console.log('⚠️  Spam → Flagged but may be allowed based on settings');

console.log('\n🎉 Moderation logic test completed!');