import { VectorUtils, SimilarityResult, SimilarityMetric } from './types.js';

/**
 * Vector similarity and utility functions for embeddings
 */
export class VectorUtilities implements VectorUtils {
  
  /**
   * Calculate cosine similarity between two vectors
   * Returns a value between -1 and 1, where 1 means identical direction
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    const dotProd = this.dotProduct(a, b);
    const magnitudeA = this.magnitude(a);
    const magnitudeB = this.magnitude(b);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProd / (magnitudeA * magnitudeB);
  }

  /**
   * Calculate Euclidean distance between two vectors
   * Returns a non-negative value, where 0 means identical vectors
   */
  euclideanDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  /**
   * Calculate dot product of two vectors
   */
  dotProduct(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }

    return sum;
  }

  /**
   * Normalize a vector to unit length
   */
  normalize(vector: number[]): number[] {
    const mag = this.magnitude(vector);
    if (mag === 0) {
      return vector.slice(); // Return copy of zero vector
    }

    return vector.map(component => component / mag);
  }

  /**
   * Calculate the magnitude (length) of a vector
   */
  magnitude(vector: number[]): number {
    let sum = 0;
    for (const component of vector) {
      sum += component * component;
    }
    return Math.sqrt(sum);
  }

  /**
   * Calculate similarity with configurable metric
   */
  calculateSimilarity(
    a: number[], 
    b: number[], 
    metric: SimilarityMetric = 'cosine'
  ): SimilarityResult {
    switch (metric) {
      case 'cosine':
        const cosine = this.cosineSimilarity(a, b);
        return {
          similarity: cosine,
          distance: 1 - cosine // Convert to distance (0 = identical, 2 = opposite)
        };

      case 'euclidean':
        const euclidean = this.euclideanDistance(a, b);
        return {
          similarity: 1 / (1 + euclidean), // Convert distance to similarity (0-1)
          distance: euclidean
        };

      case 'dot':
        const dot = this.dotProduct(a, b);
        return {
          similarity: dot,
          distance: -dot // Negative dot product as distance
        };

      default:
        throw new Error(`Unknown similarity metric: ${metric}`);
    }
  }

  /**
   * Find the most similar vectors to a query vector
   */
  findMostSimilar(
    queryVector: number[],
    candidateVectors: number[][],
    metric: SimilarityMetric = 'cosine',
    topK: number = 10
  ): Array<{ index: number; similarity: number; distance: number }> {
    const results = candidateVectors.map((vector, index) => {
      const result = this.calculateSimilarity(queryVector, vector, metric);
      return {
        index,
        similarity: result.similarity,
        distance: result.distance
      };
    });

    // Sort by similarity (descending) for cosine and dot product
    // Sort by distance (ascending) for euclidean
    if (metric === 'euclidean') {
      results.sort((a, b) => a.distance - b.distance);
    } else {
      results.sort((a, b) => b.similarity - a.similarity);
    }

    return results.slice(0, topK);
  }

  /**
   * Batch similarity calculation for multiple queries
   */
  batchSimilarity(
    queryVectors: number[][],
    candidateVectors: number[][],
    metric: SimilarityMetric = 'cosine'
  ): SimilarityResult[][] {
    return queryVectors.map(queryVector =>
      candidateVectors.map(candidateVector =>
        this.calculateSimilarity(queryVector, candidateVector, metric)
      )
    );
  }
}

// Export singleton instance
export const vectorUtils = new VectorUtilities();

// Export individual functions for convenience
export const {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  normalize,
  magnitude
} = vectorUtils;