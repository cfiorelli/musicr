import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('content-filter', () => {
  describe('with BLOCKED_KEYWORDS set', () => {
    let containsBlockedKeyword: (text: string) => boolean;
    let getBlockedKeywordCount: () => number;

    beforeEach(async () => {
      vi.resetModules();
      process.env.BLOCKED_KEYWORDS = 'spam, hate, badword';
      const mod = await import('./content-filter.js');
      containsBlockedKeyword = mod.containsBlockedKeyword;
      getBlockedKeywordCount = mod.getBlockedKeywordCount;
    });

    it('detects an exact blocked keyword', () => {
      expect(containsBlockedKeyword('this is spam')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(containsBlockedKeyword('SPAM everywhere')).toBe(true);
      expect(containsBlockedKeyword('I hate this')).toBe(true);
    });

    it('matches whole words only (not substrings)', () => {
      // "spam" inside "spammer" should NOT match (word boundary)
      expect(containsBlockedKeyword('a spammer is here')).toBe(false);
    });

    it('allows clean messages', () => {
      expect(containsBlockedKeyword('I need a song for a rainy day')).toBe(false);
    });

    it('detects keyword at start/end of string', () => {
      expect(containsBlockedKeyword('spam')).toBe(true);
      expect(containsBlockedKeyword('no more hate')).toBe(true);
    });

    it('reports correct keyword count', () => {
      expect(getBlockedKeywordCount()).toBe(3);
    });
  });

  describe('with BLOCKED_KEYWORDS unset', () => {
    let containsBlockedKeyword: (text: string) => boolean;
    let getBlockedKeywordCount: () => number;

    beforeEach(async () => {
      vi.resetModules();
      delete process.env.BLOCKED_KEYWORDS;
      const mod = await import('./content-filter.js');
      containsBlockedKeyword = mod.containsBlockedKeyword;
      getBlockedKeywordCount = mod.getBlockedKeywordCount;
    });

    it('allows everything when no keywords configured', () => {
      expect(containsBlockedKeyword('anything goes here')).toBe(false);
    });

    it('reports zero keyword count', () => {
      expect(getBlockedKeywordCount()).toBe(0);
    });
  });
});
