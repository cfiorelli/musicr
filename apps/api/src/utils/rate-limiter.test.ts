import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config logger so we don't trigger env validation
vi.mock('../config/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  config: {
    nodeEnv: 'test',
    server: { frontendOrigin: '*', port: 4000 },
  },
}));

const { RateLimiter } = await import('./rate-limiter.js');

describe('RateLimiter', () => {
  let limiter: InstanceType<typeof RateLimiter>;

  beforeEach(() => {
    limiter = new RateLimiter({
      burstCapacity: 5,
      refillRate: 1,    // 1 token/s
      maxRequests: 5,
      windowMs: 5000,
    });
  });

  it('allows requests within burst capacity', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.checkLimit('user1', '1.2.3.4').allowed).toBe(true);
    }
  });

  it('blocks requests that exceed burst capacity', () => {
    for (let i = 0; i < 5; i++) limiter.checkLimit('user1', '1.2.3.4');
    const result = limiter.checkLimit('user1', '1.2.3.4');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('does not cross-contaminate different users', () => {
    for (let i = 0; i < 5; i++) limiter.checkLimit('user1', '1.2.3.4');
    // user2 with same IP should still have their own bucket
    expect(limiter.checkLimit('user2', '1.2.3.4').allowed).toBe(true);
  });

  it('resets a user\'s limit', () => {
    for (let i = 0; i < 5; i++) limiter.checkLimit('user1', '1.2.3.4');
    expect(limiter.checkLimit('user1', '1.2.3.4').allowed).toBe(false);
    limiter.resetLimit('user1', '1.2.3.4');
    expect(limiter.checkLimit('user1', '1.2.3.4').allowed).toBe(true);
  });

  it('getStatus does not consume tokens', () => {
    limiter.getStatus('user1', '1.2.3.4');
    limiter.getStatus('user1', '1.2.3.4');
    expect(limiter.checkLimit('user1', '1.2.3.4').remaining).toBe(4);
  });
});
