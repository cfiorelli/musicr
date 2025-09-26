#!/usr/bin/env tsx

// Test the phrase lexicon directly
import { phraseLexicon } from '../src/services/phrase-lexicon-service.js';

async function testPhraseLexicon() {
  console.log('🧪 Testing Phrase Lexicon Direct Integration');
  console.log('===========================================');
  
  // Initialize the phrase lexicon
  await phraseLexicon.initialize();
  
  console.log('\n🔍 Testing phrase matches:');
  
  const testPhrases = [
    'hey jude',
    "can't stop", 
    'bohemian rhapsody',
    'love you',
    'california dreaming'
  ];
  
  for (const phrase of testPhrases) {
    console.log(`\n"${phrase}":`);
    const matches = phraseLexicon.findPhraseMatches(phrase);
    
    if (matches.length > 0) {
      matches.slice(0, 3).forEach(match => {
        console.log(`  ✅ "${match.phrase}" (${match.matchType}, confidence: ${match.confidence.toFixed(2)})`);
        console.log(`     Songs: ${match.songIds.length}`);
      });
    } else {
      console.log('  ❌ No matches found');
    }
  }
  
  console.log('\n🎉 Direct phrase lexicon test completed!');
}

testPhraseLexicon().catch(console.error);