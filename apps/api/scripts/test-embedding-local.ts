import 'dotenv/config';
import { pipeline } from '@huggingface/transformers';

/**
 * Test script to debug Hugging Face embeddings issue
 */

async function testEmbedding() {
  try {
    console.log('Loading model...');
    const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('✅ Model loaded successfully');

    const testText = "hello world test";
    console.log(`\nGenerating embedding for: "${testText}"`);

    const result = await embedder(testText, { pooling: 'mean', normalize: true });
    console.log('Result type:', typeof result);
    console.log('Result keys:', Object.keys(result));
    console.log('Result.data type:', typeof result.data);
    console.log('Result.data length:', result.data.length);

    const embedding = Array.from(result.data);
    console.log('Embedding length:', embedding.length);
    console.log('First 5 values:', embedding.slice(0, 5));
    console.log('Embedding norm:', Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0)));

    console.log('\n✅ Test successful!');
  } catch (error) {
    console.error('❌ Test failed:');
    console.error('Error type:', typeof error);
    console.error('Error constructor:', error?.constructor?.name);
    console.error('Error message:', (error as any)?.message);
    console.error('Error stack:', (error as any)?.stack);
    console.error('Full error:', error);
  }
}

testEmbedding();
