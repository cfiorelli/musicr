/**
 * Song Reranker
 * 
 * Implements the weighted scoring formula:
 * score = 0.45*semantic + 0.30*keyword + 0.15*popularity + 0.10*clarity - repetition_penalty
 * 
 * Handles repetition penalties based on decade similarity and recent user selections.
 */

import { logger } from '../config/index.js';

export interface ScoringWeights {
  semantic_weight: number;     // 0.45
  keyword_weight: number;      // 0.30  
  popularity_weight: number;   // 0.15
  clarity_weight: number;      // 0.10
  repetition_penalty: number;  // Base penalty multiplier
}

export interface RankingCandidate {
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
  year?: number;
  decade?: number;
  popularity?: number;
  sources?: string[];
}

export interface RankingContext {
  recentSongs?: string[];     // Recently played song IDs
  userPreferences?: string[]; // User's preferred genres/tags  
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  avoidDecades?: number[];    // Decades to penalize
  userId?: string;
}

export class SongReranker {
  private weights: ScoringWeights;

  constructor(weights: ScoringWeights) {
    this.weights = weights;
  }

  /**
   * Rank candidates using the weighted scoring formula
   */
  async rankCandidates(
    candidates: RankingCandidate[],
    _message: string,
    context?: RankingContext
  ): Promise<RankingCandidate[]> {
    if (candidates.length === 0) {
      return [];
    }

    const startTime = Date.now();
    
    logger.debug({
      candidateCount: candidates.length,
      hasContext: !!context,
      recentSongs: context?.recentSongs?.length || 0
    }, 'Starting candidate reranking');

    try {
      // Calculate final scores for each candidate
      const scoredCandidates = this.calculateFinalScores(candidates, context);
      
      // Sort by final score (descending)
      const rankedCandidates = scoredCandidates
        .sort((a, b) => (b.scores.final || 0) - (a.scores.final || 0))
        .slice(0, 20); // Return top 20 candidates

      const duration = Date.now() - startTime;
      
      logger.debug({
        rankedCount: rankedCandidates.length,
        topScore: rankedCandidates[0]?.scores.final || 0,
        scoreBreakdown: rankedCandidates[0] ? this.getScoreBreakdown(rankedCandidates[0]) : {},
        duration
      }, 'Candidate reranking completed');

      return rankedCandidates;

    } catch (error) {
      logger.error({ error, candidateCount: candidates.length }, 'Reranking failed');
      // Return original candidates as fallback
      return candidates;
    }
  }

  /**
   * Calculate final weighted scores for all candidates
   */
  private calculateFinalScores(
    candidates: RankingCandidate[],
    context?: RankingContext
  ): RankingCandidate[] {
    
    return candidates.map(candidate => {
      // Normalize individual scores to 0-1 range
      const normalizedScores = this.normalizeScores(candidate);
      
      // Calculate repetition penalty
      const repetitionPenalty = this.calculateRepetitionPenalty(candidate, context);
      
      // Apply weighted formula
      const finalScore = (
        normalizedScores.semantic * this.weights.semantic_weight +
        normalizedScores.keyword * this.weights.keyword_weight +
        normalizedScores.popularity * this.weights.popularity_weight +
        normalizedScores.clarity * this.weights.clarity_weight -
        repetitionPenalty
      );

      // Ensure score is between 0 and 1
      const clampedScore = Math.max(0, Math.min(1, finalScore));

      return {
        ...candidate,
        scores: {
          ...candidate.scores,
          popularity: normalizedScores.popularity,
          clarity: normalizedScores.clarity,
          repetition_penalty: repetitionPenalty,
          final: clampedScore
        }
      };
    });
  }

  /**
   * Normalize individual scores to 0-1 range
   */
  private normalizeScores(candidate: RankingCandidate): {
    semantic: number;
    keyword: number;
    popularity: number;
    clarity: number;
  } {
    return {
      semantic: Math.max(0, Math.min(1, candidate.scores.semantic || 0)),
      keyword: Math.max(0, Math.min(1, candidate.scores.keyword || 0)),
      popularity: Math.max(0, Math.min(1, (candidate.popularity || 0) / 100)), // Normalize popularity
      clarity: Math.max(0, Math.min(1, candidate.scores.clarity || 0.5))
    };
  }

  /**
   * Calculate repetition penalty for a candidate
   */
  private calculateRepetitionPenalty(
    candidate: RankingCandidate,
    context?: RankingContext
  ): number {
    let penalty = 0;

    if (!context) return penalty;

    // Direct song repetition penalty
    if (context.recentSongs && context.recentSongs.includes(candidate.songId)) {
      penalty += this.weights.repetition_penalty * 0.8; // Heavy penalty for exact repeats
    }

    // Avoid specific decades if requested
    if (context.avoidDecades && candidate.decade && context.avoidDecades.includes(candidate.decade)) {
      penalty += this.weights.repetition_penalty * 0.2;
    }

    return penalty;
  }

  /**
   * Get detailed score breakdown for debugging
   */
  private getScoreBreakdown(candidate: RankingCandidate): Record<string, number> {
    const normalized = this.normalizeScores(candidate);
    
    return {
      semantic_contribution: normalized.semantic * this.weights.semantic_weight,
      keyword_contribution: normalized.keyword * this.weights.keyword_weight,
      popularity_contribution: normalized.popularity * this.weights.popularity_weight,
      clarity_contribution: normalized.clarity * this.weights.clarity_weight,
      repetition_penalty: candidate.scores.repetition_penalty || 0,
      final_score: candidate.scores.final || 0
    };
  }

  /**
   * Update scoring weights
   */
  updateWeights(newWeights: Partial<ScoringWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
    logger.info({ weights: this.weights }, 'Updated scoring weights');
  }

  /**
   * Get current scoring weights
   */
  getWeights(): ScoringWeights {
    return { ...this.weights };
  }
}