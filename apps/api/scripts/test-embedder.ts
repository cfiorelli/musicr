import { pipeline } from '@xenova/transformers';

async function testEmbedder() {
  console.log('Initializing embedder...');
  try {
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✅ Embedder initialized successfully');
    
    console.log('Generating test embedding...');
    const result = await embedder('test song by artist', { pooling: 'mean', normalize: true });
    const embedding = Array.from(result.data);
    console.log('✅ Generated embedding with', embedding.length, 'dimensions');
    console.log('Sample values:', embedding.slice(0, 5));
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
  }
}

testEmbedder();
