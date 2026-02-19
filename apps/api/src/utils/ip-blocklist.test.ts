import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ip-blocklist', () => {
  describe('with BLOCKED_IPS set', () => {
    let isBlocked: (ip: string) => boolean;
    let getBlockedCount: () => number;

    beforeEach(async () => {
      vi.resetModules();
      process.env.BLOCKED_IPS = '1.2.3.4,  5.6.7.8 , 9.10.11.12  ';
      const mod = await import('./ip-blocklist.js');
      isBlocked = mod.isBlocked;
      getBlockedCount = mod.getBlockedCount;
    });

    it('blocks an explicitly listed IP', () => {
      expect(isBlocked('1.2.3.4')).toBe(true);
    });

    it('blocks IPs regardless of surrounding whitespace in env var', () => {
      expect(isBlocked('5.6.7.8')).toBe(true);
      expect(isBlocked('9.10.11.12')).toBe(true);
    });

    it('allows an unlisted IP', () => {
      expect(isBlocked('8.8.8.8')).toBe(false);
    });

    it('reports the correct count', () => {
      expect(getBlockedCount()).toBe(3);
    });
  });

  describe('with BLOCKED_IPS unset', () => {
    let isBlocked: (ip: string) => boolean;
    let getBlockedCount: () => number;

    beforeEach(async () => {
      vi.resetModules();
      delete process.env.BLOCKED_IPS;
      const mod = await import('./ip-blocklist.js');
      isBlocked = mod.isBlocked;
      getBlockedCount = mod.getBlockedCount;
    });

    it('allows all IPs when blocklist is empty', () => {
      expect(isBlocked('1.2.3.4')).toBe(false);
      expect(isBlocked('0.0.0.0')).toBe(false);
    });

    it('reports zero blocked IPs', () => {
      expect(getBlockedCount()).toBe(0);
    });
  });
});
