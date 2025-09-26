/**
 * Mood/Sentiment Classifier
 * 
 * Performs lightweight sentiment/emotion analysis using VADER sentiment
 * and maps results to mood tags for song filtering and boosting.
 */

import { SentimentAnalyzer, PorterStemmer } from 'vader-sentiment';
import { logger } from '../../config/index.js';

export interface MoodAnalysis {
  dominant: string;           // Primary mood detected
  confidence: number;         // Confidence in the dominant mood (0-1)
  scores: {
    joy: number;
    anger: number;
    sadness: number;
    confidence: number;        // Different from confidence above - this is assertiveness
    chill: number;
  };
  sentimentPolarity: number;  // VADER compound score (-1 to 1)
  sentimentMagnitude: number; // How strong the sentiment is
}

export interface MoodConfig {
  enabled: boolean;
  tags: string[];
  boost_factor: number;
  sentiment_threshold?: number; // Minimum confidence to apply mood
}

export class MoodClassifier {
  private config: MoodConfig;
  private analyzer: any; // VADER doesn't have proper types

  // Keyword mappings for mood detection
  private moodKeywords = {
    joy: [
      'happy', 'excited', 'amazing', 'awesome', 'great', 'fantastic', 'wonderful',
      'love', 'enjoy', 'fun', 'celebrate', 'party', 'dance', 'laugh', 'smile',
      'upbeat', 'energetic', 'cheerful', 'positive', 'bright', 'sunny'
    ],
    anger: [
      'angry', 'mad', 'furious', 'rage', 'hate', 'annoyed', 'frustrated', 
      'irritated', 'pissed', 'livid', 'outraged', 'fierce', 'aggressive',
      'fight', 'battle', 'rebel', 'protest', 'scream', 'yell'
    ],
    sadness: [
      'sad', 'depressed', 'blue', 'down', 'melancholy', 'lonely', 'heartbroken',
      'cry', 'tears', 'grief', 'sorrow', 'mourn', 'miss', 'lost', 'empty',
      'dark', 'gloomy', 'dreary', 'hopeless', 'despair'
    ],
    confidence: [
      'confident', 'strong', 'powerful', 'bold', 'fierce', 'determined', 
      'unstoppable', 'winning', 'champion', 'boss', 'leader', 'dominate',
      'conquer', 'achieve', 'succeed', 'triumph', 'victory', 'overcome'
    ],
    chill: [
      'chill', 'relax', 'calm', 'peaceful', 'serene', 'mellow', 'smooth',
      'easy', 'laid-back', 'casual', 'cool', 'zen', 'tranquil', 'quiet',
      'soft', 'gentle', 'slow', 'lazy', 'comfortable', 'cozy'
    ]
  };

  constructor(config: MoodConfig) {
    this.config = {
      sentiment_threshold: 0.3,
      ...config
    };

    // Initialize VADER analyzer
    this.analyzer = new SentimentAnalyzer('English', PorterStemmer, 'vader');
  }

  /**
   * Classify the mood/emotion of a message
   */
  async classifyMessage(message: string): Promise<MoodAnalysis> {
    if (!this.config.enabled) {
      return this.getDefaultMoodAnalysis();
    }

    try {
      logger.debug({ message: message.substring(0, 100) }, 'Analyzing message mood');

      // Get VADER sentiment scores
      const sentimentResult = this.analyzer.getSentiment(message.toLowerCase().split(' '));
      
      // Calculate mood scores based on keyword matching
      const moodScores = this.calculateMoodScores(message);
      
      // Combine sentiment and keyword analysis
      const adjustedScores = this.adjustScoresWithSentiment(moodScores, sentimentResult);
      
      // Find dominant mood
      const dominant = this.findDominantMood(adjustedScores);
      const confidence = adjustedScores[dominant as keyof MoodAnalysis['scores']];

      const analysis: MoodAnalysis = {
        dominant,
        confidence,
        scores: adjustedScores,
        sentimentPolarity: sentimentResult.compound || 0,
        sentimentMagnitude: Math.abs(sentimentResult.compound || 0)
      };

      logger.debug({
        dominant,
        confidence,
        sentimentPolarity: analysis.sentimentPolarity,
        scores: adjustedScores
      }, 'Mood analysis completed');

      return analysis;

    } catch (error) {
      logger.warn({ error, message }, 'Mood classification failed, using default');
      return this.getDefaultMoodAnalysis();
    }
  }

  /**
   * Calculate mood scores based on keyword matching
   */
  private calculateMoodScores(message: string): MoodAnalysis['scores'] {
    const normalizedMessage = message.toLowerCase();
    const words = normalizedMessage.split(/\s+/);
    
    const scores = {
      joy: 0,
      anger: 0,
      sadness: 0,
      confidence: 0,
      chill: 0
    };

    // Count keyword matches for each mood
    for (const [mood, keywords] of Object.entries(this.moodKeywords)) {
      let moodScore = 0;
      
      for (const keyword of keywords) {
        // Check for exact word matches
        if (words.includes(keyword)) {
          moodScore += 1.0;
        }
        // Check for partial matches in the full message
        else if (normalizedMessage.includes(keyword)) {
          moodScore += 0.5;
        }
      }
      
      // Normalize by keyword count and message length
      const normalizedScore = moodScore / Math.max(keywords.length * 0.1, 1);
      scores[mood as keyof typeof scores] = Math.min(1.0, normalizedScore);
    }

    return scores;
  }

  /**
   * Adjust mood scores based on VADER sentiment analysis
   */
  private adjustScoresWithSentiment(
    moodScores: MoodAnalysis['scores'], 
    sentiment: any
  ): MoodAnalysis['scores'] {
    const adjusted = { ...moodScores };
    
    if (!sentiment) return adjusted;

    const compound = sentiment.compound || 0;
    const positive = sentiment.pos || 0;
    const negative = sentiment.neg || 0;
    const neutral = sentiment.neu || 0;

    // Boost joy for positive sentiment
    if (compound > 0.1) {
      adjusted.joy = Math.min(1.0, adjusted.joy + (positive * 0.5));
    }

    // Boost sadness for negative sentiment
    if (compound < -0.1) {
      adjusted.sadness = Math.min(1.0, adjusted.sadness + (negative * 0.5));
    }

    // Boost anger for very negative sentiment with high magnitude
    if (compound < -0.5 && negative > 0.3) {
      adjusted.anger = Math.min(1.0, adjusted.anger + (negative * 0.7));
    }

    // Boost confidence for strong positive sentiment
    if (compound > 0.5 && positive > 0.3) {
      adjusted.confidence = Math.min(1.0, adjusted.confidence + (positive * 0.3));
    }

    // Boost chill for neutral sentiment
    if (Math.abs(compound) < 0.1 && neutral > 0.6) {
      adjusted.chill = Math.min(1.0, adjusted.chill + (neutral * 0.4));
    }

    return adjusted;
  }

  /**
   * Find the mood with the highest score
   */
  private findDominantMood(scores: MoodAnalysis['scores']): string {
    let maxMood = 'chill'; // Default
    let maxScore = scores.chill;

    for (const [mood, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxMood = mood;
        maxScore = score;
      }
    }

    return maxMood;
  }

  /**
   * Get default mood analysis when classification fails or is disabled
   */
  private getDefaultMoodAnalysis(): MoodAnalysis {
    return {
      dominant: 'chill',
      confidence: 0.0,
      scores: {
        joy: 0,
        anger: 0,
        sadness: 0,
        confidence: 0,
        chill: 0
      },
      sentimentPolarity: 0,
      sentimentMagnitude: 0
    };
  }

  /**
   * Batch analyze multiple messages
   */
  async batchClassify(messages: string[]): Promise<MoodAnalysis[]> {
    const results: MoodAnalysis[] = [];
    
    for (const message of messages) {
      const analysis = await this.classifyMessage(message);
      results.push(analysis);
    }
    
    return results;
  }

  /**
   * Get mood statistics for debugging
   */
  getMoodStats(): {
    availableMoods: string[];
    keywordCounts: Record<string, number>;
    isEnabled: boolean;
  } {
    const keywordCounts: Record<string, number> = {};
    
    for (const [mood, keywords] of Object.entries(this.moodKeywords)) {
      keywordCounts[mood] = keywords.length;
    }

    return {
      availableMoods: this.config.tags,
      keywordCounts,
      isEnabled: this.config.enabled
    };
  }

  /**
   * Health check for mood classifier
   */
  isHealthy(): boolean {
    try {
      // Test basic functionality
      const testResult = this.analyzer.getSentiment(['test', 'message']);
      return !!testResult && this.config.enabled;
    } catch (error) {
      logger.warn({ error }, 'Mood classifier health check failed');
      return false;
    }
  }

  /**
   * Update mood keyword mappings (for customization)
   */
  updateKeywords(mood: string, keywords: string[]): void {
    if (mood in this.moodKeywords) {
      this.moodKeywords[mood as keyof typeof this.moodKeywords] = keywords;
      logger.info({ mood, keywordCount: keywords.length }, 'Updated mood keywords');
    }
  }
}