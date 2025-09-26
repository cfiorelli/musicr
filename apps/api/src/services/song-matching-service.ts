/**
 * Song Matching Service
 * 
 * Processes user messages to find matching songs using text analysis,
 * embeddings, and various matching strategies. Returns primary match
 * with alternates and reasoning.
 */

import { PrismaClient, Song } from '@prisma/client';
import { logger } from '../config/index.js';
import { getEmbeddingService, cosineSimilarity } from '../embeddings/index.js';
import { phraseLexicon } from './phrase-lexicon-service.js';
import { moderationService, ModerationConfig } from './moderation-service.js';

interface SongMatch {
  song: Song;
  score: number;
  reason: {
    matchedPhrase?: string;
    mood?: string;
    similarity?: number;
    strategy: 'exact' | 'phrase' | 'embedding' | 'semantic';
  };
}

interface SongMatchResult {
  type: 'song';
  primary: {
    title: string;
    artist: string;
    year?: number;
  };
  alternates: Array<{
    title: string;
    artist: string;
    year?: number;
    score: number;
  }>;
  scores: {
    confidence: number;
    strategy: string;
    reasoning: string;
  };
  why: string;
}

export class SongMatchingService {
  private prisma: PrismaClient;
  private readonly MIN_SIMILARITY_THRESHOLD = 0.6;
  private readonly CONFIDENCE_THRESHOLD = 0.7;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    // Initialize phrase lexicon in the background
    this.initializePhraseService();
  }

  private async initializePhraseService(): Promise<void> {
    try {
      await phraseLexicon.initialize();
    } catch (error) {
      logger.warn({ error }, 'Failed to initialize phrase lexicon service');
    }
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
  private generateReasoning(match: SongMatch): string {
    let reasoning = '';

    switch (match.reason.strategy) {
      case 'exact':
        reasoning = 'Exact match found in song title or artist name';
        break;
      case 'phrase':
        reasoning = match.reason.matchedPhrase 
          ? `Matched phrase: "${match.reason.matchedPhrase}"` 
          : 'Found matching phrases or keywords';
        break;
      case 'embedding':
      case 'semantic':
        reasoning = match.reason.similarity 
          ? `Semantic similarity: ${Math.round(match.reason.similarity * 100)}%` 
          : 'Semantic match based on meaning and context';
        break;
      default:
        reasoning = 'Matched based on popularity and relevance';
    }

    if (match.reason.mood) {
      reasoning += `, mood: ${match.reason.mood}`;
    }

    return reasoning;
  }

  /**
   * Process a text message and find matching songs
   */
  async matchSongs(
    text: string, 
    allowExplicit: boolean = false, 
    userId?: string,
    roomAllowsExplicit: boolean = false
  ): Promise<SongMatchResult> {
    logger.debug({ text, allowExplicit, userId }, 'Starting song matching process');

    // Step 1: Content moderation
    const moderationConfig: ModerationConfig = {
      strictMode: false,
      allowNSFW: roomAllowsExplicit,
      logViolations: true
    };

    const moderationResult = await moderationService.moderateContent(text, moderationConfig);
    
    if (!moderationResult.allowed) {
      // For slurs, decline completely
      if (moderationResult.category === 'slur') {
        throw new Error(moderationService.getPolicyDeclineMessage('slur'));
      }
      
      // For other violations, use replacement text or neutral mapping
      const replacementText = moderationResult.replacementText || 'neutral song';
      logger.info({
        originalText: text,
        replacementText,
        reason: moderationResult.reason
      }, 'Content moderated, using neutral mapping');
      
      text = replacementText;
    }

    const cleanText = this.cleanText(text);
    
    // Try different matching strategies in order of precision
    let matches: SongMatch[] = [];
    
    // Strategy 1: Exact title/artist matches
    matches = await this.findExactMatches(cleanText);
    
    // Strategy 2: Phrase matches (song contains words from message)
    if (matches.length === 0) {
      matches = await this.findPhraseMatches(cleanText);
    }
    
    // Strategy 3: Embedding-based semantic search
    if (matches.length === 0) {
      matches = await this.findEmbeddingMatches(cleanText);
    }
    
    // Strategy 4: Fallback to popular songs with text analysis
    if (matches.length === 0) {
      matches = await this.findFallbackMatches(cleanText);
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
      confidence: Math.round(confidence * 100) / 100,
      alternatesCount: alternates.length
    }, 'Song matching completed');

    return {
      type: 'song',
      primary: {
        title: primary.song.title,
        artist: primary.song.artist,
        year: primary.song.year || undefined,
      },
      alternates: alternates.map(match => ({
        title: match.song.title,
        artist: match.song.artist,
        year: match.song.year || undefined,
        score: Math.round(match.score * 100) / 100,
      })),
      scores: {
        confidence: Math.round(confidence * 100) / 100,
        strategy: primary.reason.strategy,
        reasoning: this.generateReasoning(primary)
      },
      why: this.generateReasoning(primary)
    };
  }

  /**
   * Find exact matches in song titles and artists
   */
  private async findExactMatches(text: string): Promise<SongMatch[]> {
    const words = text.toLowerCase().split(/\s+/);
    const matches: SongMatch[] = [];

    // Search for songs where title or artist contains the text
    const songs = await this.prisma.song.findMany({
      where: {
        OR: [
          {
            title: {
              contains: text,
              mode: 'insensitive'
            }
          },
          {
            artist: {
              contains: text,
              mode: 'insensitive'
            }
          }
        ]
      },
      orderBy: { popularity: 'desc' },
      take: 20
    });

    for (const song of songs) {
      const titleWords = song.title.toLowerCase().split(/\s+/);
      const artistWords = song.artist.toLowerCase().split(/\s+/);
      
      // Calculate match score based on word overlap
      const titleOverlap = this.calculateWordOverlap(words, titleWords);
      const artistOverlap = this.calculateWordOverlap(words, artistWords);
      
      if (titleOverlap > 0.5 || artistOverlap > 0.5) {
        matches.push({
          song,
          score: Math.max(titleOverlap, artistOverlap) * 1.0 + (song.popularity / 100) * 0.1,
          reason: {
            strategy: 'exact',
            matchedPhrase: titleOverlap > artistOverlap ? song.title : song.artist
          }
        });
      }
    }

    return matches;
  }

  /**
   * Find matches using phrase analysis
   */
  private async findPhraseMatches(text: string): Promise<SongMatch[]> {
    const matches: SongMatch[] = [];

    // Strategy 1: Use phrase lexicon for fast lookup
    try {
      const phraseMatches = phraseLexicon.findPhraseMatches(text);
      
      for (const phraseMatch of phraseMatches.slice(0, 5)) { // Top 5 phrase matches
        const songs = await this.prisma.song.findMany({
          where: {
            id: { in: phraseMatch.songIds }
          }
        });

        for (const song of songs) {
          matches.push({
            song,
            score: 0.8 + (phraseMatch.confidence * 0.15) + (song.popularity / 100) * 0.05,
            reason: {
              strategy: 'phrase',
              matchedPhrase: phraseMatch.phrase,
              mood: this.detectMood(text)
            }
          });
        }
      }
      
      logger.debug({ matches: matches.length }, 'Found phrase lexicon matches');
    } catch (error) {
      logger.warn({ error }, 'Failed to use phrase lexicon, falling back to database search');
    }

    // Strategy 2: Fallback to database phrase search if no lexicon matches
    if (matches.length === 0) {
      const songs = await this.prisma.song.findMany({
        where: {
          phrases: {
            hasSome: this.extractPhrases(text)
          }
        },
        orderBy: { popularity: 'desc' },
        take: 15
      });

      for (const song of songs) {
        const matchingPhrases = song.phrases.filter(phrase => 
          text.toLowerCase().includes(phrase.toLowerCase()) ||
          phrase.toLowerCase().includes(text.toLowerCase())
        );

        if (matchingPhrases.length > 0) {
          matches.push({
            song,
            score: 0.7 + (matchingPhrases.length * 0.1) + (song.popularity / 100) * 0.05,
            reason: {
              strategy: 'phrase',
              matchedPhrase: matchingPhrases[0],
              mood: this.detectMood(text)
            }
          });
        }
      }
    }

    return matches;
  }

  /**
   * Find matches using embedding similarity
   */
  private async findEmbeddingMatches(text: string): Promise<SongMatch[]> {
    try {
      const embeddingService = await getEmbeddingService();
      const textEmbedding = await embeddingService.embedSingle(text);
      
      // Get songs with embeddings using raw query since embedding field is Unsupported
      const songsWithEmbeddings = await this.prisma.$queryRaw<Array<Song & { embedding: any }>>`
        SELECT * FROM songs 
        WHERE embedding IS NOT NULL 
        ORDER BY popularity DESC 
        LIMIT 100
      `;

      const matches: SongMatch[] = [];

      for (const song of songsWithEmbeddings) {
        if (song.embedding) {
          // Convert PostgreSQL vector to number array
          const songEmbedding = this.parseEmbedding(song.embedding);
          const similarity = cosineSimilarity(textEmbedding, songEmbedding);
          
          if (similarity >= this.MIN_SIMILARITY_THRESHOLD) {
            matches.push({
              song,
              score: similarity * 0.9 + (song.popularity / 100) * 0.1,
              reason: {
                strategy: 'embedding',
                similarity: similarity,
                mood: this.detectMood(text)
              }
            });
          }
        }
      }

      return matches.sort((a, b) => b.score - a.score).slice(0, 10);
    } catch (error) {
      logger.warn({ error }, 'Embedding matching failed, falling back');
      return [];
    }
  }

  /**
   * Fallback matches using popularity and basic text analysis
   */
  private async findFallbackMatches(text: string): Promise<SongMatch[]> {
    const mood = this.detectMood(text);
    const moodTags = this.getMoodTags(mood);

    const songs = await this.prisma.song.findMany({
      where: moodTags.length > 0 ? {
        tags: {
          hasSome: moodTags
        }
      } : {},
      orderBy: { popularity: 'desc' },
      take: 5
    });

    return songs.map(song => ({
      song,
      score: 0.5 + (song.popularity / 100) * 0.3,
      reason: {
        strategy: 'semantic',
        mood: mood
      }
    }));
  }

  /**
   * Get default popular songs as last resort
   */
  private async getDefaultMatches(): Promise<SongMatch[]> {
    const songs = await this.prisma.song.findMany({
      orderBy: { popularity: 'desc' },
      take: 3
    });

    return songs.map(song => ({
      song,
      score: 0.3 + (song.popularity / 100) * 0.2,
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
   * Calculate word overlap between two word arrays
   */
  private calculateWordOverlap(words1: string[], words2: string[]): number {
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    return intersection.size / Math.max(set1.size, set2.size);
  }

  /**
   * Extract meaningful phrases from text
   */
  private extractPhrases(text: string): string[] {
    const words = this.cleanText(text).split(' ');
    const phrases: string[] = [];
    
    // Add individual meaningful words (3+ chars)
    phrases.push(...words.filter(word => word.length >= 3));
    
    // Add bigrams
    for (let i = 0; i < words.length - 1; i++) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
    
    return phrases;
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
   * Get tags associated with a mood
   */
  private getMoodTags(mood: string): string[] {
    const moodTagMap: Record<string, string[]> = {
      happy: ['upbeat', 'positive', 'dance', 'pop'],
      sad: ['melancholy', 'emotional', 'ballad', 'slow'],
      angry: ['aggressive', 'rock', 'metal', 'intense'],
      romantic: ['love', 'romantic', 'ballad', 'sweet'],
      chill: ['chill', 'ambient', 'relaxed', 'mellow'],
      energetic: ['energetic', 'upbeat', 'dance', 'electronic'],
      neutral: ['popular', 'mainstream']
    };
    
    return moodTagMap[mood] || moodTagMap.neutral;
  }

  /**
   * Check if a song contains explicit content
   */
  private isExplicit(song: Song): boolean {
    return song.tags.some(tag => 
      ['explicit', 'profanity', 'adult'].includes(tag.toLowerCase())
    );
  }

  /**
   * Parse embedding from PostgreSQL vector type
   */
  private parseEmbedding(embedding: any): number[] {
    // Handle different possible formats from PostgreSQL
    if (Array.isArray(embedding)) return embedding;
    if (typeof embedding === 'string') {
      // Parse vector string format "[1,2,3]" or "1,2,3"
      const cleaned = embedding.replace(/[\[\]]/g, '');
      return cleaned.split(',').map((s: string) => parseFloat(s.trim()));
    }
    throw new Error('Unknown embedding format');
  }
}