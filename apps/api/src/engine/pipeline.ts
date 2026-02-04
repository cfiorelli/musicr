/**
 * Message → Song Candidate Generation Pipeline
 * 
 * This module orchestrateexport class SongRecommendationPipeline {
  private prisma: PrismaClient;
  private keywordMatcher: KeywordMatcher;
  private semanticSearcher: SemanticSearcher;
  private moodClassifier: MoodClassifier;
  private entityExtractor: EntityExtractor;
  private reranker: SongReranker;
  private contentFilter: ContentFilter;
  private config: PipelineConfig;mplete pipeline for converting user messages
 * into ranked song candidates using multiple scoring approaches:
 * 1. Keyword/idiom matching
 * 2. Semantic KNN search
 * 3. Mood/sentiment analysis
 * 4. Named entity recognition
 * 5. Weighted reranking with repetition penalties
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/index.js';
import { KeywordMatcher } from './matchers/keyword.js';
import { SemanticSearcher } from './matchers/semantic.js';
import { MoodClassifier } from './matchers/mood.js';
import { EntityExtractor } from './matchers/entities.js';
import { SongReranker } from './rerank.js';
import { ContentFilter } from './content-filter.js';

export interface PipelineCandidate {
  songId: string;
  title: string;
  artist: string;
  scores: {
    keyword: number;
    semantic: number;
    mood: number;
    entity: number;
    popularity?: number;
    clarity?: number;
    repetition_penalty?: number;
    final?: number;
  };
  matchReasons: string[];
  tags: string[];
  decade?: number;
  year?: number;
  popularity?: number;
  sources?: string[];
}

export interface PipelineCandidate {
  songId: string;
  title: string;
  artist: string;
  scores: {
    keyword: number;
    semantic: number;
    mood: number;
    entity: number;
    popularity?: number;
    clarity?: number;
    repetition_penalty?: number;
    final?: number;
  };
  matchReasons: string[];
  tags: string[];
  decade?: number;
  year?: number;
  popularity?: number;
  sources?: string[];
}

export interface RoomConfig {
  allowExplicit?: boolean;
}

export interface PipelineConfig {
  // Configuration type that matches the existing internal structure
  [key: string]: any;
}

export class SongRecommendationPipeline {
  private prisma: PrismaClient;
  private keywordMatcher: KeywordMatcher;
  private semanticSearcher: SemanticSearcher;
  private moodClassifier: MoodClassifier;
  private entityExtractor: EntityExtractor;
  private reranker: SongReranker;
  private contentFilter: ContentFilter;
  private config: PipelineConfig;

  constructor(prisma: PrismaClient, config?: Partial<PipelineConfig>) {
    this.prisma = prisma;
    
    // Default configuration
    this.config = {
      semantic: {
        knn_size: 50,
        ...config?.semantic
      },
      keyword: {
        exact_weight: 1.0,
        lemma_weight: 0.8,
        min_phrase_length: 2,
        ...config?.keyword
      },
      mood: {
        enabled: true,
        tags: ['joy', 'anger', 'sadness', 'confidence', 'chill'],
        boost_factor: 1.2,
        ...config?.mood
      },
      entity: {
        enabled: true,
        city_boost: 1.15,
        temporal_boost: 1.1,
        weather_boost: 1.05,
        ...config?.entity
      },
      scoring: {
        semantic_weight: 0.45,
        keyword_weight: 0.30,
        popularity_weight: 0.15,
        clarity_weight: 0.10,
        repetition_penalty: 0.2,
        ...config?.scoring
      }
    };

    // Initialize pipeline components
    this.keywordMatcher = new KeywordMatcher(prisma, this.config.keyword);
    this.semanticSearcher = new SemanticSearcher(prisma, this.config.semantic);
    this.moodClassifier = new MoodClassifier(this.config.mood);
    this.entityExtractor = new EntityExtractor(this.config.entity);
    this.reranker = new SongReranker(this.config.scoring);
    
    // Initialize content filter
    this.contentFilter = new ContentFilter({
      allowExplicit: true,
      strictFiltering: false,
      logFilteredContent: false
    });
  }

  /**
   * Generate song recommendations for a message
   */
  async generateCandidates(
    message: string, 
    context?: { 
      userId?: string; 
      recentSongs?: string[]; 
      roomConfig?: RoomConfig;
    }
  ): Promise<PipelineCandidate[]> {
    const startTime = Date.now();
    const { userId, recentSongs = [], roomConfig } = context || {};
    
    logger.info({
      message: message.substring(0, 100),
      userId,
      contextKeys: Object.keys(context || {})
    }, 'Starting song candidate pipeline');

    try {
      // Step 1: Keyword/Idiom Matching
      logger.debug('Pipeline step 1: Keyword matching');
      const keywordMatches = await this.keywordMatcher.findMatches(message);
      
      // Step 2: Semantic KNN Search  
      logger.debug('Pipeline step 2: Semantic search');
      const semanticMatches = await this.semanticSearcher.findSimilar(message, this.config.semantic.knn_size);
      
      // Step 3: Mood Classification
      logger.debug('Pipeline step 3: Mood analysis');
      const messageEmotion = await this.moodClassifier.classifyMessage(message);
      
      // Step 4: Named Entity Extraction
      logger.debug('Pipeline step 4: Entity extraction');
      const entities = await this.entityExtractor.extractEntities(message);
      
      // Step 5: Combine and deduplicate candidates
      const allCandidates = await this.combineAndDeduplicate(
        keywordMatches,
        semanticMatches,
        messageEmotion,
        entities
      );
      
      // Step 6: Content Filtering (if room config requires it)
      let filteredCandidates = allCandidates;
      if (roomConfig && !roomConfig.allowExplicit) {
        logger.debug('Pipeline step 6: Content filtering');
        filteredCandidates = await this.filterExplicitContent(allCandidates, roomConfig);
      }
      
      // Step 7: Rerank with weighted scoring  
      logger.debug('Pipeline step 7: Reranking');
      const rankedCandidates = await this.reranker.rankCandidates(
        filteredCandidates,
        message,
        { userId, recentSongs }
      );
      
      const duration = Date.now() - startTime;
      logger.info({
        candidatesFound: rankedCandidates.length,
        topScore: rankedCandidates[0]?.scores.final || 0,
        duration,
        keywordMatches: keywordMatches.length,
        semanticMatches: semanticMatches.length
      }, 'Pipeline completed');
      
      return rankedCandidates;
      
    } catch (error) {
      logger.error({ error, message, userId }, 'Pipeline failed');
      throw error;
    }
  }

  /**
   * Filter explicit content based on room configuration
   */
  private async filterExplicitContent(
    candidates: PipelineCandidate[], 
    roomConfig: RoomConfig
  ): Promise<PipelineCandidate[]> {
    const startTime = Date.now();
    const filtered: PipelineCandidate[] = [];
    
    for (const candidate of candidates) {
      try {
        // Check if song content is appropriate for room
        const filterResult = await this.contentFilter.filterSong(
          candidate.songId,
          candidate.title,
          candidate.artist
        );
        
        // Apply filtering based on room config
        const shouldFilter = this.contentFilter.shouldFilterForRoom(filterResult, roomConfig);
        
        if (!shouldFilter) {
          // Song passes content filter - add to results
          filtered.push(candidate);
        } else if (filterResult.hasRadioEdit) {
          // Use radio edit version instead
          const radioEditCandidate: PipelineCandidate = {
            ...candidate,
            songId: filterResult.alternativeId || candidate.songId,
            title: filterResult.radioEditTitle || candidate.title,
            artist: filterResult.radioEditArtist || candidate.artist,
            matchReasons: [...candidate.matchReasons, 'radio edit substitution']
          };
          filtered.push(radioEditCandidate);
        }
        // Otherwise skip this candidate entirely
        
      } catch (error) {
        logger.warn({ 
          error, 
          candidateId: candidate.songId, 
          title: candidate.title 
        }, 'Content filtering failed for candidate - including anyway');
        
        // On error, include the candidate (fail-open)
        filtered.push(candidate);
      }
    }
    
    const duration = Date.now() - startTime;
    logger.debug({
      originalCount: candidates.length,
      filteredCount: filtered.length,
      removedCount: candidates.length - filtered.length,
      duration
    }, 'Content filtering completed');
    
    return filtered;
  }

  /**
   * Combine results from different matchers and remove duplicates
   */
  private async combineAndDeduplicate(
    keywordMatches: any[],
    semanticMatches: any[],
    messageEmotion: any,
    entities: any
  ): Promise<any[]> {
    const candidateMap = new Map<string, any>();
    
    // Process keyword matches
    for (const match of keywordMatches) {
      candidateMap.set(match.songId, {
        ...match,
        sources: ['keyword'],
        scores: { keyword: match.score, semantic: 0, mood: 0, entity: 0 }
      });
    }
    
    // Process semantic matches
    for (const match of semanticMatches) {
      const existing = candidateMap.get(match.songId);
      if (existing) {
        existing.sources.push('semantic');
        existing.scores.semantic = match.similarity;
      } else {
        candidateMap.set(match.songId, {
          ...match,
          sources: ['semantic'],
          scores: { keyword: 0, semantic: match.similarity, mood: 0, entity: 0 }
        });
      }
    }
    
    // Apply mood and entity boosts
    for (const candidate of candidateMap.values()) {
      // Mood boost
      candidate.scores.mood = this.calculateMoodScore(candidate, messageEmotion);
      
      // Entity boost
      candidate.scores.entity = this.calculateEntityScore(candidate, entities);
    }
    
    return Array.from(candidateMap.values());
  }

  private calculateMoodScore(candidate: any, messageEmotion: any): number {
    if (!this.config.mood.enabled || !messageEmotion) return 0;
    
    const songMoodTags = candidate.tags?.filter((tag: string) => 
      this.config.mood.tags.includes(tag.toLowerCase())
    ) || [];
    
    const moodMatch = songMoodTags.some((tag: string) => 
      tag.toLowerCase() === messageEmotion.dominant?.toLowerCase()
    );
    
    return moodMatch ? this.config.mood.boost_factor : 0;
  }

  private calculateEntityScore(candidate: any, entities: any): number {
    if (!this.config.entity.enabled || !entities) return 0;
    
    let score = 0;
    
    // City mentions
    if (entities.cities?.length > 0) {
      const cityMatch = candidate.tags?.some((tag: string) =>
        entities.cities.some((city: string) => 
          tag.toLowerCase().includes(city.toLowerCase())
        )
      );
      if (cityMatch) score += this.config.entity.city_boost;
    }
    
    // Time/day mentions
    if (entities.temporal?.length > 0) {
      const timeMatch = candidate.tags?.some((tag: string) =>
        entities.temporal.some((time: string) => 
          tag.toLowerCase().includes(time.toLowerCase())
        )
      );
      if (timeMatch) score += this.config.entity.temporal_boost;
    }
    
    // Weather mentions
    if (entities.weather?.length > 0) {
      const weatherMatch = candidate.tags?.some((tag: string) =>
        entities.weather.some((weather: string) => 
          tag.toLowerCase().includes(weather.toLowerCase())
        )
      );
      if (weatherMatch) score += this.config.entity.weather_boost;
    }
    
    return score;
  }

  /**
   * Get pipeline statistics and performance metrics
   */
  async getStats(): Promise<{
    totalSongs: number;
    avgResponseTime: number;
    componentHealth: Record<string, boolean>;
  }> {
    const totalSongs = await this.prisma.song.count();
    
    return {
      totalSongs,
      avgResponseTime: 0, // TODO: implement response time tracking
      componentHealth: {
        database: true, // TODO: implement health checks
        embeddings: await this.semanticSearcher.isHealthy(),
        keyword: this.keywordMatcher.isHealthy(),
        mood: this.moodClassifier.isHealthy(),
        entities: this.entityExtractor.isHealthy()
      }
    };
  }
}