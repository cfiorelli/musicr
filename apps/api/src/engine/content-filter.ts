/**
 * Content Filter
 * 
 * Handles profanity detection, explicit content filtering, and radio edit mapping
 * for family-friendly room support and clarity prior adjustments.
 */

import { logger } from '../config/index.js';

export interface ContentFilterConfig {
  allowExplicit: boolean;
  familyFriendlyMode: boolean;
  strictFiltering: boolean;
  logFilteredContent: boolean;
}

export interface FilterResult {
  isExplicit: boolean;
  hasRadioEdit: boolean;
  radioEditTitle?: string;
  radioEditArtist?: string;
  alternativeId?: string;
  severity: 'clean' | 'mild' | 'moderate' | 'explicit';
  reasons: string[];
}

export interface ClarityAssessment {
  isExactPhrase: boolean;
  isCommonIdiom: boolean;
  isMetaphorical: boolean;
  isObscure: boolean;
  clarityBonus: number; // +0.2, 0, or -0.2
  reasons: string[];
}

export class ContentFilter {
  private config: ContentFilterConfig;
  
  // Explicit words/phrases (mild to severe)
  private readonly explicitWords = new Set([
    // Mild profanity
    'damn', 'hell', 'crap', 'ass', 'bitch', 'bastard',
    // Moderate profanity  
    'shit', 'piss', 'cock', 'dick', 'pussy', 'whore', 'slut',
    // Strong profanity
    'fuck', 'fucking', 'fucked', 'motherfucker', 'cunt', 'nigga', 'nigger'
  ]);

  // Sexual/suggestive content
  private readonly sexualContent = new Set([
    'sex', 'sexy', 'horny', 'naked', 'strip', 'porn', 'orgasm',
    'masturbate', 'erotic', 'climax', 'penetrate', 'thrust',
    'blow job', 'oral sex', 'threesome', 'bondage', 'kinky'
  ]);

  // Drug/substance references
  private readonly drugReferences = new Set([
    'cocaine', 'heroin', 'meth', 'crack', 'weed', 'marijuana',
    'cannabis', 'molly', 'ecstasy', 'acid', 'lsd', 'shrooms',
    'xanax', 'adderall', 'oxy', 'opioid', 'fentanyl'
  ]);

  // Violence/hate content
  private readonly violentContent = new Set([
    'kill', 'murder', 'suicide', 'rape', 'abuse', 'torture',
    'genocide', 'terrorist', 'bomb', 'gun', 'weapon', 'violence'
  ]);

  // Common idioms and phrases that boost clarity
  private readonly commonIdioms = new Set([
    // Love/relationship
    'break my heart', 'falling in love', 'love me tender', 'crazy in love',
    'head over heels', 'match made in heaven', 'better half', 'soulmate',
    
    // Life/general
    'live your life', 'follow your dreams', 'time heals', 'new beginning',
    'turn the page', 'start over', 'moving on', 'let it go', 'hold on',
    
    // Party/celebration
    'party all night', 'dance floor', 'good times', 'celebrate tonight',
    'turn up', 'let loose', 'have a ball', 'living it up',
    
    // Emotions
    'feeling blue', 'on cloud nine', 'walking on air', 'down in the dumps',
    'over the moon', 'through the roof', 'hit rock bottom', 'on top of the world',
    
    // Time/seasons
    'summertime', 'winter wonderland', 'spring fever', 'autumn leaves',
    'monday morning', 'friday night', 'weekend warrior', 'late night',
    
    // Music/dance
    'turn it up', 'pump up the volume', 'drop the beat', 'feel the rhythm',
    'sing along', 'dance all night', 'music to my ears', 'sound of music'
  ]);

  // Metaphorical/abstract concepts that reduce clarity  
  private readonly metaphoricalConcepts = new Set([
    // Abstract emotions
    'shadows of tomorrow', 'echoes of yesterday', 'whispers in the wind',
    'fragments of time', 'rivers of memory', 'valleys of sorrow',
    
    // Poetic imagery
    'crimson sky', 'silver moonlight', 'golden dawn', 'velvet night',
    'crystal tears', 'paper hearts', 'plastic dreams', 'neon lights',
    
    // Philosophical concepts
    'meaning of life', 'purpose of existence', 'soul searching', 'inner peace',
    'spiritual journey', 'cosmic connection', 'universal truth', 'eternal love',
    
    // Abstract places/states
    'nowhere land', 'wonderland', 'paradise lost', 'seventh heaven',
    'twilight zone', 'no mans land', 'promised land', 'never never land'
  ]);

  // Known radio edit mappings (explicit -> clean version)
  private readonly radioEditMappings = new Map([
    // Hip-hop/Rap
    ['fuck', 'f***'],
    ['fucking', 'f***ing'], 
    ['motherfucker', 'mother***er'],
    ['shit', 's***'],
    ['bitch', 'b****'],
    ['nigga', 'n***a'],
    ['ass', 'a**'],
    
    // Common explicit phrases
    ['what the fuck', 'what the heck'],
    ['holy shit', 'holy crap'],
    ['son of a bitch', 'son of a gun'],
    ['damn it', 'darn it'],
    ['piss off', 'buzz off']
  ]);

  constructor(config: ContentFilterConfig) {
    this.config = config;
  }

  /**
   * Filter song candidates based on content policy
   */
  async filterSong(
    songId: string,
    title: string,
    artist: string,
    lyrics?: string
  ): Promise<FilterResult> {
    const startTime = Date.now();
    
    try {
      const titleAnalysis = this.analyzeText(title);
      const artistAnalysis = this.analyzeText(artist);
      const lyricsAnalysis = lyrics ? this.analyzeText(lyrics) : null;

      // Determine overall explicitness
      const maxSeverity = this.getMaxSeverity([
        titleAnalysis.severity,
        artistAnalysis.severity,
        lyricsAnalysis?.severity || 'clean'
      ]);

      const isExplicit = maxSeverity === 'explicit' || maxSeverity === 'moderate';
      const reasons = [
        ...titleAnalysis.reasons,
        ...artistAnalysis.reasons,
        ...(lyricsAnalysis?.reasons || [])
      ];

      // Check for radio edit availability
      const { hasRadioEdit, radioEditTitle, radioEditArtist, alternativeId } = 
        await this.findRadioEdit(songId, title, artist);

      const result: FilterResult = {
        isExplicit,
        hasRadioEdit,
        radioEditTitle,
        radioEditArtist,
        alternativeId,
        severity: maxSeverity,
        reasons: [...new Set(reasons)] // Deduplicate
      };

      const duration = Date.now() - startTime;
      
      if (this.config.logFilteredContent && isExplicit) {
        logger.debug({
          songId,
          title,
          artist,
          result,
          duration
        }, 'Content filter applied');
      }

      return result;

    } catch (error) {
      logger.error({ error, songId, title, artist }, 'Content filtering failed');
      
      // Safe fallback - treat as clean
      return {
        isExplicit: false,
        hasRadioEdit: false,
        severity: 'clean',
        reasons: ['Error during analysis']
      };
    }
  }

  /**
   * Assess clarity prior for keyword matching
   */
  assessClarity(message: string, songTitle: string): ClarityAssessment {
    const normalizedMessage = message.toLowerCase().trim();
    const normalizedTitle = songTitle.toLowerCase().trim();
    
    // Check for exact phrase matches
    const isExactPhrase = normalizedMessage.includes(normalizedTitle) || 
                         normalizedTitle.includes(normalizedMessage);
    
    // Check for common idioms
    const isCommonIdiom = this.containsIdiom(normalizedTitle) || 
                         this.containsIdiom(normalizedMessage);
    
    // Check for metaphorical content
    const isMetaphorical = this.containsMetaphor(normalizedTitle);
    
    // Check for obscurity (very long titles, unusual word combinations)
    const isObscure = this.isObscureTitle(normalizedTitle);
    
    let clarityBonus = 0;
    const reasons: string[] = [];
    
    // Apply clarity prior rules
    if (isExactPhrase || isCommonIdiom) {
      clarityBonus = 0.2;
      reasons.push(isExactPhrase ? 'exact phrase match' : 'common idiom');
    } else if (isMetaphorical || isObscure) {
      clarityBonus = -0.2;
      reasons.push(isMetaphorical ? 'metaphorical title' : 'obscure title');
    }
    
    return {
      isExactPhrase,
      isCommonIdiom,
      isMetaphorical,
      isObscure,
      clarityBonus,
      reasons
    };
  }

  /**
   * Check if content should be filtered for a specific room
   */
  shouldFilterForRoom(result: FilterResult, roomConfig?: { allowExplicit?: boolean }): boolean {
    const allowExplicit = roomConfig?.allowExplicit ?? this.config.allowExplicit;
    
    if (!allowExplicit) {
      // In family-friendly mode, filter moderate and explicit content
      return result.severity === 'moderate' || result.severity === 'explicit';
    }
    
    // Only filter truly explicit content when explicit is allowed
    return result.severity === 'explicit' && this.config.strictFiltering;
  }

  /**
   * Analyze text for explicit content
   */
  private analyzeText(text: string): {
    severity: 'clean' | 'mild' | 'moderate' | 'explicit';
    reasons: string[];
  } {
    const normalized = text.toLowerCase();
    const words = normalized.split(/\s+/);
    const reasons: string[] = [];
    
    let maxSeverity: 'clean' | 'mild' | 'moderate' | 'explicit' = 'clean';
    
    // Check explicit words
    for (const word of words) {
      if (this.explicitWords.has(word)) {
        const severity = this.getWordSeverity(word);
        if (this.isSeverityHigher(severity, maxSeverity)) {
          maxSeverity = severity;
        }
        reasons.push(`explicit language: ${word}`);
      }
    }
    
    // Check sexual content
    for (const phrase of this.sexualContent) {
      if (normalized.includes(phrase)) {
        if (this.isSeverityHigher('moderate', maxSeverity)) {
          maxSeverity = 'moderate';
        }
        reasons.push(`sexual content: ${phrase}`);
      }
    }
    
    // Check drug references
    for (const drug of this.drugReferences) {
      if (normalized.includes(drug)) {
        if (this.isSeverityHigher('moderate', maxSeverity)) {
          maxSeverity = 'moderate';
        }
        reasons.push(`drug reference: ${drug}`);
      }
    }
    
    // Check violent content
    for (const violent of this.violentContent) {
      if (normalized.includes(violent)) {
        if (this.isSeverityHigher('moderate', maxSeverity)) {
          maxSeverity = 'moderate';
        }
        reasons.push(`violent content: ${violent}`);
      }
    }
    
    return { severity: maxSeverity, reasons };
  }

  /**
   * Get severity level for specific word
   */
  private getWordSeverity(word: string): 'mild' | 'moderate' | 'explicit' {
    const mild = ['damn', 'hell', 'crap', 'ass'];
    const moderate = ['shit', 'bitch', 'bastard', 'piss'];
    const explicit = ['fuck', 'fucking', 'fucked', 'motherfucker', 'cunt', 'nigga', 'nigger'];
    
    if (explicit.includes(word)) return 'explicit';
    if (moderate.includes(word)) return 'moderate';
    if (mild.includes(word)) return 'mild';
    
    return 'mild';
  }

  /**
   * Check if one severity is higher than another
   */
  private isSeverityHigher(
    severity1: 'clean' | 'mild' | 'moderate' | 'explicit',
    severity2: 'clean' | 'mild' | 'moderate' | 'explicit'
  ): boolean {
    const levels = { clean: 0, mild: 1, moderate: 2, explicit: 3 };
    return levels[severity1] > levels[severity2];
  }

  /**
   * Get the maximum severity from a list
   */
  private getMaxSeverity(severities: ('clean' | 'mild' | 'moderate' | 'explicit')[]): 'clean' | 'mild' | 'moderate' | 'explicit' {
    const levels = { clean: 0, mild: 1, moderate: 2, explicit: 3 };
    let maxLevel = 0;
    let maxSeverity: 'clean' | 'mild' | 'moderate' | 'explicit' = 'clean';
    
    for (const severity of severities) {
      if (levels[severity] > maxLevel) {
        maxLevel = levels[severity];
        maxSeverity = severity;
      }
    }
    
    return maxSeverity;
  }

  /**
   * Find radio edit version of a song
   */
  private async findRadioEdit(
    songId: string,
    title: string,
    artist: string
  ): Promise<{
    hasRadioEdit: boolean;
    radioEditTitle?: string;
    radioEditArtist?: string;
    alternativeId?: string;
  }> {
    // Apply known radio edit mappings
    let cleanTitle = title;
    let hasEdit = false;
    
    for (const [explicit, clean] of this.radioEditMappings) {
      if (title.toLowerCase().includes(explicit)) {
        cleanTitle = title.replace(new RegExp(explicit, 'gi'), clean);
        hasEdit = true;
      }
    }
    
    return {
      hasRadioEdit: hasEdit,
      radioEditTitle: hasEdit ? cleanTitle : undefined,
      radioEditArtist: artist,
      alternativeId: hasEdit ? `${songId}_radio_edit` : undefined
    };
  }

  /**
   * Check if text contains common idioms
   */
  private containsIdiom(text: string): boolean {
    const normalized = text.toLowerCase();
    return Array.from(this.commonIdioms).some(idiom => 
      normalized.includes(idiom.toLowerCase())
    );
  }

  /**
   * Check if text contains metaphorical concepts
   */
  private containsMetaphor(text: string): boolean {
    const normalized = text.toLowerCase();
    return Array.from(this.metaphoricalConcepts).some(concept => 
      normalized.includes(concept.toLowerCase())
    );
  }

  /**
   * Check if title is obscure (very long, unusual combinations)
   */
  private isObscureTitle(title: string): boolean {
    // Very long titles (>100 chars) are considered obscure
    if (title.length > 100) return true;
    
    // Titles with many parentheses, brackets, or special chars
    const specialCharCount = (title.match(/[()[\]{}<>|@#$%^&*+=]/g) || []).length;
    if (specialCharCount > 3) return true;
    
    // Titles with very long words (>15 chars) might be obscure
    const words = title.split(/\s+/);
    if (words.some(word => word.length > 15)) return true;
    
    return false;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ContentFilterConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info({ config: this.config }, 'Content filter configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): ContentFilterConfig {
    return { ...this.config };
  }
}