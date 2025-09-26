/**
 * Keyword/Idiom Matcher
 * 
 * Performs exact and lemmatized phrase matching against Song.phrases
 * with clarity-based scoring.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/index.js';
import { ContentFilter } from '../content-filter.js';

export interface KeywordMatch {
  songId: string;
  title: string;
  artist: string;
  matchedPhrase: string;
  originalPhrase: string;
  matchType: 'exact' | 'lemmatized';
  score: number;
  clarity: number;
  tags: string[];
  decade?: number;
}

export interface KeywordConfig {
  exact_weight: number;
  lemma_weight: number;
  min_phrase_length: number;
}

export class KeywordMatcher {
  private prisma: PrismaClient;
  private config: KeywordConfig;
  private contentFilter: ContentFilter;
  private phraseCache = new Map<string, Omit<KeywordMatch, 'matchType' | 'score'>[]>();
  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
    'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should'
  ]);

  constructor(prisma: PrismaClient, config: KeywordConfig) {
    this.prisma = prisma;
    this.config = config;
    
    // Initialize content filter with default config  
    this.contentFilter = new ContentFilter({
      allowExplicit: true,
      familyFriendlyMode: false,
      strictFiltering: false,
      logFilteredContent: false
    });
  }

  /**
   * Find song matches based on keyword/phrase matching
   */
  async findMatches(message: string): Promise<KeywordMatch[]> {
    const phrases = this.extractPhrases(message);
    const matches: KeywordMatch[] = [];

    logger.debug({ phrases }, 'Extracted phrases from message');

    for (const phrase of phrases) {
      if (phrase.length < this.config.min_phrase_length) continue;
      
      // Try exact match first
      const exactMatches = await this.findExactMatches(phrase, message);
      for (const match of exactMatches) {
        matches.push({
          ...match,
          matchType: 'exact',
          score: this.config.exact_weight * match.clarity
        });
      }

      // If no exact matches, try lemmatized matching
      if (exactMatches.length === 0) {
        const lemmaMatches = await this.findLemmatizedMatches(phrase, message);
        for (const match of lemmaMatches) {
          matches.push({
            ...match,
            matchType: 'lemmatized', 
            score: this.config.lemma_weight * match.clarity
          });
        }
      }
    }

    // Deduplicate by songId, keeping highest scoring match
    const deduped = this.deduplicate(matches);
    
    logger.debug({ 
      originalMatches: matches.length, 
      deduplicatedMatches: deduped.length 
    }, 'Keyword matching completed');

    return deduped.sort((a, b) => b.score - a.score);
  }

  /**
   * Extract meaningful phrases from the message
   */
  private extractPhrases(message: string): string[] {
    // Clean and normalize the message
    const cleaned = message.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter(word => 
      word.length > 1 && !this.stopWords.has(word)
    );

    const phrases: string[] = [];
    
    // Add individual words
    phrases.push(...words);
    
    // Add 2-word combinations
    for (let i = 0; i < words.length - 1; i++) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
    
    // Add 3-word combinations
    for (let i = 0; i < words.length - 2; i++) {
      phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    
    // Add 4-word combinations for longer messages
    if (words.length > 6) {
      for (let i = 0; i < words.length - 3; i++) {
        phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`);
      }
    }
    
    return phrases;
  }

  /**
   * Find exact phrase matches in song phrases
   */
  private async findExactMatches(phrase: string, originalMessage: string): Promise<Omit<KeywordMatch, 'matchType' | 'score'>[]> {
    // Use cached results if available
    const cacheKey = `exact:${phrase}`;
    if (this.phraseCache.has(cacheKey)) {
      return this.phraseCache.get(cacheKey)!;
    }

    const songs = await this.prisma.song.findMany({
      where: {
        phrases: {
          has: phrase // Check if the phrase array contains this exact phrase
        }
      },
      select: {
        id: true,
        title: true,
        artist: true,
        phrases: true,
        tags: true,
        year: true,
        popularity: true
      }
    });

    const matches = songs
      .map((song: any) => {
        // Find the actual matching phrases in the array
        const matchingPhrases = song.phrases.filter((p: string) => 
          p.toLowerCase().includes(phrase.toLowerCase())
        );
        
        return matchingPhrases.map((matchedPhrase: string) => ({
          songId: song.id,
          title: song.title,
          artist: song.artist,
          matchedPhrase,
          originalPhrase: phrase,
          clarity: this.calculateClarityScore(matchedPhrase, song.popularity, song.title, originalMessage),
          tags: song.tags || [],
          decade: song.year ? Math.floor(song.year / 10) * 10 : undefined
        }));
      })
      .flat()
      .filter(match => match.matchedPhrase.length >= this.config.min_phrase_length);

    // Cache the results
    this.phraseCache.set(cacheKey, matches);
    
    return matches;
  }

  /**
   * Find lemmatized matches (simplified - just removes common suffixes)
   */
  private async findLemmatizedMatches(phrase: string, originalMessage: string): Promise<Omit<KeywordMatch, 'matchType' | 'score'>[]> {
    const lemmatized = this.lemmatizePhrase(phrase);
    
    // Use cached results if available
    const cacheKey = `lemma:${lemmatized}`;
    if (this.phraseCache.has(cacheKey)) {
      return this.phraseCache.get(cacheKey)!;
    }

    // Search for songs that have phrases containing the lemmatized phrase
    const songs = await this.prisma.song.findMany({
      where: {
        phrases: {
          hasSome: [lemmatized] // Check if any phrase in the array contains the lemmatized phrase
        }
      },
      select: {
        id: true,
        title: true,
        artist: true,
        phrases: true,
        tags: true,
        year: true,
        popularity: true
      }
    });

    const matches = songs
      .map((song: any) => {
        const matchingPhrases = song.phrases.filter((p: string) => 
          p.toLowerCase().includes(lemmatized.toLowerCase())
        );
        
        return matchingPhrases.map((matchedPhrase: string) => ({
          songId: song.id,
          title: song.title,
          artist: song.artist,
          matchedPhrase,
          originalPhrase: phrase,
          clarity: this.calculateClarityScore(matchedPhrase, song.popularity, song.title, originalMessage),
          tags: song.tags || [],
          decade: song.year ? Math.floor(song.year / 10) * 10 : undefined
        }));
      })
      .flat()
      .filter(match => match.matchedPhrase.length >= this.config.min_phrase_length);

    // Cache the results
    this.phraseCache.set(cacheKey, matches);
    
    return matches;
  }

  /**
   * Simple lemmatization - removes common English suffixes
   */
  private lemmatizePhrase(phrase: string): string {
    const suffixes = [
      'ing', 'ed', 'er', 'est', 'ly', 's', 'es', 'ies', 'ied', 'ier', 'iest'
    ];
    
    return phrase.split(' ').map(word => {
      if (word.length <= 3) return word;
      
      for (const suffix of suffixes) {
        if (word.endsWith(suffix) && word.length > suffix.length + 2) {
          return word.slice(0, -suffix.length);
        }
      }
      return word;
    }).join(' ');
  }

  /**
   * Calculate clarity score based on phrase specificity, song popularity, and clarity prior rules
   */
  private calculateClarityScore(
    phrase: string, 
    popularity: number, 
    songTitle: string, 
    originalMessage: string
  ): number {
    // Get clarity assessment using content filter
    const clarityAssessment = this.contentFilter.assessClarity(originalMessage, songTitle);
    
    // Base clarity score from phrase length and word count
    const wordCount = phrase.split(' ').length;
    const charLength = phrase.length;
    
    // Longer, more specific phrases get higher clarity scores
    const lengthScore = Math.min(charLength / 50, 1.0); // Max 1.0 for 50+ char phrases
    const wordScore = Math.min(wordCount / 10, 1.0);   // Max 1.0 for 10+ word phrases
    
    // Popularity bonus (normalize to 0-1 range)
    const popularityScore = Math.min(popularity / 100, 1.0);
    
    // Combine base scores with weights
    const baseScore = (
      lengthScore * 0.4 +     // 40% phrase length
      wordScore * 0.4 +       // 40% word count  
      popularityScore * 0.2   // 20% popularity
    );
    
    // Apply clarity prior: +0.2 for exact/idiom, -0.2 for metaphorical/obscure
    const finalScore = baseScore + clarityAssessment.clarityBonus;
    
    // Ensure score is between 0.1 and 1.2 (allowing bonus to exceed 1.0)
    const clampedScore = Math.max(0.1, Math.min(1.2, finalScore));
    
    // Log clarity adjustments for debugging
    if (clarityAssessment.clarityBonus !== 0) {
      logger.debug({
        phrase,
        songTitle,
        baseScore,
        clarityBonus: clarityAssessment.clarityBonus,
        finalScore: clampedScore,
        reasons: clarityAssessment.reasons
      }, 'Applied clarity prior adjustment');
    }
    
    return clampedScore;
  }

  /**
   * Deduplicate matches by songId, keeping the highest scoring match
   */
  private deduplicate(matches: KeywordMatch[]): KeywordMatch[] {
    const deduped = new Map<string, KeywordMatch>();
    
    for (const match of matches) {
      const existing = deduped.get(match.songId);
      if (!existing || match.score > existing.score) {
        deduped.set(match.songId, match);
      }
    }
    
    return Array.from(deduped.values());
  }

  /**
   * Health check for the keyword matcher
   */
  isHealthy(): boolean {
    return true; // Simple health check - could be enhanced
  }

  /**
   * Clear the phrase cache
   */
  clearCache(): void {
    this.phraseCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.phraseCache.size,
      hitRate: 0 // TODO: implement hit rate tracking
    };
  }
}