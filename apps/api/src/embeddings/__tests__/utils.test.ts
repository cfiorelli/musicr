import { describe, it, expect } from 'vitest';
import { vectorUtils, VectorUtilities } from '../utils.js';

describe('VectorUtilities', () => {
  const utils = new VectorUtilities();

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vector = [1, 2, 3];
      const result = utils.cosineSimilarity(vector, vector);
      expect(result).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      const result = utils.cosineSimilarity(a, b);
      expect(result).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      const result = utils.cosineSimilarity(a, b);
      expect(result).toBeCloseTo(-1, 5);
    });

    it('should handle unit vectors correctly', () => {
      const a = [0.6, 0.8];
      const b = [0.8, 0.6];
      const result = utils.cosineSimilarity(a, b);
      const expected = (0.6 * 0.8 + 0.8 * 0.6) / (1 * 1); // Both are unit vectors
      expect(result).toBeCloseTo(expected, 5);
    });

    it('should throw error for vectors of different dimensions', () => {
      expect(() => {
        utils.cosineSimilarity([1, 2], [1, 2, 3]);
      }).toThrow('Vectors must have the same dimensions');
    });
  });

  describe('euclideanDistance', () => {
    it('should return 0 for identical vectors', () => {
      const vector = [1, 2, 3];
      const result = utils.euclideanDistance(vector, vector);
      expect(result).toBeCloseTo(0, 5);
    });

    it('should calculate distance correctly', () => {
      const a = [0, 0];
      const b = [3, 4];
      const result = utils.euclideanDistance(a, b);
      expect(result).toBeCloseTo(5, 5); // 3-4-5 triangle
    });
  });

  describe('dotProduct', () => {
    it('should calculate dot product correctly', () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      const result = utils.dotProduct(a, b);
      const expected = 1*4 + 2*5 + 3*6; // 4 + 10 + 18 = 32
      expect(result).toBe(expected);
    });
  });

  describe('magnitude', () => {
    it('should calculate magnitude correctly', () => {
      const vector = [3, 4];
      const result = utils.magnitude(vector);
      expect(result).toBeCloseTo(5, 5); // sqrt(9 + 16) = 5
    });

    it('should return 0 for zero vector', () => {
      const vector = [0, 0, 0];
      const result = utils.magnitude(vector);
      expect(result).toBe(0);
    });
  });

  describe('normalize', () => {
    it('should create unit vector', () => {
      const vector = [3, 4];
      const normalized = utils.normalize(vector);
      const magnitude = utils.magnitude(normalized);
      expect(magnitude).toBeCloseTo(1, 5);
    });

    it('should handle zero vector', () => {
      const vector = [0, 0, 0];
      const normalized = utils.normalize(vector);
      expect(normalized).toEqual([0, 0, 0]);
    });
  });

  describe('findMostSimilar', () => {
    it('should find most similar vectors', () => {
      const query = [1, 0, 0];
      const candidates = [
        [1, 0, 0],     // Identical - similarity 1
        [0, 1, 0],     // Orthogonal - similarity 0
        [-1, 0, 0],    // Opposite - similarity -1
        [0.5, 0.5, 0]  // 45 degrees - similarity ~0.707
      ];

      const results = utils.findMostSimilar(query, candidates, 'cosine', 3);
      
      expect(results).toHaveLength(3);
      expect(results[0].index).toBe(0); // Most similar
      expect(results[0].similarity).toBeCloseTo(1, 5);
      expect(results[1].index).toBe(3); // Second most similar
      expect(results[2].index).toBe(1); // Third most similar
    });
  });

  describe('singleton instance', () => {
    it('should provide working singleton', () => {
      const result = vectorUtils.cosineSimilarity([1, 0], [1, 0]);
      expect(result).toBeCloseTo(1, 5);
    });
  });
});