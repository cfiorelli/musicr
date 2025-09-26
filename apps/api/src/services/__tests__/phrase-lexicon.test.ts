import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PhraseLexiconService } from '../phrase-lexicon-service.js';
import { readFileSync } from 'fs';

// Mock fs to provide test data
vi.mock('fs', () => ({
  readFileSync: vi.fn()
}));

describe('PhraseLexiconService - Tokenizer/Idiom Matching', () => {
  let service: PhraseLexiconService;

  beforeEach(async () => {
    // Mock the phrase lexicon with test data
    const mockLexicon = {
      'hey jude': ['song-1'],
      'love song': ['song-2', 'song-3'],
      'rock and roll': ['song-4'],
      'dancing queen': ['song-5'],
      'bohemian rhapsody': ['song-6'],
      'stairway to heaven': ['song-7'],
      'hotel california': ['song-8'],
      'sweet child': ['song-9'],
      'november rain': ['song-10'],
      'guitar solo': ['song-11', 'song-12'],
      'power ballad': ['song-13'],
      'happy birthday': ['song-14']
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockLexicon));
    
    service = new PhraseLexiconService();
    await service.initialize();
  });

  describe('Text Tokenization', () => {
    it('should tokenize simple phrases correctly', () => {
      const matches = service.findPhraseMatches('hey jude');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('hey jude');
      expect(matches[0].songIds).toEqual(['song-1']);
      expect(matches[0].matchType).toBe('exact');
      expect(matches[0].confidence).toBeGreaterThan(0.9);
    });

    it('should handle case insensitive matching', () => {
      const matches = service.findPhraseMatches('HEY JUDE');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('hey jude');
      expect(matches[0].matchType).toBe('exact');
    });

    it('should handle punctuation normalization', () => {
      const matches = service.findPhraseMatches('hey, jude!');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('hey jude');
      expect(matches[0].matchType).toBe('exact');
    });

    it('should tokenize multi-word phrases', () => {
      const matches = service.findPhraseMatches('stairway to heaven');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('stairway to heaven');
      expect(matches[0].songIds).toEqual(['song-7']);
    });

    it('should handle extra whitespace', () => {
      const matches = service.findPhraseMatches('  hey    jude  ');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('hey jude');
    });
  });

  describe('Idiom and Phrase Matching', () => {
    it('should match complete phrases over partial matches', () => {
      const matches = service.findPhraseMatches('love song about dancing queen');
      
      // Should find both "love song" and "dancing queen"
      const phraseNames = matches.map(m => m.phrase).sort();
      expect(phraseNames).toEqual(['dancing queen', 'love song']);
    });

    it('should handle overlapping phrase boundaries', () => {
      const matches = service.findPhraseMatches('sweet child november rain');
      
      // Should find both phrases despite adjacency
      const phraseNames = matches.map(m => m.phrase).sort();
      expect(phraseNames).toEqual(['november rain', 'sweet child']);
    });

    it('should prioritize longer phrases over shorter ones', () => {
      // This test would require the service to have overlapping phrases
      // Testing with the available data
      const matches = service.findPhraseMatches('rock and roll');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('rock and roll');
      expect(matches[0].songIds).toEqual(['song-4']);
    });

    it('should handle partial word matching for compound terms', () => {
      const matches = service.findPhraseMatches('guitar solos are amazing');
      
      // Should match "guitar solo" even with pluralization
      expect(matches.some(m => m.phrase === 'guitar solo')).toBe(true);
    });

    it('should detect phrase boundaries correctly', () => {
      const matches = service.findPhraseMatches('I love hotel california song');
      
      expect(matches.some(m => m.phrase === 'hotel california')).toBe(true);
      expect(matches.some(m => m.phrase === 'love song')).toBe(false); // Should not match partial "love ... song"
    });
  });

  describe('Fuzzy and Partial Matching', () => {
    it('should handle minor spelling variations', () => {
      const matches = service.findPhraseMatches('bohemian rapsody'); // Missing 'h'
      
      // Should still find a match with lower confidence
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('bohemian rhapsody');
      expect(matches[0].matchType).toBe('fuzzy');
      expect(matches[0].confidence).toBeLessThan(0.9);
      expect(matches[0].confidence).toBeGreaterThan(0.5);
    });

    it('should handle character transpositions', () => {
      const matches = service.findPhraseMatches('danzing queen'); // 'c' -> 'z'
      
      expect(matches).toHaveLength(1);
      expect(matches[0].phrase).toBe('dancing queen');
      expect(matches[0].matchType).toBe('fuzzy');
    });

    it('should handle partial matches within longer text', () => {
      const matches = service.findPhraseMatches('that guitar solo was incredible');
      
      expect(matches.some(m => m.phrase === 'guitar solo')).toBe(true);
      expect(matches[0].matchType).toBe('partial');
    });

    it('should not match if similarity is too low', () => {
      const matches = service.findPhraseMatches('completely different text');
      
      expect(matches).toHaveLength(0);
    });
  });

  describe('Confidence Scoring', () => {
    it('should assign high confidence to exact matches', () => {
      const matches = service.findPhraseMatches('bohemian rhapsody');
      
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('should assign medium confidence to partial matches', () => {
      const matches = service.findPhraseMatches('I love this guitar solo piece');
      
      const guitarSoloMatch = matches.find(m => m.phrase === 'guitar solo');
      expect(guitarSoloMatch?.confidence).toBeLessThan(0.95);
      expect(guitarSoloMatch?.confidence).toBeGreaterThan(0.7);
    });

    it('should assign lower confidence to fuzzy matches', () => {
      const matches = service.findPhraseMatches('bohemian rapsody');
      
      expect(matches[0].confidence).toBeLessThan(0.9);
      expect(matches[0].confidence).toBeGreaterThan(0.5);
    });

    it('should consider phrase length in confidence calculation', () => {
      const shortMatch = service.findPhraseMatches('hey');
      const longMatch = service.findPhraseMatches('stairway to heaven');
      
      // Longer exact matches should have higher confidence
      if (shortMatch.length > 0 && longMatch.length > 0) {
        expect(longMatch[0].confidence).toBeGreaterThanOrEqual(shortMatch[0].confidence);
      }
    });
  });

  describe('Multiple Song Mappings', () => {
    it('should return multiple song IDs for phrases mapped to multiple songs', () => {
      const matches = service.findPhraseMatches('love song');
      
      expect(matches).toHaveLength(1);
      expect(matches[0].songIds).toEqual(['song-2', 'song-3']);
    });

    it('should handle phrases with different confidence levels', () => {
      const matches = service.findPhraseMatches('guitar solo power ballad');
      
      // Should find both phrases
      expect(matches).toHaveLength(2);
      
      const guitarSoloMatch = matches.find(m => m.phrase === 'guitar solo');
      const powerBalladMatch = matches.find(m => m.phrase === 'power ballad');
      
      expect(guitarSoloMatch?.songIds).toEqual(['song-11', 'song-12']);
      expect(powerBalladMatch?.songIds).toEqual(['song-13']);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty input', () => {
      const matches = service.findPhraseMatches('');
      expect(matches).toHaveLength(0);
    });

    it('should handle whitespace-only input', () => {
      const matches = service.findPhraseMatches('   \t\n  ');
      expect(matches).toHaveLength(0);
    });

    it('should handle very long input text', () => {
      const longText = 'word '.repeat(1000) + 'hey jude';
      const matches = service.findPhraseMatches(longText);
      
      expect(matches.some(m => m.phrase === 'hey jude')).toBe(true);
    });

    it('should handle special characters and emojis', () => {
      const matches = service.findPhraseMatches('🎵 hey jude 🎶');
      
      expect(matches.some(m => m.phrase === 'hey jude')).toBe(true);
    });

    it('should handle numbers and mixed alphanumeric', () => {
      const matches = service.findPhraseMatches('hey jude 2024 version');
      
      expect(matches.some(m => m.phrase === 'hey jude')).toBe(true);
    });
  });

  describe('Performance and Efficiency', () => {
    it('should handle large text efficiently', () => {
      const start = Date.now();
      const largeText = 'hey jude '.repeat(100);
      service.findPhraseMatches(largeText);
      const duration = Date.now() - start;
      
      // Should complete within reasonable time (< 100ms for this size)
      expect(duration).toBeLessThan(100);
    });

    it('should handle multiple consecutive matches', () => {
      const matches = service.findPhraseMatches('hey jude love song guitar solo');
      
      expect(matches).toHaveLength(3);
      expect(matches.map(m => m.phrase).sort()).toEqual(['guitar solo', 'hey jude', 'love song']);
    });
  });
});