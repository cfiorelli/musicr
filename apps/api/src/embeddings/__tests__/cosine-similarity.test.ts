import { describe, it, expect } from 'vitest';
import { cosineSimilarity, VectorUtilities } from '../utils.js';

describe('Cosine Similarity - Vector Comparison Accuracy', () => {
  const utils = new VectorUtilities();

  describe('Basic Mathematical Properties', () => {
    it('should return 1.0 for identical vectors', () => {
      const vectorA = [0.5, 0.3, 0.8, 0.1];
      const vectorB = [0.5, 0.3, 0.8, 0.1];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(1.0, 10);
    });

    it('should return 0.0 for orthogonal vectors', () => {
      const vectorA = [1, 0, 0, 0];
      const vectorB = [0, 1, 0, 0];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(0.0, 10);
    });

    it('should return -1.0 for opposite vectors', () => {
      const vectorA = [1, 0, 0];
      const vectorB = [-1, 0, 0];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(-1.0, 10);
    });

    it('should be commutative (A·B = B·A)', () => {
      const vectorA = [0.2, 0.7, 0.3, 0.9];
      const vectorB = [0.8, 0.1, 0.6, 0.4];
      
      const similarityAB = cosineSimilarity(vectorA, vectorB);
      const similarityBA = cosineSimilarity(vectorB, vectorA);
      
      expect(similarityAB).toBeCloseTo(similarityBA, 10);
    });

    it('should handle zero vectors gracefully', () => {
      const zeroVector = [0, 0, 0, 0];
      const nonZeroVector = [1, 2, 3, 4];
      
      const similarity = cosineSimilarity(zeroVector, nonZeroVector);
      expect(similarity).toBe(0);
    });

    it('should handle vectors with both zero components', () => {
      const vectorA = [0, 0, 0, 0];
      const vectorB = [0, 0, 0, 0];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBe(0); // Convention for zero vectors
    });
  });

  describe('Numerical Precision and Edge Cases', () => {
    it('should maintain precision with small values', () => {
      const vectorA = [1e-10, 2e-10, 3e-10];
      const vectorB = [1e-10, 2e-10, 3e-10];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(1.0, 8);
    });

    it('should handle large values without overflow', () => {
      const vectorA = [1e6, 2e6, 3e6];
      const vectorB = [1e6, 2e6, 3e6];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(1.0, 10);
    });

    it('should normalize vectors correctly', () => {
      const vectorA = [3, 4]; // Magnitude = 5
      const vectorB = [6, 8]; // Magnitude = 10, same direction
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(1.0, 10); // Same direction
    });

    it('should handle mixed positive and negative values', () => {
      const vectorA = [1, -1, 1, -1];
      const vectorB = [-1, 1, -1, 1];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(-1.0, 10); // Exactly opposite
    });

    it('should calculate correct similarity for unit vectors', () => {
      // Two unit vectors at 60-degree angle
      const vectorA = [1, 0];
      const vectorB = [0.5, Math.sqrt(3) / 2];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(0.5, 10); // cos(60°) = 0.5
    });
  });

  describe('Dimension Validation', () => {
    it('should throw error for mismatched dimensions', () => {
      const vectorA = [1, 2, 3];
      const vectorB = [1, 2, 3, 4];
      
      expect(() => cosineSimilarity(vectorA, vectorB))
        .toThrow('Vectors must have the same dimensions');
    });

    it('should handle single-dimensional vectors', () => {
      const vectorA = [5];
      const vectorB = [5];
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(1.0, 10);
    });

    it('should handle high-dimensional vectors', () => {
      const dim = 1000;
      const vectorA = Array(dim).fill(0.1);
      const vectorB = Array(dim).fill(0.1);
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeCloseTo(1.0, 10);
    });
  });

  describe('Real-world Vector Scenarios', () => {
    it('should handle typical embedding vectors (384-dimensional)', () => {
      // Simulate sentence transformer embeddings
      const vectorA = Array(384).fill(0).map((_, i) => Math.sin(i * 0.1) * 0.5);
      const vectorB = Array(384).fill(0).map((_, i) => Math.sin(i * 0.1 + 0.1) * 0.5);
      
      const similarity = cosineSimilarity(vectorA, vectorB);
      expect(similarity).toBeGreaterThan(0.8); // Should be similar
      expect(similarity).toBeLessThan(1.0);
    });

    it('should differentiate similar vs dissimilar content', () => {
      // Simulate similar song embeddings
      const rockSong1 = [0.8, 0.2, 0.1, 0.9, 0.3];
      const rockSong2 = [0.7, 0.3, 0.2, 0.8, 0.4];
      const jazzSong = [0.1, 0.9, 0.8, 0.2, 0.7];
      
      const rockSimilarity = cosineSimilarity(rockSong1, rockSong2);
      const crossGenreSimilarity = cosineSimilarity(rockSong1, jazzSong);
      
      expect(rockSimilarity).toBeGreaterThan(crossGenreSimilarity);
    });

    it('should handle sparse vectors (many zeros)', () => {
      const sparseA = [1, 0, 0, 0, 1, 0, 0, 0];
      const sparseB = [1, 0, 0, 0, 0, 1, 0, 0];
      
      const similarity = cosineSimilarity(sparseA, sparseB);
      expect(similarity).toBeCloseTo(0.5, 10); // sqrt(2/4) = 0.5
    });
  });

  describe('Performance and Optimization', () => {
    it('should calculate similarity efficiently for large vectors', () => {
      const dim = 10000;
      const vectorA = Array(dim).fill(0).map(() => Math.random());
      const vectorB = Array(dim).fill(0).map(() => Math.random());
      
      const start = performance.now();
      cosineSimilarity(vectorA, vectorB);
      const duration = performance.now() - start;
      
      // Should complete within reasonable time (< 10ms for 10K dimensions)
      expect(duration).toBeLessThan(10);
    });

    it('should be consistent across multiple calculations', () => {
      const vectorA = [0.1, 0.2, 0.3, 0.4];
      const vectorB = [0.5, 0.6, 0.7, 0.8];
      
      const similarities = Array(100).fill(0).map(() => 
        cosineSimilarity(vectorA, vectorB)
      );
      
      // All results should be identical
      const first = similarities[0];
      similarities.forEach(sim => expect(sim).toBeCloseTo(first, 15));
    });
  });

  describe('Comparison with Alternative Implementations', () => {
    it('should match manual dot product calculation', () => {
      const vectorA = [1, 2, 3];
      const vectorB = [4, 5, 6];
      
      // Manual calculation
      const dotProduct = vectorA.reduce((sum, a, i) => sum + a * vectorB[i], 0);
      const magA = Math.sqrt(vectorA.reduce((sum, a) => sum + a * a, 0));
      const magB = Math.sqrt(vectorB.reduce((sum, b) => sum + b * b, 0));
      const manualSimilarity = dotProduct / (magA * magB);
      
      const calculatedSimilarity = cosineSimilarity(vectorA, vectorB);
      
      expect(calculatedSimilarity).toBeCloseTo(manualSimilarity, 12);
    });

    it('should match vector utility class implementation', () => {
      const vectorA = [0.3, 0.6, 0.2, 0.8];
      const vectorB = [0.7, 0.1, 0.9, 0.4];
      
      const functionalSimilarity = cosineSimilarity(vectorA, vectorB);
      const classSimilarity = utils.cosineSimilarity(vectorA, vectorB);
      
      expect(functionalSimilarity).toBeCloseTo(classSimilarity, 15);
    });
  });

  describe('Song Embedding Similarity Scenarios', () => {
    it('should detect similar songs with high similarity', () => {
      // Simulate embeddings for similar songs
      const songA = [0.8, 0.2, 0.7, 0.3, 0.9];  // Rock song
      const songB = [0.7, 0.3, 0.8, 0.2, 0.8];  // Similar rock song
      
      const similarity = cosineSimilarity(songA, songB);
      expect(similarity).toBeGreaterThan(0.8); // High similarity threshold
    });

    it('should detect different genres with lower similarity', () => {
      // Simulate embeddings for different genres
      const rockSong = [0.9, 0.1, 0.8, 0.2, 0.7];
      const classicalSong = [0.1, 0.9, 0.2, 0.8, 0.3];
      
      const similarity = cosineSimilarity(rockSong, classicalSong);
      expect(similarity).toBeLessThan(0.5); // Low similarity for different genres
    });

    it('should handle query-to-multiple-songs comparison', () => {
      const queryEmbedding = [0.5, 0.5, 0.5, 0.5];
      const songEmbeddings = [
        [0.6, 0.4, 0.5, 0.5], // More similar
        [0.2, 0.8, 0.7, 0.3], // Less similar
        [0.5, 0.5, 0.5, 0.5], // Identical
        [0.1, 0.1, 0.1, 0.9]  // Very different
      ];
      
      const similarities = songEmbeddings.map(embedding => 
        cosineSimilarity(queryEmbedding, embedding)
      );
      
      // Should be ordered by similarity
      expect(similarities[2]).toBeCloseTo(1.0, 10); // Identical
      expect(similarities[0]).toBeGreaterThan(similarities[1]); // More similar > less similar
      expect(similarities[1]).toBeGreaterThan(similarities[3]); // Less similar > very different
    });
  });
});