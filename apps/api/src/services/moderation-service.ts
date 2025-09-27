/**
 * Moderation Service
 * 
 * Lightweight content moderation to filter inappropriate content
 * before it reaches the song matching pipeline.
 */

import { logger } from '../config/index.js';

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  category?: 'harassment' | 'nsfw' | 'slur' | 'spam' | 'clean';
  confidence: number;
  replacementText?: string;
}

export interface ModerationConfig {
  strictMode: boolean;
  allowNSFW: boolean;
  logViolations: boolean;
}

export class ModerationService {
  private slurs: Set<string> = new Set();
  private harassmentKeywords: Set<string> = new Set();
  private nsfwKeywords: Set<string> = new Set();
  private neutralMappings: string[];

  constructor() {
    this.initializeBlocklists();
    this.neutralMappings = [
      'Bad',
      'Smooth Criminal', 
      'Beat It',
      'The Way You Make Me Feel',
      'Rock With You'
    ];
  }

  /**
   * Initialize content blocklists
   */
  private initializeBlocklists(): void {
    // Common slurs and offensive terms (abbreviated list for safety)
    this.slurs = new Set([
      // Racial slurs (censored/abbreviated)
      'n***er', 'n***a', 'f****t', 'r****d',
      // Common offensive terms
      'nazi', 'hitler', 'genocide', 'kys', 'kill yourself',
      // Hate speech indicators
      'white power', 'heil', '14/88', '1488'
    ]);

    // Harassment and bullying keywords
    this.harassmentKeywords = new Set([
      'kill yourself', 'kys', 'die', 'suicide', 'harm yourself',
      'worthless', 'pathetic', 'loser', 'stupid idiot',
      'hate you', 'wish you were dead', 'go die',
      'end your life', 'nobody likes you'
    ]);

    // NSFW/sexual content keywords
    this.nsfwKeywords = new Set([
      'porn', 'sex', 'xxx', 'nude', 'naked', 'dick', 'penis',
      'vagina', 'pussy', 'cock', 'fuck', 'fucking', 'orgasm',
      'masturbate', 'horny', 'sexy', 'sexy time', 'blow job', 'blowjob'
    ]);
  }

  /**
   * Moderate text content before song matching
   */
  async moderateContent(
    text: string, 
    config: ModerationConfig = { 
      strictMode: false, 
      allowNSFW: false, 
      logViolations: true 
    }
  ): Promise<ModerationResult> {
    const normalizedText = text.toLowerCase().trim();
    
    // Check for slurs (always blocked)
    const slurResult = this.checkForSlurs(normalizedText);
    if (!slurResult.allowed) {
      if (config.logViolations) {
        logger.warn({
          originalText: text,
          reason: slurResult.reason,
          category: slurResult.category
        }, 'Content blocked: slur detected');
      }
      return slurResult;
    }

    // Check for harassment
    const harassmentResult = this.checkForHarassment(normalizedText);
    if (!harassmentResult.allowed) {
      if (config.logViolations) {
        logger.warn({
          originalText: text,
          reason: harassmentResult.reason,
          category: harassmentResult.category
        }, 'Content blocked: harassment detected');
      }
      
      // Return neutral mapping for harassment
      return {
        ...harassmentResult,
        replacementText: this.getNeutralMapping()
      };
    }

    // Check for NSFW content
    if (!config.allowNSFW) {
      const nsfwResult = this.checkForNSFW(normalizedText);
      if (!nsfwResult.allowed) {
        if (config.logViolations) {
          logger.info({
            originalText: text,
            reason: nsfwResult.reason,
            category: nsfwResult.category
          }, 'Content filtered: NSFW detected');
        }
        
        // Return neutral mapping for NSFW
        return {
          ...nsfwResult,
          replacementText: this.getNeutralMapping()
        };
      }
    }

    // Check for spam patterns
    const spamResult = this.checkForSpam(text);
    if (!spamResult.allowed && config.strictMode) {
      if (config.logViolations) {
        logger.info({
          originalText: text,
          reason: spamResult.reason,
          category: spamResult.category
        }, 'Content filtered: spam detected');
      }
      return spamResult;
    }

    // Content is clean
    return {
      allowed: true,
      category: 'clean',
      confidence: 0.95
    };
  }

  /**
   * Check for slurs and hate speech
   */
  private checkForSlurs(text: string): ModerationResult {
    const words = text.split(/\s+/);
    
    for (const word of words) {
      // Direct match
      if (this.slurs.has(word)) {
        return {
          allowed: false,
          reason: 'Contains prohibited slur',
          category: 'slur',
          confidence: 1.0
        };
      }
      
      // Check for common evasion patterns
      const cleanWord = word.replace(/[^a-z]/g, ''); // Remove numbers/symbols
      if (cleanWord.length > 3) {
        for (const slur of this.slurs) {
          const cleanSlur = slur.replace(/[^a-z]/g, '');
          if (cleanWord.includes(cleanSlur) && cleanSlur.length > 3) {
            return {
              allowed: false,
              reason: 'Contains prohibited slur (evasion detected)',
              category: 'slur',
              confidence: 0.9
            };
          }
        }
      }
    }

    return { allowed: true, category: 'clean', confidence: 0.95 };
  }

  /**
   * Check for harassment and bullying
   */
  private checkForHarassment(text: string): ModerationResult {
    for (const keyword of this.harassmentKeywords) {
      if (text.includes(keyword)) {
        return {
          allowed: false,
          reason: 'Contains harassment content',
          category: 'harassment',
          confidence: 0.85
        };
      }
    }

    // Check for patterns like repeated characters (aggressive typing)
    if (/(.)\1{4,}/.test(text) && text.length > 20) {
      return {
        allowed: false,
        reason: 'Aggressive typing pattern detected',
        category: 'harassment',
        confidence: 0.6
      };
    }

    return { allowed: true, category: 'clean', confidence: 0.95 };
  }

  /**
   * Check for NSFW content
   */
  private checkForNSFW(text: string): ModerationResult {
    for (const keyword of this.nsfwKeywords) {
      if (text.includes(keyword)) {
        return {
          allowed: false,
          reason: 'Contains NSFW content',
          category: 'nsfw',
          confidence: 0.8
        };
      }
    }

    return { allowed: true, category: 'clean', confidence: 0.95 };
  }

  /**
   * Check for spam patterns
   */
  private checkForSpam(text: string): ModerationResult {
    // Check for excessive repetition
    const words = text.split(/\s+/);
    const wordCounts = new Map<string, number>();
    
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // If any word appears more than 5 times
    for (const [word, count] of wordCounts) {
      if (count > 5 && word.length > 2) {
        return {
          allowed: false,
          reason: 'Excessive repetition detected',
          category: 'spam',
          confidence: 0.7
        };
      }
    }

    // Check for excessive length
    if (text.length > 1000) {
      return {
        allowed: false,
        reason: 'Message too long',
        category: 'spam',
        confidence: 0.9
      };
    }

    return { allowed: true, category: 'clean', confidence: 0.95 };
  }

  /**
   * Get a neutral song mapping for blocked content
   */
  private getNeutralMapping(): string {
    const randomIndex = Math.floor(Math.random() * this.neutralMappings.length);
    return this.neutralMappings[randomIndex];
  }

  /**
   * Get policy-compliant decline message
   */
  getPolicyDeclineMessage(category: string): string {
    switch (category) {
      case 'slur':
        return 'Message contains inappropriate language and cannot be processed.';
      case 'harassment':
        return 'Content appears to contain harmful language. Please try a different message.';
      case 'nsfw':
        return 'This room has family-friendly settings enabled. Please try a different message.';
      case 'spam':
        return 'Message appears to be spam. Please try a simpler query.';
      default:
        return 'Unable to process this message. Please try something else.';
    }
  }

  /**
   * Update blocklists (for future admin functionality)
   */
  addToBlocklist(term: string, category: 'slur' | 'harassment' | 'nsfw'): void {
    const normalizedTerm = term.toLowerCase();
    
    switch (category) {
      case 'slur':
        this.slurs.add(normalizedTerm);
        break;
      case 'harassment':
        this.harassmentKeywords.add(normalizedTerm);
        break;
      case 'nsfw':
        this.nsfwKeywords.add(normalizedTerm);
        break;
    }

    logger.info({ term: normalizedTerm, category }, 'Added term to moderation blocklist');
  }
}

// Singleton instance
export const moderationService = new ModerationService();