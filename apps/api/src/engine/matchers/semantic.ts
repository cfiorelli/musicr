/**
 * Semantic KNN Searcher
 * 
 * Performs embedding-based K-nearest neighbor search using cosine similarity
 * against Song.embedding vectors.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/index.js';
import { getEmbeddingService } from '../../embeddings/index.js';

export interface SemanticMatch {
  songId: string;
  title: string;
  artist: string;
  similarity: number;
  distance: number;
  tags: string[];
  year?: number;
  decade?: number;
  popularity: number;
}

export interface SemanticConfig {
  knn_size: number;
  embedding_model?: string;
  similarity_threshold?: number; // Minimum similarity to include
  use_reranking?: boolean;       // Re-rank by multiple factors
}

type RawSimilarityResult = {
  id: string;
  title: string;
  artist: string;
  tags: string[];
  year: number | null;
  popularity: number;
  similarity: number;
};

export class SemanticSearcher {
  private prisma: PrismaClient;
  private config: SemanticConfig;

  constructor(prisma: PrismaClient, config: SemanticConfig) {
    this.prisma = prisma;
    this.config = {
      similarity_threshold: 0.5,
      use_reranking: true,
      ...config
    };
  }

  /**
   * Find semantically similar songs using embedding search
   */
  async findSimilar(message: string, k: number = 50): Promise<SemanticMatch[]> {
    const startTime = Date.now();

    try {
      // Generate embedding for the input message
      logger.debug({ message: message.substring(0, 100) }, 'Generating message embedding');
      const embeddingService = await getEmbeddingService();
      const messageEmbedding = await embeddingService.embedSingle(message);

      // Debug logging if DEBUG_MATCHING is enabled
      if (process.env.DEBUG_MATCHING === '1') {
        const norm = Math.sqrt(messageEmbedding.reduce((sum, val) => sum + val * val, 0));
        const sumAbs = messageEmbedding.reduce((sum, val) => sum + Math.abs(val), 0);
        const isZero = messageEmbedding.every(val => val === 0);

        logger.info({
          receivedMessage: {
            length: message.length,
            preview: message.substring(0, 80)
          },
          embeddingInput: {
            length: message.length,
            preview: message.substring(0, 80)
          },
          embedding: {
            dimensions: messageEmbedding.length,
            first5: messageEmbedding.slice(0, 5),
            l2Norm: norm.toFixed(6),
            sumAbs: sumAbs.toFixed(6),
            isAllZeros: isZero
          },
          queryPath: 'native_vector'
        }, '[DEBUG_MATCHING] Embedding generated');
      }

      // Use raw SQL to query songs with embeddings and calculate cosine similarity
      logger.debug('Performing vector similarity search');

      const embeddingString = `[${messageEmbedding.join(',')}]`;
      const limit = k * 2;

      // Set HNSW ef_search parameter for sufficient candidate examination
      await this.prisma.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${Math.max(limit, 100)}`);

      // Use native vector column for fast HNSW index search
      // Falls back to JSONB if embedding_vector is NULL
      const results = await this.prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        artist: string;
        tags: string[];
        year: number | null;
        popularity: number;
        similarity: number;
      }>>(`
        SELECT
          id,
          title,
          artist,
          tags,
          year,
          popularity,
          CASE
            WHEN embedding_vector IS NOT NULL THEN
              (embedding_vector <=> '${embeddingString}'::vector) * -1 + 1
            ELSE
              (embedding::jsonb::text::vector <=> '${embeddingString}'::vector) * -1 + 1
          END as similarity
        FROM songs
        WHERE embedding_vector IS NOT NULL OR embedding IS NOT NULL
        ORDER BY
          CASE
            WHEN embedding_vector IS NOT NULL THEN
              embedding_vector <=> '${embeddingString}'::vector
            ELSE
              embedding::jsonb::text::vector <=> '${embeddingString}'::vector
          END
        LIMIT ${limit}
      `);

      if (results.length === 0) {
        logger.warn('No songs with embeddings found in database');
        return [];
      }

      logger.debug({ songCount: results.length }, 'Computing similarities complete');

      // Debug logging if DEBUG_MATCHING is enabled
      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          resultCount: results.length,
          top3Results: results.slice(0, 3).map(r => ({
            title: r.title,
            artist: r.artist,
            similarity: r.similarity.toFixed(4)
          })),
          sqlQuery: {
            usedNativeVector: true,
            embeddingDims: messageEmbedding.length,
            limit: k * 2
          }
        }, '[DEBUG_MATCHING] Query results');
      }

      // Convert results to SemanticMatch format
      const matches: SemanticMatch[] = results
        .filter((result: RawSimilarityResult) => result.similarity >= (this.config.similarity_threshold || 0.5))
        .map((result: RawSimilarityResult) => ({
          songId: result.id,
          title: result.title,
          artist: result.artist,
          similarity: result.similarity,
          distance: 1 - result.similarity,
          tags: result.tags || [],
          year: result.year || undefined,
          decade: result.year ? Math.floor(result.year / 10) * 10 : undefined,
          popularity: result.popularity
        }))
        .slice(0, k);

      const duration = Date.now() - startTime;
      logger.debug({
        totalResults: results.length,
        filteredMatches: matches.length,
        topSimilarity: matches[0]?.similarity || 0,
        duration
      }, 'Semantic search completed');

      return matches;

    } catch (error) {
      logger.error({ error, message }, 'Semantic search failed');
      throw error;
    }
  }

  /**
   * Find similar songs with additional filtering and boosting
   */
  async findSimilarWithContext(
    message: string,
    context: {
      preferredTags?: string[];
      excludedSongs?: string[];
      yearRange?: { min: number; max: number };
      minPopularity?: number;
    },
    k: number = 50
  ): Promise<SemanticMatch[]> {
    // First get the base semantic matches
    const baseMatches = await this.findSimilar(message, k * 2); // Get more initially

    // Apply context-based filtering and boosting
    let contextualMatches = baseMatches;

    // Filter by excluded songs
    if (context.excludedSongs?.length) {
      contextualMatches = contextualMatches.filter(match => 
        !context.excludedSongs!.includes(match.songId)
      );
    }

    // Filter by year range
    if (context.yearRange && context.yearRange.min && context.yearRange.max) {
      contextualMatches = contextualMatches.filter(match => 
        match.year && 
        match.year >= context.yearRange!.min && 
        match.year <= context.yearRange!.max
      );
    }

    // Filter by minimum popularity
    if (context.minPopularity) {
      contextualMatches = contextualMatches.filter(match => 
        match.popularity >= context.minPopularity!
      );
    }

    // Boost songs with preferred tags
    if (context.preferredTags?.length) {
      contextualMatches = contextualMatches.map(match => {
        const tagOverlap = match.tags.filter(tag => 
          context.preferredTags!.includes(tag.toLowerCase())
        ).length;
        
        if (tagOverlap > 0) {
          // Boost similarity by 10% per matching tag (max 50% boost)
          const boost = Math.min(tagOverlap * 0.1, 0.5);
          return {
            ...match,
            similarity: Math.min(1.0, match.similarity * (1 + boost))
          };
        }
        
        return match;
      });

      // Re-sort after boosting
      contextualMatches.sort((a, b) => b.similarity - a.similarity);
    }

    return contextualMatches.slice(0, k);
  }

  /**
   * Get embedding statistics for debugging
   */
  async getEmbeddingStats(): Promise<{
    totalSongs: number;
    songsWithEmbeddings: number;
    averageEmbeddingDimensions: number;
    embeddingCoverage: number;
  }> {
    const totalSongs = await this.prisma.song.count();
    
    // Use raw SQL to count songs with embeddings
    const embeddingStats = await this.prisma.$queryRaw<Array<{
      count: bigint;
      avg_dimension: number;
    }>>`
      SELECT 
        COUNT(*) as count,
        AVG(array_length(embedding::float[], 1)) as avg_dimension
      FROM songs 
      WHERE embedding IS NOT NULL
    `;

    const songsWithEmbeddings = Number(embeddingStats[0]?.count || 0);
    const avgDimensions = embeddingStats[0]?.avg_dimension || 0;

    return {
      totalSongs,
      songsWithEmbeddings,
      averageEmbeddingDimensions: Math.round(avgDimensions),
      embeddingCoverage: totalSongs > 0 ? songsWithEmbeddings / totalSongs : 0
    };
  }

  /**
   * Health check for semantic search
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Check if embedding service is available
      const embeddingService = await getEmbeddingService();
      const isEmbeddingHealthy = await embeddingService.getStatus();
      
      // Check if we have songs with embeddings
      const stats = await this.getEmbeddingStats();
      
      return isEmbeddingHealthy.primary.available && stats.songsWithEmbeddings > 0;
    } catch (error) {
      logger.warn({ error }, 'Semantic search health check failed');
      return false;
    }
  }

  /**
   * Batch similarity search for multiple queries
   */
  async batchFindSimilar(
    messages: string[], 
    k: number = 50
  ): Promise<SemanticMatch[][]> {
    const results: SemanticMatch[][] = [];
    
    for (const message of messages) {
      const matches = await this.findSimilar(message, k);
      results.push(matches);
    }
    
    return results;
  }
}