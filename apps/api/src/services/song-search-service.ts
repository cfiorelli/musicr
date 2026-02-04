/**
 * Song Search Service
 * 
 * Provides debugging and search functionality for songs using various strategies
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/index.js';
import { SearchRequest, SearchResult } from '../schemas/api.js';
import { getEmbeddingService, cosineSimilarity } from '../embeddings/index.js';

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
  embedding?: unknown;
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
   * Search using embeddings (semantic similarity)
   */
  private async embeddingSearch(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const embeddingService = await getEmbeddingService();
      const queryEmbedding = await embeddingService.embedSingle(query);
      
      // Get songs with embeddings using raw SQL
      const songsWithEmbeddings = await this.prisma.$queryRaw<Array<Song & { embedding: number[] }>>`
        SELECT * FROM songs 
        WHERE embedding IS NOT NULL 
        ORDER BY popularity DESC 
        LIMIT ${limit * 3}
      `;

      const results: SearchResult[] = [];

      for (const song of songsWithEmbeddings) {
        try {
          const songEmbedding = song.embedding as number[];
          const similarity = cosineSimilarity(queryEmbedding, songEmbedding);
          
          if (similarity > 0.3) { // Lower threshold for search
            results.push(this.songToSearchResult(song, 'embedding', similarity));
          }
        } catch (error) {
          logger.debug({ error, songId: song.id }, 'Failed to parse embedding for song');
        }
      }

      return results.sort((a, b) => (b.score || 0) - (a.score || 0));

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