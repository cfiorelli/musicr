import { describe, it, expect, beforeEach } from 'vitest';
import { ModerationService, type ModerationConfig } from '../moderation-service.js';

describe('Profanity Filter - Content Moderation System', () => {
  let moderationService: ModerationService;
  let defaultConfig: ModerationConfig;
  let strictConfig: ModerationConfig;
  let permissiveConfig: ModerationConfig;

  beforeEach(() => {
    moderationService = new ModerationService();
    
    defaultConfig = {
      strictMode: false,
      allowNSFW: false,
      logViolations: true
    };

    strictConfig = {
      strictMode: true,
      allowNSFW: false,
      logViolations: true
    };

    permissiveConfig = {
      strictMode: false,
      allowNSFW: true,
      logViolations: false
    };
  });

  describe('Clean Content Detection', () => {
    it('should allow clean song requests', async () => {
      const cleanInputs = [
        'play some Taylor Swift',
        'I love rock music',
        'classical piano music',
        'happy birthday song',
        'something upbeat and fun',
        'Beatles yellow submarine',
        'country music from the 90s',
        'smooth jazz for dinner'
      ];

      for (const input of cleanInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
        expect(result.confidence).toBeGreaterThan(0.9);
        expect(result.replacementText).toBeUndefined();
      }
    });

    it('should handle edge cases in clean content', async () => {
      const edgeCases = [
        '', // Empty string
        '   ', // Whitespace only
        'a', // Single character
        'The song "Bad" by Michael Jackson', // "Bad" should be allowed as song title
        'I want to rock and roll all night', // Common song lyrics
        'Play "Killing Me Softly"' // Song title with potentially flagged word
      ];

      for (const input of edgeCases) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
      }
    });

    it('should handle case insensitivity for clean content', async () => {
      const variations = [
        'TAYLOR SWIFT MUSIC',
        'taylor swift music',
        'TaYlOr SwIfT mUsIc',
        'Play Some BEATLES Songs'
      ];

      for (const input of variations) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
      }
    });
  });

  describe('Slur Detection and Blocking', () => {
    it('should block direct slurs', async () => {
      // Note: Using censored examples for testing
      const slurInputs = [
        'play some n***er music',
        'f****t songs',
        'nazi music',
        'hitler songs'
      ];

      for (const input of slurInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('slur');
        expect(result.confidence).toBe(1.0);
        expect(result.reason).toContain('prohibited slur');
        expect(result.replacementText).toBeUndefined(); // No replacement for slurs
      }
    });

    it('should detect slur evasion attempts', async () => {
      const evasionAttempts = [
        'n1gger music', // Number substitution
        'f@ggot songs', // Symbol substitution
        'n.i.g.g.e.r', // Dot separation
        'n-i-g-g-e-r' // Dash separation
      ];

      for (const input of evasionAttempts) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('slur');
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(result.reason).toContain('evasion detected');
      }
    });

    it('should handle mixed content with slurs', async () => {
      const mixedContent = [
        'I love music but nazis suck',
        'Play Taylor Swift not hitler songs',
        'Good music, but no n***er stuff'
      ];

      for (const input of mixedContent) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('slur');
        expect(result.reason).toContain('prohibited slur');
      }
    });

    it('should provide appropriate decline messages for slurs', () => {
      const message = moderationService.getPolicyDeclineMessage('slur');
      
      expect(message).toContain('inappropriate language');
      expect(message).toContain('cannot be processed');
    });
  });

  describe('Harassment Detection and Filtering', () => {
    it('should detect harassment keywords', async () => {
      const harassmentInputs = [
        'kill yourself',
        'kys loser',
        'you should die',
        'nobody likes you',
        'go harm yourself',
        'end your life',
        'you are worthless'
      ];

      for (const input of harassmentInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('harassment');
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(result.reason).toContain('harassment');
        expect(result.replacementText).toBeDefined(); // Should provide neutral mapping
      }
    });

    it('should detect aggressive typing patterns', async () => {
      const aggressiveInputs = [
        'AAAAAAAHHHHHHHHH I hate this song so much!!!!!!',
        'NOOOOOOOOO this is terrible music',
        'WHYYYYYYY would you play thisssssss'
      ];

      for (const input of aggressiveInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('harassment');
        expect(result.reason).toContain('aggressive typing pattern');
        expect(result.replacementText).toBeDefined();
      }
    });

    it('should provide neutral mappings for harassment', async () => {
      const result = await moderationService.moderateContent('kill yourself', defaultConfig);
      
      expect(result.allowed).toBe(false);
      expect(result.replacementText).toBeDefined();
      
      // Should be one of the neutral mappings
      const neutralMappings = ['Bad', 'Smooth Criminal', 'Beat It', 'The Way You Make Me Feel', 'Rock With You'];
      expect(neutralMappings).toContain(result.replacementText);
    });

    it('should provide appropriate decline messages for harassment', () => {
      const message = moderationService.getPolicyDeclineMessage('harassment');
      
      expect(message).toContain('harmful language');
      expect(message).toContain('try a different message');
    });
  });

  describe('NSFW Content Filtering', () => {
    it('should block NSFW content by default', async () => {
      const nsfwInputs = [
        'sexy time music',
        'porn soundtrack',
        'play something fucking hot',
        'songs for making love',
        'horny music playlist',
        'xxx rated songs'
      ];

      for (const input of nsfwInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('nsfw');
        expect(result.confidence).toBeGreaterThan(0.7);
        expect(result.reason).toContain('NSFW content');
        expect(result.replacementText).toBeDefined(); // Should provide neutral mapping
      }
    });

    it('should allow NSFW content when configured', async () => {
      const nsfwInputs = [
        'sexy music',
        'songs about sex',
        'adult contemporary'
      ];

      for (const input of nsfwInputs) {
        const result = await moderationService.moderateContent(input, permissiveConfig);
        
        if (result.category === 'nsfw') {
          expect(result.allowed).toBe(true);
        }
      }
    });

    it('should handle borderline NSFW content', async () => {
      const borderlineInputs = [
        'romantic music',
        'love songs',
        'intimate acoustic',
        'passionate ballads'
      ];

      for (const input of borderlineInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        // These should be allowed as they're not explicitly NSFW
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
      }
    });

    it('should provide appropriate decline messages for NSFW', () => {
      const message = moderationService.getPolicyDeclineMessage('nsfw');
      
      expect(message).toContain('family-friendly settings');
      expect(message).toContain('try a different message');
    });
  });

  describe('Spam Detection', () => {
    it('should detect excessive repetition in strict mode', async () => {
      const spamInputs = [
        'play play play play play play the same song',
        'music music music music music music now',
        'song song song song song song please'
      ];

      for (const input of spamInputs) {
        const result = await moderationService.moderateContent(input, strictConfig);
        
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('spam');
        expect(result.reason).toContain('excessive repetition');
        expect(result.confidence).toBeGreaterThan(0.6);
      }
    });

    it('should allow repetition in non-strict mode', async () => {
      const input = 'play play play play play play the same song';
      const result = await moderationService.moderateContent(input, defaultConfig);
      
      // Should be allowed in non-strict mode
      expect(result.allowed).toBe(true);
    });

    it('should detect excessively long messages', async () => {
      const longMessage = 'a'.repeat(1001); // Over 1000 characters
      const result = await moderationService.moderateContent(longMessage, defaultConfig);
      
      expect(result.allowed).toBe(false);
      expect(result.category).toBe('spam');
      expect(result.reason).toContain('too long');
      expect(result.confidence).toBe(0.9);
    });

    it('should allow reasonable repetition', async () => {
      const reasonableInputs = [
        'play that song song song', // Only 3 repetitions
        'I love love this music', // 2 repetitions
        'rock and roll music' // No excessive repetition
      ];

      for (const input of reasonableInputs) {
        const result = await moderationService.moderateContent(input, strictConfig);
        
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
      }
    });

    it('should provide appropriate decline messages for spam', () => {
      const message = moderationService.getPolicyDeclineMessage('spam');
      
      expect(message).toContain('appears to be spam');
      expect(message).toContain('simpler query');
    });
  });

  describe('Configuration Handling', () => {
    it('should respect strictMode setting', async () => {
      const spamText = 'play play play play play play music';
      
      const normalResult = await moderationService.moderateContent(spamText, defaultConfig);
      const strictResult = await moderationService.moderateContent(spamText, strictConfig);
      
      expect(normalResult.allowed).toBe(true);
      expect(strictResult.allowed).toBe(false);
    });

    it('should respect allowNSFW setting', async () => {
      const nsfwText = 'sexy music playlist';
      
      const strictResult = await moderationService.moderateContent(nsfwText, defaultConfig);
      const permissiveResult = await moderationService.moderateContent(nsfwText, permissiveConfig);
      
      expect(strictResult.allowed).toBe(false);
      expect(permissiveResult.allowed).toBe(true);
    });

    it('should handle missing configuration', async () => {
      const result = await moderationService.moderateContent('test music');
      
      // Should use defaults
      expect(result.allowed).toBe(true);
      expect(result.category).toBe('clean');
    });
  });

  describe('Dynamic Blocklist Management', () => {
    it('should allow adding terms to blocklists', () => {
      const originalResult = moderationService.moderateContent('testbadword music', defaultConfig);
      
      // Add to blocklist
      moderationService.addToBlocklist('testbadword', 'slur');
      
      // Should now be blocked
      const newResult = moderationService.moderateContent('testbadword music', defaultConfig);
      
      // Note: This is synchronous in the actual implementation
      expect(originalResult).not.toEqual(newResult);
    });

    it('should handle different blocklist categories', () => {
      moderationService.addToBlocklist('testslur', 'slur');
      moderationService.addToBlocklist('testharassment', 'harassment');
      moderationService.addToBlocklist('testnsfw', 'nsfw');
      
      // Each should be added to the appropriate category
      // This test verifies the method doesn't throw errors
      expect(() => {
        moderationService.addToBlocklist('anothertest', 'slur');
        moderationService.addToBlocklist('anothertest2', 'harassment');
        moderationService.addToBlocklist('anothertest3', 'nsfw');
      }).not.toThrow();
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle very short inputs', async () => {
      const shortInputs = ['a', 'hi', 'ok', ''];
      
      for (const input of shortInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
      }
    });

    it('should handle special characters and unicode', async () => {
      const unicodeInputs = [
        '音楽を演奏する', // Japanese "play music"
        'música rock', // Spanish "rock music"
        'müzik çal', // Turkish "play music"
        '🎵🎶🎸 rock music',
        'play 🔥 songs'
      ];

      for (const input of unicodeInputs) {
        const result = await moderationService.moderateContent(input, defaultConfig);
        
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
      }
    });

    it('should process content efficiently', async () => {
      const moderateText = 'play some good music for the party tonight';
      
      const startTime = performance.now();
      const result = await moderationService.moderateContent(moderateText, defaultConfig);
      const duration = performance.now() - startTime;
      
      expect(duration).toBeLessThan(10); // Should complete quickly
      expect(result.allowed).toBe(true);
    });

    it('should be consistent across multiple calls', async () => {
      const testText = 'play rock music';
      
      const results = await Promise.all([
        moderationService.moderateContent(testText, defaultConfig),
        moderationService.moderateContent(testText, defaultConfig),
        moderationService.moderateContent(testText, defaultConfig)
      ]);
      
      // All results should be identical
      const first = results[0];
      results.forEach(result => {
        expect(result.allowed).toBe(first.allowed);
        expect(result.category).toBe(first.category);
        expect(result.confidence).toBe(first.confidence);
      });
    });

    it('should handle null and undefined inputs gracefully', async () => {
      // TypeScript should prevent this, but test runtime safety
      const result = await moderationService.moderateContent('', defaultConfig);
      
      expect(result.allowed).toBe(true);
      expect(result.category).toBe('clean');
    });
  });

  describe('Policy Messages', () => {
    it('should provide appropriate messages for all categories', () => {
      const categories = ['slur', 'harassment', 'nsfw', 'spam', 'unknown'];
      
      for (const category of categories) {
        const message = moderationService.getPolicyDeclineMessage(category);
        
        expect(message).toBeDefined();
        expect(message.length).toBeGreaterThan(10);
        expect(message).toContain('.'); // Should be a complete sentence
      }
    });

    it('should provide default message for unknown categories', () => {
      const message = moderationService.getPolicyDeclineMessage('unknown-category');
      
      expect(message).toContain('Unable to process');
      expect(message).toContain('try something else');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle realistic music requests', async () => {
      const musicRequests = [
        'play some Taylor Swift',
        'I want to hear rock music',
        'can you play jazz music?',
        'something upbeat for working out',
        'classical music for studying',
        'country music from the 80s',
        'hip hop beats',
        'smooth R&B songs'
      ];

      for (const request of musicRequests) {
        const result = await moderationService.moderateContent(request, defaultConfig);
        
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('clean');
        expect(result.confidence).toBeGreaterThan(0.9);
      }
    });

    it('should handle mixed clean and problematic content', async () => {
      const mixedInputs = [
        { text: 'play good music, not nazi stuff', expectBlocked: true, category: 'slur' },
        { text: 'I love rock but kys if you play country', expectBlocked: true, category: 'harassment' },
        { text: 'play sexy music for my date', expectBlocked: true, category: 'nsfw' },
        { text: 'play music music music music music music', expectBlocked: false, category: 'clean' } // Not strict mode
      ];

      for (const { text, expectBlocked, category } of mixedInputs) {
        const result = await moderationService.moderateContent(text, defaultConfig);
        
        if (expectBlocked) {
          expect(result.allowed).toBe(false);
          expect(result.category).toBe(category);
        } else {
          expect(result.allowed).toBe(true);
        }
      }
    });
  });
});