import { pipeline } from '@xenova/transformers';

async function testEmbeddings() {
  try {
    console.log('🧪 Testing embedding generation...');
    console.log('Initializing sentence transformer model...');

    // Use the same model as in seed.ts
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✅ Embedding model loaded successfully');

    // Test with a sample song
    const testText = "Come Together by The Beatles Song: Come Together Artist: The Beatles Year: 1967 rock classic 60s pop come together right now over me";

    console.log('Generating test embedding...');
    const result = await embedder(testText, { pooling: 'mean', normalize: true });
    const embedding = Array.from(result.data);

    console.log(`✅ Successfully generated embedding with ${embedding.length} dimensions`);
    console.log(`First 10 values: [${embedding.slice(0, 10).map((v: number) => v.toFixed(4)).join(', ')}]`);

    // Verify it's the expected dimensionality (384 for this model)
    if (embedding.length === 384) {
      console.log('✅ Correct embedding dimension (384)');
    } else {
      console.warn(`⚠️  Unexpected dimension: ${embedding.length} (expected 384)`);
    }

    console.log('🎉 Embedding test successful!');

  } catch (error) {
    console.error('❌ Embedding test failed:', error);
    process.exit(1);
  }
}

testEmbeddings();
