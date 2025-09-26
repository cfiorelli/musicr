#!/usr/bin/env tsx

/**
 * Test script for phrase lexicon functionality
 */

import { phraseLexicon } from '../src/services/phrase-lexicon-service.js';

async function testPhraseLexicon() {
  console.log('🧪 Testing Phrase Lexicon Service');
  console.log('=' .repeat(40));
  
  try {
    // Initialize the service
    await phraseLexicon.initialize();
    console.log('✅ Phrase lexicon initialized');
    
    // Get stats
    const stats = phraseLexicon.getStats();
    console.log('\n📊 Lexicon Statistics:');
    console.log(`  Total phrases: ${stats.totalPhrases}`);
    console.log(`  Total song mappings: ${stats.totalSongMappings}`);
    console.log(`  Average songs per phrase: ${stats.averageSongsPerPhrase.toFixed(2)}`);
    console.log(`  Indexed words: ${stats.indexedWords}`);
    
    // Test some specific phrases
    const testPhrases = [
      "can't stop",
      "love you",
      "bohemian rhapsody", 
      "stairway to heaven",
      "hey jude",
      "california dreaming", // This might not be exact
      "I need somebody to love", // Partial match test
    ];
    
    console.log('\n🔍 Testing Phrase Matches:');
    console.log('-'.repeat(60));
    
    for (const text of testPhrases) {
      try {
        const matches = phraseLexicon.findPhraseMatches(text);
        console.log(`\n"${text}"`);
        if (matches.length > 0) {
          for (const match of matches.slice(0, 3)) {
            console.log(`  ✅ ${match.phrase} (${match.matchType}, confidence: ${match.confidence.toFixed(2)})`);
            console.log(`     Songs: ${match.songIds.length}`);
          }
        } else {
          console.log(`  ❌ No matches found`);
        }
      } catch (error) {
        console.log(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // Test word-based lookup
    console.log('\n🔤 Testing Word-based Lookup:');
    console.log('-'.repeat(40));
    
    const testWords = ['california', 'love', 'jude', 'bohemian'];
    for (const word of testWords) {
      const phrases = phraseLexicon.getPhrasesForWord(word);
      console.log(`"${word}": ${phrases.length} phrases`);
      if (phrases.length > 0) {
        console.log(`  First few: ${phrases.slice(0, 3).join(', ')}`);
      }
    }
    
    console.log('\n🎉 Phrase lexicon test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error testing phrase lexicon:', error);
    process.exit(1);
  }
}

testPhraseLexicon();