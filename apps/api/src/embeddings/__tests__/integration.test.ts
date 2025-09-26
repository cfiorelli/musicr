/**
 * Integration test demonstrating the embedding subsystem
 * This creates a real embedding service with fallback and tests basic functionality
 */

import { describe, it, expect } from 'vitest';
import { EmbeddingService, vectorUtils } from '../index.js';
import type { EmbeddingServiceConfig } from '../types.js';

describe('Embedding Integration', () => {
  // Skip these tests if no API key is available
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  
  const testConfig: EmbeddingServiceConfig = {
    primaryProvider: 'local',
    fallbackProvider: undefined, // Test local only
    local: {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
      batchSize: 4
    }
  };

  it('should create embeddings for song-related text', async () => {
    const service = new EmbeddingService(testConfig);
    await service.initialize();

    const musicTexts = [
      'I love rock music with electric guitars',
      'Classical piano sonatas are beautiful',
      'Jazz improvisation is amazing',
      'Pop music makes me dance'
    ];

    const embeddings = await service.embed(musicTexts);
    
    expect(embeddings).toHaveLength(4);
    expect(embeddings[0]).toHaveLength(384); // all-MiniLM-L6-v2 dimensions
    
    // Verify embeddings are normalized-ish (not zero vectors)
    for (const embedding of embeddings) {
      const magnitude = vectorUtils.magnitude(embedding);
      expect(magnitude).toBeGreaterThan(0);
    }
  }, 30000); // 30 second timeout for model download

  it('should find similar songs using cosine similarity', async () => {
    const service = new EmbeddingService(testConfig);
    await service.initialize();

    const rockQuery = 'heavy metal rock song';
    const candidates = [
      'thunderstruck by AC/DC',           // Should be most similar
      'classical mozart symphony',        // Should be less similar  
      'country music banjo',             // Should be less similar
      'hard rock guitar solo'            // Should be fairly similar
    ];

    const [queryEmbedding] = await service.embed([rockQuery]);
    const candidateEmbeddings = await service.embed(candidates);

    const similarities = candidateEmbeddings.map(embedding => 
      vectorUtils.cosineSimilarity(queryEmbedding, embedding)
    );

    // Rock-related queries should have higher similarity
    expect(similarities[0]).toBeGreaterThan(similarities[1]); // AC/DC > Mozart
    expect(similarities[3]).toBeGreaterThan(similarities[2]); // Guitar > Banjo
    
    // All similarities should be reasonable values
    similarities.forEach(sim => {
      expect(sim).toBeGreaterThan(-1);
      expect(sim).toBeLessThan(1);
    });
  }, 30000);

  it('should provide service status', async () => {
    const service = new EmbeddingService(testConfig);
    await service.initialize();
    
    const status = await service.getStatus();
    
    expect(status.primary.provider).toBe('local');
    expect(status.primary.model).toBe('Xenova/all-MiniLM-L6-v2');
    expect(status.fallback).toBeUndefined();
  });

  // Test with OpenAI if key is available
  if (hasOpenAIKey) {
    it('should work with OpenAI embeddings', async () => {
      const openaiConfig: EmbeddingServiceConfig = {
        primaryProvider: 'openai',
        openai: {
          apiKey: process.env.OPENAI_API_KEY!,
          model: 'text-embedding-3-small',
          dimensions: 1536
        }
      };

      const service = new EmbeddingService(openaiConfig);
      await service.initialize();

      const embedding = await service.embedSingle('test music query');
      expect(embedding).toHaveLength(1536);
      expect(service.getActiveModel()).toBe('text-embedding-3-small');
    }, 10000);
  }
});