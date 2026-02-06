/**
 * Song Matching Service
 * 
 * Processes user messages to find matching songs using text analysis,
 * embeddings, and various matching strategies. Returns primary match
 * with alternates and reasoning.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/index.js';
import { SemanticSearcher } from '../engine/matchers/semantic.js';

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

interface SongMatch {
  song: Song;
  score: number;
  reason: {
    matchedPhrase?: string;
    mood?: string;
    similarity?: number;
    strategy: 'embedding' | 'semantic';
  };
}

export interface SongMatchResult {
  primary: Song;
  alternates: Song[];
  scores: {
    strategy: string;
    confidence: number;
    debugInfo?: any;
  };
  why: {
    matchedPhrase?: string;
    similarity?: number;
    mood?: string;
    tags?: string[];
    fallbackReason?: string;
  };
}

export class SongMatchingService {
  private prisma: PrismaClient;
  private semanticSearcher: SemanticSearcher;
  private readonly CONFIDENCE_THRESHOLD = 0.7;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.semanticSearcher = new SemanticSearcher(prisma, {
      knn_size: 50,
      similarity_threshold: 0.0, // Allow any similarity - let confidence scoring reflect quality
      use_reranking: true
    });
  }

  /**
   * Calculate calibrated confidence using softmax of score difference
   * For MVP: confidence = softmax(score_top - score_2nd)
   */
  private calculateConfidence(matches: SongMatch[]): number {
    if (matches.length < 2) {
      return matches.length === 1 ? 0.95 : 0.0;
    }

    const topScore = matches[0].score;
    const secondScore = matches[1].score;
    const scoreDiff = topScore - secondScore;
    
    // Softmax-like confidence calculation
    // Scale the difference and apply sigmoid
    const scaledDiff = scoreDiff * 5; // Scale factor for sensitivity
    const confidence = 1 / (1 + Math.exp(-scaledDiff));
    
    return Math.max(0.1, Math.min(0.99, confidence));
  }

  /**
   * Select diverse alternates avoiding same artist/decade unless user preferences allow
   */
  private async selectAlternates(matches: SongMatch[], userId?: string): Promise<SongMatch[]> {
    if (matches.length <= 1) return [];

    const primary = matches[0];
    const candidates = matches.slice(1);
    const alternates: SongMatch[] = [];
    
    // Get user's recent picks to understand preferences
    let userRecentPicks: any[] = [];
    if (userId) {
      try {
        userRecentPicks = await this.prisma.message.findMany({
          where: { userId },
          include: { 
            song: true 
          },
          orderBy: { createdAt: 'desc' },
          take: 3
        });
      } catch (error) {
        logger.debug({ error }, 'Could not fetch user recent picks');
      }
    }

    // Check if user's recent picks span multiple eras (different decades)
    const recentDecades = new Set(
      userRecentPicks
        .filter(pick => pick.song?.year)
        .map(pick => Math.floor((pick.song!.year!) / 10) * 10)
    );
    const spansMultipleEras = recentDecades.size > 1;

    // Select alternates with diversity constraints
    for (const candidate of candidates) {
      if (alternates.length >= 2) break;

      const shouldInclude = this.shouldIncludeAlternate(
        candidate, 
        primary, 
        alternates, 
        spansMultipleEras
      );

      if (shouldInclude) {
        alternates.push(candidate);
      }
    }

    return alternates;
  }

  /**
   * Determine if an alternate should be included based on diversity rules
   */
  private shouldIncludeAlternate(
    candidate: SongMatch, 
    primary: SongMatch, 
    existingAlternates: SongMatch[], 
    userSpansEras: boolean
  ): boolean {
    // Always avoid same artist as primary unless user spans eras
    if (!userSpansEras && candidate.song.artist.toLowerCase() === primary.song.artist.toLowerCase()) {
      return false;
    }

    // Avoid same decade as primary unless user spans eras
    if (!userSpansEras && candidate.song.year && primary.song.year) {
      const candidateDecade = Math.floor(candidate.song.year / 10) * 10;
      const primaryDecade = Math.floor(primary.song.year / 10) * 10;
      if (candidateDecade === primaryDecade) {
        return false;
      }
    }

    // Check against existing alternates
    for (const existing of existingAlternates) {
      // Avoid same artist
      if (candidate.song.artist.toLowerCase() === existing.song.artist.toLowerCase()) {
        return false;
      }

      // Avoid same decade unless user spans eras
      if (!userSpansEras && candidate.song.year && existing.song.year) {
        const candidateDecade = Math.floor(candidate.song.year / 10) * 10;
        const existingDecade = Math.floor(existing.song.year / 10) * 10;
        if (candidateDecade === existingDecade) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Generate reasoning text for the match
   */
  /**
   * Process a text message and find matching songs
   */
  async matchSongs(
    text: string,
    allowExplicit: boolean = false,
    userId?: string,
    _roomAllowsExplicit: boolean = false
  ): Promise<SongMatchResult> {
    logger.debug({ text, allowExplicit, userId }, 'Starting song matching process');

    // Process text directly without moderation
    return await this.processMatchingStrategies(text, allowExplicit, userId);
  }

  /**
   * Process song matching strategies
   */
  private async processMatchingStrategies(
    text: string,
    allowExplicit: boolean,
    userId?: string
  ): Promise<SongMatchResult> {
    const cleanText = this.cleanText(text);

    if (process.env.DEBUG_MATCHING === '1') {
      logger.info({
        original_text: text,
        normalized_text: cleanText,
        text_length: cleanText.length
      }, '[DEBUG_MATCHING] Text normalization');
    }

    // ONLY use semantic/embedding-based matching
    let matches: SongMatch[] = [];
    let didFallback = false;
    let fallbackReason = '';

    // Embedding-based semantic search
    matches = await this.findEmbeddingMatches(cleanText);

    // If semantic search fails, use popular songs as fallback
    if (matches.length === 0) {
      didFallback = true;
      fallbackReason = 'embedding_search_returned_empty';
      logger.warn({
        text: cleanText,
        textLength: cleanText.length,
        originalText: text,
        message: 'Semantic search returned 0 results - possible connection or query issue'
      }, 'Semantic search returned no results, using fallback');
      matches = await this.getDefaultMatches();

      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          did_fallback: didFallback,
          fallback_reason: fallbackReason,
          fallback_matches: matches.map(m => ({
            title: m.song.title,
            artist: m.song.artist,
            score: m.score
          }))
        }, '[DEBUG_MATCHING] Fallback triggered');
      }

      // If still no matches (empty database), throw error
      if (matches.length === 0) {
        throw new Error('Database is empty - no songs available');
      }
    } else if (process.env.DEBUG_MATCHING === '1') {
      logger.info({
        did_fallback: false,
        match_count: matches.length,
        top_match: {
          title: matches[0].song.title,
          artist: matches[0].song.artist,
          score: matches[0].score
        }
      }, '[DEBUG_MATCHING] Embedding search succeeded');
    }

    // Filter out recently shown songs to avoid repetition
    if (userId) {
      try {
        const recentMessages = await this.prisma.message.findMany({
          where: { userId },
          include: { song: true },
          orderBy: { createdAt: 'desc' },
          take: 10 // Look at last 10 songs shown to user
        });

        const recentSongIds = new Set(recentMessages.map(m => m.song?.id).filter(Boolean));

        // Filter out recently shown songs, but keep at least 5 matches
        const filteredMatches = matches.filter(m => !recentSongIds.has(m.song.id));
        if (filteredMatches.length >= 5) {
          matches = filteredMatches;
          logger.debug({ removedCount: matches.length - filteredMatches.length }, 'Filtered out recently shown songs');
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to fetch recent songs for filtering');
      }
    }

    // Filter explicit content if needed
    if (!allowExplicit) {
      matches = matches.filter(match => !this.isExplicit(match.song));
    }

    // Ensure we have at least one match
    if (matches.length === 0) {
      matches = await this.getDefaultMatches();
    }

    // Sort by score and prepare result
    matches.sort((a, b) => b.score - a.score);
    
    const primary = matches[0];
    
    // Safety check - if we still don't have matches, throw a meaningful error
    if (!primary) {
      logger.error({
        originalText: text,
        cleanText,
        matchesLength: matches.length
      }, 'No songs found in database - cannot process request');
      
      throw new Error('No songs available in database. Database may need to be seeded.');
    }
    
    // Calculate calibrated confidence
    const confidence = this.calculateConfidence(matches);
    
    // Select diverse alternates based on confidence and user preferences
    let alternates: SongMatch[] = [];
    if (confidence < this.CONFIDENCE_THRESHOLD) {
      alternates = await this.selectAlternates(matches, userId);
    }

    logger.info({
      text: cleanText,
      primarySong: `${primary.song.artist} - ${primary.song.title}`,
      strategy: primary.reason.strategy,
      score: primary.score,
      confidence: confidence, // Keep full precision
      alternatesCount: alternates.length
    }, 'Song matching completed');

    return {
      primary: primary.song,
      alternates: alternates.map(match => match.song),
      scores: {
        confidence: confidence, // Keep full precision
        strategy: primary.reason.strategy,
        debugInfo: {
          primaryScore: primary.score,
          totalMatches: matches.length
        }
      },
      why: {
        matchedPhrase: primary.reason.matchedPhrase,
        similarity: primary.reason.similarity,
        mood: primary.reason.mood
      }
    };
  }



  /**
   * Find matches using embedding similarity (uses SemanticSearcher with native pgvector)
   */
  private async findEmbeddingMatches(text: string): Promise<SongMatch[]> {
    try {
      // Use SemanticSearcher which properly uses native embedding_vector column with HNSW index
      const semanticMatches = await this.semanticSearcher.findSimilar(text, 50);

      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          query_text: text,
          raw_results_count: semanticMatches.length,
          top_10_raw: semanticMatches.slice(0, 10).map(m => ({
            title: m.title,
            artist: m.artist,
            similarity: m.similarity.toFixed(4),
            tags: m.tags.slice(0, 3)
          }))
        }, '[DEBUG_MATCHING] Raw semantic search results');
      }

      if (semanticMatches.length === 0) {
        logger.debug('No semantic matches found');
        return [];
      }

      // Convert SemanticMatch to SongMatch format
      const matchPromises = semanticMatches.map(async (match) => {
        // Fetch full song data, excluding placeholders at DB level
        const song = await this.prisma.song.findFirst({
          where: {
            id: match.songId,
            isPlaceholder: false  // Exclude placeholders
          }
        });

        if (!song) {
          return null;
        }

        const songMatch: SongMatch = {
          song: song as Song,
          score: match.similarity,
          reason: {
            strategy: 'embedding',
            similarity: match.similarity,
            mood: this.detectMood(text)
          }
        };

        return songMatch;
      });

      const matchesWithNulls = await Promise.all(matchPromises);
      const matches = matchesWithNulls
        .filter((m) => m !== null) as SongMatch[];

      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          before_placeholder_filter: semanticMatches.length,
          after_placeholder_filter: matches.length,
          filtered_out: semanticMatches.length - matches.length
        }, '[DEBUG_MATCHING] Placeholder filtering results');
      }

      if (matches.length === 0) {
        logger.warn('All semantic matches were placeholder songs or not found');
        return [];
      }

      return matches.slice(0, 10);
    } catch (error) {
      logger.warn({ error }, 'Embedding matching failed, falling back');
      if (process.env.DEBUG_MATCHING === '1') {
        logger.info({
          error: error instanceof Error ? error.message : String(error)
        }, '[DEBUG_MATCHING] Exception in findEmbeddingMatches');
      }
      return [];
    }
  }


  /**
   * Get default popular songs as last resort
   */
  private async getDefaultMatches(): Promise<SongMatch[]> {
    const songs = await this.prisma.song.findMany({
      where: {
        isPlaceholder: false  // Exclude placeholders at DB level
      },
      orderBy: { popularity: 'desc' },
      take: 3
    });

    logger.info({
      songsCount: songs.length,
      songs: songs.slice(0, 2)
    }, 'getDefaultMatches query result');

    if (songs.length === 0) {
      logger.warn('No real (non-placeholder) songs found in database! Database may need to be seeded.');
      return [];
    }

    return songs.map((song: Song) => ({
      song,
      score: 0.3,
      reason: {
        strategy: 'semantic',
        mood: 'neutral'
      }
    }));
  }

  /**
   * Clean and normalize text
   */
  private cleanText(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  /**
   * Detect mood from text
   */
  private detectMood(text: string): string {
    const lowerText = text.toLowerCase();
    
    if (/happy|joy|upbeat|dance|party|celebrate/i.test(lowerText)) return 'happy';
    if (/sad|depressed|cry|lonely|heartbreak/i.test(lowerText)) return 'sad';
    if (/angry|mad|rage|furious|hate/i.test(lowerText)) return 'angry';
    if (/love|romantic|kiss|heart|valentine/i.test(lowerText)) return 'romantic';
    if (/chill|relax|calm|peaceful|mellow/i.test(lowerText)) return 'chill';
    if (/energy|pump|workout|intense|power/i.test(lowerText)) return 'energetic';
    
    return 'neutral';
  }

  /**
   * Check if a song contains explicit content
   */
  private isExplicit(song: Song): boolean {
    return song.tags.some(tag =>
      ['explicit', 'profanity', 'adult'].includes(tag.toLowerCase())
    );
  }
}