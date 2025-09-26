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
   * Search songs using multiple strategies
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
    logger.debug({ params }, 'Starting song search');

    let results: SearchResult[] = [];

    try {
      switch (params.strategy) {
        case 'exact':
          results = await this.exactSearch(params.q, params.limit);
          break;
        case 'phrase':
          results = await this.phraseSearch(params.q, params.limit);
          break;
        case 'embedding':
          results = await this.embeddingSearch(params.q, params.limit);
          break;
        case 'all':
        default:
          results = await this.combinedSearch(params.q, params.limit);
          break;
      }

      // Filter explicit content if needed
      if (!params.allowExplicit) {
        results = results.filter(result => !this.isExplicit(result));
      }

      const processingTime = Date.now() - startTime;
      
      logger.info({
        query: params.q,
        strategy: params.strategy,
        resultCount: results.length,
        processingTime
      }, 'Song search completed');

      return {
        results: results.slice(0, params.limit),
        metadata: {
          query: params.q,
          strategy: params.strategy,
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
   * Search by exact title/artist matches
   */
  private async exactSearch(query: string, limit: number): Promise<SearchResult[]> {
    const songs = await this.prisma.song.findMany({
      where: {
        OR: [
          {
            title: {
              contains: query,
              mode: 'insensitive'
            }
          },
          {
            artist: {
              contains: query,
              mode: 'insensitive'
            }
          }
        ]
      },
      orderBy: { popularity: 'desc' },
      take: limit * 2 // Get more to allow for filtering
    });

    return songs.map(song => this.songToSearchResult(song, this.getMatchType(song, query), this.calculateExactScore(song, query)));
  }

  /**
   * Search by phrase matches
   */
  private async phraseSearch(query: string, limit: number): Promise<SearchResult[]> {
    const phrases = this.extractPhrases(query);
    
    const songs = await this.prisma.song.findMany({
      where: {
        phrases: {
          hasSome: phrases
        }
      },
      orderBy: { popularity: 'desc' },
      take: limit * 2
    });

    return songs.map(song => {
      const matchingPhrases = song.phrases.filter((phrase: string) => 
        phrases.some(queryPhrase => 
          phrase.toLowerCase().includes(queryPhrase.toLowerCase()) ||
          queryPhrase.toLowerCase().includes(phrase.toLowerCase())
        )
      );
      const score = matchingPhrases.length / phrases.length;
      
      return this.songToSearchResult(song, 'phrase', score);
    });
  }

  /**
   * Search using embeddings (semantic similarity)
   */
  private async embeddingSearch(query: string, limit: number): Promise<SearchResult[]> {
    try {
      const embeddingService = await getEmbeddingService();
      const queryEmbedding = await embeddingService.embedSingle(query);
      
      // Get songs with embeddings using raw SQL to cast vector to text
      const songsWithEmbeddings = await this.prisma.$queryRaw<Array<Song & { embedding_text: string }>>`
        SELECT *, embedding::text as embedding_text FROM songs 
        WHERE embedding IS NOT NULL 
        ORDER BY popularity DESC 
        LIMIT ${limit * 3}
      `;

      const results: SearchResult[] = [];

      for (const song of songsWithEmbeddings) {
        try {
          const songEmbedding = this.parseEmbedding(song.embedding_text);
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
   * Combined search using all strategies
   */
  private async combinedSearch(query: string, limit: number): Promise<SearchResult[]> {
    const [exactResults, phraseResults, embeddingResults] = await Promise.all([
      this.exactSearch(query, Math.ceil(limit / 3)),
      this.phraseSearch(query, Math.ceil(limit / 3)),
      this.embeddingSearch(query, Math.ceil(limit / 3))
    ]);

    // Combine and deduplicate results
    const seenIds = new Set<string>();
    const combinedResults: SearchResult[] = [];

    // Add exact matches first (highest priority)
    for (const result of exactResults) {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        combinedResults.push({ ...result, score: (result.score || 0) * 1.2 }); // Boost exact matches
      }
    }

    // Add phrase matches
    for (const result of phraseResults) {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        combinedResults.push({ ...result, score: (result.score || 0) * 1.1 }); // Boost phrase matches
      }
    }

    // Add embedding matches
    for (const result of embeddingResults) {
      if (!seenIds.has(result.id)) {
        seenIds.add(result.id);
        combinedResults.push(result);
      }
    }

    // Sort by score and return top results
    return combinedResults
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);
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
   * Determine match type for exact search
   */
  private getMatchType(song: Song, query: string): SearchResult['matchType'] {
    const lowerQuery = query.toLowerCase();
    const lowerTitle = song.title.toLowerCase();
    const lowerArtist = song.artist.toLowerCase();

    if (lowerTitle.includes(lowerQuery)) return 'title';
    if (lowerArtist.includes(lowerQuery)) return 'artist';
    return 'title'; // fallback
  }

  /**
   * Calculate score for exact matches
   */
  private calculateExactScore(song: Song, query: string): number {
    const lowerQuery = query.toLowerCase();
    const lowerTitle = song.title.toLowerCase();
    const lowerArtist = song.artist.toLowerCase();

    let score = 0;

    // Title match scoring
    if (lowerTitle === lowerQuery) {
      score += 1.0; // Perfect title match
    } else if (lowerTitle.includes(lowerQuery)) {
      score += 0.8 * (query.length / song.title.length); // Partial title match
    }

    // Artist match scoring
    if (lowerArtist === lowerQuery) {
      score += 0.9; // Perfect artist match
    } else if (lowerArtist.includes(lowerQuery)) {
      score += 0.7 * (query.length / song.artist.length); // Partial artist match
    }

    // Boost by popularity
    score += (song.popularity / 100) * 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Extract meaningful phrases from query
   */
  private extractPhrases(query: string): string[] {
    const words = query.toLowerCase().split(/\s+/).filter(word => word.length >= 3);
    const phrases: string[] = [];
    
    // Add individual words
    phrases.push(...words);
    
    // Add bigrams
    for (let i = 0; i < words.length - 1; i++) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
    
    return phrases;
  }

  /**
   * Parse embedding from PostgreSQL vector string
   */
  private parseEmbedding(embeddingText: string): number[] {
    // Remove brackets and split by comma
    const cleaned = embeddingText.replace(/^\[|\]$/g, '');
    return cleaned.split(',').map(s => parseFloat(s.trim()));
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