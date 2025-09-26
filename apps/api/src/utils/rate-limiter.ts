/**
 * Token Bucket Rate Limiter
 * 
 * Implements in-memory rate limiting using token bucket algorithm.
 * Limits: 10 messages per 10 seconds, burst capacity of 30 messages.
 * Tracks both userId and IP address for comprehensive rate limiting.
 */

import { logger } from '../config/index.js';

interface TokenBucket {
  tokens: number;           // Current token count
  lastRefill: number;       // Last refill timestamp (ms)
  capacity: number;         // Maximum token capacity
  refillRate: number;       // Tokens per second
}

interface RateLimitConfig {
  windowMs: number;         // Time window in milliseconds
  maxRequests: number;      // Max requests per window
  burstCapacity: number;    // Burst capacity (max tokens)
  refillRate: number;       // Tokens per second
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;      // Seconds until next request allowed
}

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout;

  constructor(config?: Partial<RateLimitConfig>) {
    // Default config: 10 messages per 10 seconds, burst 30
    this.config = {
      windowMs: 10 * 1000,        // 10 seconds
      maxRequests: 10,            // 10 requests per window
      burstCapacity: 30,          // 30 token burst capacity
      refillRate: 1,              // 1 token per second
      ...config
    };

    // Cleanup old buckets every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);

    logger.info({
      windowMs: this.config.windowMs,
      maxRequests: this.config.maxRequests,
      burstCapacity: this.config.burstCapacity,
      refillRate: this.config.refillRate
    }, 'Rate limiter initialized');
  }

  /**
   * Check if a request is allowed for a given key (userId + IP)
   */
  checkLimit(userId: string, ipAddress: string): RateLimitResult {
    const key = this.generateKey(userId, ipAddress);
    const bucket = this.getBucket(key);
    const now = Date.now();

    // Refill tokens based on time elapsed
    this.refillBucket(bucket, now);

    // Check if request is allowed
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      
      const result: RateLimitResult = {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetTime: now + this.config.windowMs
      };

      logger.debug({
        key: this.maskKey(key),
        tokens: bucket.tokens,
        remaining: result.remaining
      }, 'Rate limit check: allowed');

      return result;
    } else {
      // Calculate retry after time
      const tokensNeeded = 1;
      const retryAfterMs = (tokensNeeded / this.config.refillRate) * 1000;
      
      const result: RateLimitResult = {
        allowed: false,
        remaining: 0,
        resetTime: now + retryAfterMs,
        retryAfter: Math.ceil(retryAfterMs / 1000)
      };

      logger.warn({
        key: this.maskKey(key),
        tokens: bucket.tokens,
        retryAfter: result.retryAfter
      }, 'Rate limit check: denied');

      return result;
    }
  }

  /**
   * Get rate limit status without consuming a token
   */
  getStatus(userId: string, ipAddress: string): RateLimitResult {
    const key = this.generateKey(userId, ipAddress);
    const bucket = this.getBucket(key);
    const now = Date.now();

    // Refill tokens based on time elapsed (without consuming)
    this.refillBucket(bucket, now);

    return {
      allowed: bucket.tokens >= 1,
      remaining: Math.floor(bucket.tokens),
      resetTime: now + this.config.windowMs,
      retryAfter: bucket.tokens < 1 ? Math.ceil((1 / this.config.refillRate) * 1000) / 1000 : undefined
    };
  }

  /**
   * Reset rate limit for a specific key (admin function)
   */
  resetLimit(userId: string, ipAddress: string): void {
    const key = this.generateKey(userId, ipAddress);
    this.buckets.delete(key);
    
    logger.info({
      key: this.maskKey(key)
    }, 'Rate limit reset');
  }

  /**
   * Get or create a token bucket for a key
   */
  private getBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    
    if (!bucket) {
      bucket = {
        tokens: this.config.burstCapacity,  // Start with full capacity
        lastRefill: Date.now(),
        capacity: this.config.burstCapacity,
        refillRate: this.config.refillRate
      };
      this.buckets.set(key, bucket);
    }
    
    return bucket;
  }

  /**
   * Refill tokens in bucket based on time elapsed
   */
  private refillBucket(bucket: TokenBucket, now: number): void {
    const timeSinceRefill = now - bucket.lastRefill;
    const tokensToAdd = (timeSinceRefill / 1000) * bucket.refillRate;
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  /**
   * Generate a unique key for userId + IP combination
   */
  private generateKey(userId: string, ipAddress: string): string {
    // Use both userId and IP to prevent evasion
    return `${userId}:${this.hashIP(ipAddress)}`;
  }

  /**
   * Hash IP address for privacy
   */
  private hashIP(ip: string): string {
    // Simple hash to protect IP privacy in logs
    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      const char = ip.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Mask key for logging (privacy)
   */
  private maskKey(key: string): string {
    const [userId, ipHash] = key.split(':');
    return `${userId.substring(0, 8)}...:${ipHash}`;
  }

  /**
   * Cleanup old buckets to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    let cleaned = 0;

    for (const [key, bucket] of this.buckets.entries()) {
      // Remove buckets that haven't been used recently and are empty
      if (now - bucket.lastRefill > maxAge && bucket.tokens >= bucket.capacity * 0.9) {
        this.buckets.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({
        cleaned,
        remaining: this.buckets.size
      }, 'Rate limiter cleanup completed');
    }
  }

  /**
   * Get statistics about the rate limiter
   */
  getStats(): {
    totalBuckets: number;
    activeBuckets: number;
    config: RateLimitConfig;
  } {
    const now = Date.now();
    let activeBuckets = 0;

    for (const bucket of this.buckets.values()) {
      if (bucket.tokens < bucket.capacity * 0.9 || now - bucket.lastRefill < 60000) {
        activeBuckets++;
      }
    }

    return {
      totalBuckets: this.buckets.size,
      activeBuckets,
      config: this.config
    };
  }

  /**
   * Shutdown cleanup
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.buckets.clear();
    logger.info('Rate limiter shutdown');
  }
}

// Global rate limiter instance
export const rateLimiter = new RateLimiter();

// Cleanup on process exit
process.on('SIGTERM', () => rateLimiter.shutdown());
process.on('SIGINT', () => rateLimiter.shutdown());