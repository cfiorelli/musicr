#!/usr/bin/env tsx

interface MapResponse {
  primary: {
    id: string;
    title: string;
    artist: string;
    year?: number;
  };
  alternates: Array<{
    id: string;
    title: string;
    artist: string;
    year?: number;
  }>;
  scores: {
    confidence: number;
    strategy: string;
    reasoning: string;
  };
  why: string;
}

async function testAPI() {
  console.log('🧪 Testing API Endpoints');
  console.log('========================');
  
  const baseUrl = 'http://localhost:4000';
  
  // Test phrases that should match our lexicon
  const testPhrases = [
    'hey jude',
    "can't stop",
    'bohemian rhapsody',
    'california dreaming',
    'stairway to heaven',
    'love you',
    'I need somebody to love', // Should do partial matches
    'random text that probably wont match anything' // Should fall back to embeddings
  ];
  
  for (const phrase of testPhrases) {
    console.log(`\n🔍 Testing: "${phrase}"`);
    console.log('-'.repeat(50));
    
    try {
      const response = await fetch(`${baseUrl}/api/map`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: phrase }),
      });
      
      if (!response.ok) {
        console.log(`❌ HTTP ${response.status}: ${response.statusText}`);
        continue;
      }
      
      const data = await response.json() as MapResponse;
      
      console.log(`✅ Primary match: ${data.primary.title} — ${data.primary.artist}`);
      console.log(`   Strategy: ${data.scores.strategy}`);
      console.log(`   Confidence: ${data.scores.confidence}`);
      console.log(`   Reasoning: ${data.scores.reasoning}`);
      
      if (data.alternates.length > 0) {
        console.log(`   Alternates: ${data.alternates.length} songs`);
        data.alternates.slice(0, 2).forEach((alt, i) => {
          console.log(`     ${i + 1}. ${alt.title} — ${alt.artist}`);
        });
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  console.log('\n🎉 API testing completed!');
}

testAPI().catch(console.error);