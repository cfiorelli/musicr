/**
 * Phrase Lexicon Service
 * 
 * Manages phrase-to-song mappings for improved song matching.
 * Provides fast lookups for common phrases and idioms.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PhraseMatch {
  phrase: string;
  songIds: string[];
  confidence: number;
  matchType: 'exact' | 'partial' | 'fuzzy';
}

export class PhraseLexiconService {
  private phraseLexicon: Record<string, string[]> = {};
  private phraseIndex: Map<string, Set<string>> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load phrase lexicon
      const lexiconPath = join(__dirname, '../../data/phrases.json');
      const lexiconData = readFileSync(lexiconPath, 'utf-8');
      this.phraseLexicon = JSON.parse(lexiconData);

      // Build search index
      this.buildPhraseIndex();
      
      this.initialized = true;
      console.log(`✅ Phrase lexicon loaded with ${Object.keys(this.phraseLexicon).length} phrases`);
    } catch (error) {
      console.error('❌ Failed to load phrase lexicon:', error);
      // Continue with empty lexicon
      this.initialized = true;
    }
  }

  private buildPhraseIndex(): void {
    for (const [phrase, songIds] of Object.entries(this.phraseLexicon)) {
      // Index by full phrase
      this.phraseIndex.set(phrase.toLowerCase(), new Set(songIds));
      
      // Index by individual words for partial matching
      const words = phrase.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 2) { // Skip short words
          if (!this.phraseIndex.has(word)) {
            this.phraseIndex.set(word, new Set());
          }
          for (const songId of songIds) {
            this.phraseIndex.get(word)!.add(songId);
          }
        }
      }
    }
  }

  /**
   * Find song matches based on phrases in the input text
   */
  findPhraseMatches(text: string): PhraseMatch[] {
    if (!this.initialized) {
      throw new Error('Phrase lexicon not initialized');
    }

    const normalizedText = text.toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const matches: PhraseMatch[] = [];
    
    // 1. Exact phrase matching
    for (const [phrase, songIds] of Object.entries(this.phraseLexicon)) {
      if (normalizedText.includes(phrase.toLowerCase())) {
        matches.push({
          phrase,
          songIds: [...songIds],
          confidence: 1.0,
          matchType: 'exact'
        });
      }
    }

    // 2. Partial phrase matching (if no exact matches)
    if (matches.length === 0) {
      const words = normalizedText.split(/\s+/).filter(w => w.length > 2);
      const songIdCounts: Record<string, number> = {};
      const matchedPhrases: Record<string, string[]> = {};

      for (const word of words) {
        const songIds = this.phraseIndex.get(word);
        if (songIds) {
          for (const songId of songIds) {
            songIdCounts[songId] = (songIdCounts[songId] || 0) + 1;
            if (!matchedPhrases[songId]) {
              matchedPhrases[songId] = [];
            }
            // Find which phrases contain this word
            for (const [phrase, ids] of Object.entries(this.phraseLexicon)) {
              if (ids.includes(songId) && phrase.toLowerCase().includes(word)) {
                if (!matchedPhrases[songId].includes(phrase)) {
                  matchedPhrases[songId].push(phrase);
                }
              }
            }
          }
        }
      }

      // Convert to matches with confidence based on word overlap
      const sortedMatches = Object.entries(songIdCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5); // Top 5 matches

      for (const [songId, wordCount] of sortedMatches) {
        const confidence = Math.min(wordCount / words.length, 0.8); // Max 0.8 for partial
        if (confidence > 0.2) { // Only include reasonable matches
          matches.push({
            phrase: matchedPhrases[songId].join(', '),
            songIds: [songId],
            confidence,
            matchType: 'partial'
          });
        }
      }
    }

    // 3. Fuzzy matching for typos and variations
    if (matches.length === 0) {
      const fuzzyMatches = this.fuzzyPhraseMatch(normalizedText);
      matches.push(...fuzzyMatches);
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  private fuzzyPhraseMatch(text: string): PhraseMatch[] {
    const matches: PhraseMatch[] = [];
    const words = text.split(/\s+/);
    
    // Simple fuzzy matching using Levenshtein-like similarity
    for (const [phrase, songIds] of Object.entries(this.phraseLexicon)) {
      const phraseWords = phrase.toLowerCase().split(/\s+/);
      
      // Check if significant portion of phrase words appear in text
      let matchCount = 0;
      for (const phraseWord of phraseWords) {
        for (const textWord of words) {
          if (this.isWordSimilar(phraseWord, textWord)) {
            matchCount++;
            break;
          }
        }
      }
      
      const similarity = matchCount / phraseWords.length;
      if (similarity >= 0.6 && matchCount >= 2) { // Require at least 60% match and 2+ words
        matches.push({
          phrase,
          songIds: [...songIds],
          confidence: similarity * 0.6, // Max 0.6 for fuzzy
          matchType: 'fuzzy'
        });
      }
    }
    
    return matches.slice(0, 3); // Top 3 fuzzy matches
  }

  private isWordSimilar(word1: string, word2: string, threshold = 0.8): boolean {
    if (word1 === word2) return true;
    if (word1.length < 3 || word2.length < 3) return false;
    
    // Simple similarity check
    if (word1.includes(word2) || word2.includes(word1)) return true;
    
    // Levenshtein distance for short words
    if (word1.length <= 6 && word2.length <= 6) {
      const distance = this.levenshteinDistance(word1, word2);
      const maxLen = Math.max(word1.length, word2.length);
      return (1 - distance / maxLen) >= threshold;
    }
    
    return false;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // insertion
          matrix[j - 1][i] + 1,     // deletion
          matrix[j - 1][i - 1] + cost // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Get all phrases that contain a specific word
   */
  getPhrasesForWord(word: string): string[] {
    const normalizedWord = word.toLowerCase();
    const phrases: string[] = [];
    
    for (const phrase of Object.keys(this.phraseLexicon)) {
      if (phrase.toLowerCase().includes(normalizedWord)) {
        phrases.push(phrase);
      }
    }
    
    return phrases;
  }

  /**
   * Get statistics about the phrase lexicon
   */
  getStats() {
    return {
      totalPhrases: Object.keys(this.phraseLexicon).length,
      totalSongMappings: Object.values(this.phraseLexicon).reduce((sum, songs) => sum + songs.length, 0),
      averageSongsPerPhrase: Object.values(this.phraseLexicon).reduce((sum, songs) => sum + songs.length, 0) / Object.keys(this.phraseLexicon).length,
      indexedWords: this.phraseIndex.size
    };
  }

  /**
   * Add a new phrase mapping
   */
  addPhrase(phrase: string, songIds: string[]): void {
    const normalizedPhrase = phrase.toLowerCase().trim();
    
    if (!this.phraseLexicon[normalizedPhrase]) {
      this.phraseLexicon[normalizedPhrase] = [];
    }
    
    // Add unique song IDs
    for (const songId of songIds) {
      if (!this.phraseLexicon[normalizedPhrase].includes(songId)) {
        this.phraseLexicon[normalizedPhrase].push(songId);
      }
    }
    
    // Update index
    this.phraseIndex.set(normalizedPhrase, new Set(this.phraseLexicon[normalizedPhrase]));
    
    // Index individual words
    const words = normalizedPhrase.split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        if (!this.phraseIndex.has(word)) {
          this.phraseIndex.set(word, new Set());
        }
        for (const songId of songIds) {
          this.phraseIndex.get(word)!.add(songId);
        }
      }
    }
  }
}

// Singleton instance
export const phraseLexicon = new PhraseLexiconService();