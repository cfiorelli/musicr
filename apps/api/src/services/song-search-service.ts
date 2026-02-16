/**
 * Song Search Service
 * 
 * Provides debugging and search functionality for songs using various strategies
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/index.js';
import { SearchRequest, SearchResult } from '../schemas/api.js';
import { getEmbeddingService } from '../embeddings/index.js';

// Define Song type based on schema
interface Song {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  popularity: number;
  tags: string[];
  phrases: string[];
  mbid: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SongSearchService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Search songs using semantic/embedding similarity
   */
  async search(params: SearchRequest): Promise<{
    results: SearchResult[];
    metadata: {
      query: string;
      strategy: string;
      total: number;
      limit: number;
      processingTime: number;
      timestamp: string;
    };
  }> {
    const startTime = Date.now();
    logger.debug({ params }, 'Starting semantic song search');

    let results: SearchResult[] = [];

    try {
      // ONLY use semantic/embedding search
      results = await this.embeddingSearch(params.q, params.limit);

      // Filter explicit content if needed
      if (!params.allowExplicit) {
        results = results.filter(result => !this.isExplicit(result));
      }

      const processingTime = Date.now() - startTime;

      logger.info({
        query: params.q,
        strategy: 'embedding',
        resultCount: results.length,
        processingTime
      }, 'Song search completed');

      return {
        results: results.slice(0, params.limit),
        metadata: {
          query: params.q,
          strategy: 'embedding',
          total: results.length,
          limit: params.limit,
          processingTime,
          timestamp: new Date().toISOString(),
        }
      };

    } catch (error) {
      logger.error({ error, params }, 'Song search failed');
      throw error;
    }
  }

  /**
   * Search using native pgvector similarity (cosine distance via HNSW index)
   */
  private async embeddingSearch(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const embeddingService = await getEmbeddingService();
      const queryEmbedding = await embeddingService.embedSingle(query);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      const results = await this.prisma.$queryRawUnsafe<Array<Song & { similarity: number }>>(`
        SELECT s.id, s.title, s.artist, s.year, s.popularity, s.tags, s.phrases, s.mbid,
               s."createdAt", s."updatedAt",
               (s.embedding_vector <=> '${embeddingString}'::vector) * -1 + 1 as similarity
        FROM songs s
        WHERE s.embedding_vector IS NOT NULL AND s.is_placeholder = false
        ORDER BY s.embedding_vector <=> '${embeddingString}'::vector
        LIMIT ${limit}
      `);

      return results
        .filter(r => r.similarity > 0.3)
        .map(r => this.songToSearchResult(r, 'embedding', r.similarity));

    } catch (error) {
      logger.warn({ error }, 'Embedding search failed, returning empty results');
      return [];
    }
  }

  /**
   * Convert Song to SearchResult
   */
  private songToSearchResult(song: Song, matchType: SearchResult['matchType'], score?: number): SearchResult {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      year: song.year || undefined,
      popularity: song.popularity,
      tags: song.tags,
      phrases: song.phrases,
      matchType,
      score
    };
  }

  /**
   * Check if result contains explicit content
   */
  private isExplicit(result: SearchResult): boolean {
    return result.tags.some(tag => 
      ['explicit', 'profanity', 'adult'].includes(tag.toLowerCase())
    );
  }
}