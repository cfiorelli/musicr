/**
 * Redis Service for Cross-Instance Coordination
 *
 * Provides pub/sub functionality to synchronize presence and reactions
 * across multiple backend instances.
 */

import Redis from 'ioredis';
import { logger } from '../config/index.js';

export interface PresenceEvent {
  type: 'user_joined' | 'user_left';
  userId: string;
  anonHandle: string;
  roomId: string;
  timestamp: string;
  instanceId: string;
}

export interface ReactionEvent {
  type: 'reaction_added' | 'reaction_removed';
  messageId: string;
  emoji: string;
  userId: string;
  anonHandle?: string;
  roomId: string;
  timestamp: string;
  instanceId: string;
}

type PubSubEvent = PresenceEvent | ReactionEvent;

export class RedisService {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private enabled: boolean = false;
  private eventHandlers: Map<string, Set<(event: PubSubEvent) => void>> = new Map();

  constructor() {
    this.initialize();
  }

  private initialize() {
    const redisUrl = process.env.REDIS_URL;

    // Redis is optional - if not configured, instance runs standalone
    if (!redisUrl) {
      logger.info('Redis not configured - running in standalone mode (single instance only)');
      this.enabled = false;
      return;
    }

    try {
      // Create separate connections for pub and sub
      this.publisher = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      });

      this.subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      });

      this.publisher.on('error', (err) => {
        logger.error({ error: err }, 'Redis publisher error');
      });

      this.subscriber.on('error', (err) => {
        logger.error({ error: err }, 'Redis subscriber error');
      });

      this.publisher.on('connect', () => {
        logger.info('Redis publisher connected');
        this.enabled = true;
      });

      this.subscriber.on('connect', () => {
        logger.info('Redis subscriber connected');
      });

      // Handle incoming messages
      this.subscriber.on('message', (channel, message) => {
        try {
          const event = JSON.parse(message) as PubSubEvent;
          this.handleEvent(channel, event);
        } catch (error) {
          logger.error({ error, channel, message }, 'Failed to parse Redis message');
        }
      });

      logger.info('Redis service initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Redis - running in standalone mode');
      this.enabled = false;
      this.publisher = null;
      this.subscriber = null;
    }
  }

  /**
   * Check if Redis is enabled and connected
   */
  isEnabled(): boolean {
    return this.enabled && this.publisher?.status === 'ready';
  }

  /**
   * Subscribe to a channel and register event handler
   */
  async subscribe(channel: string, handler: (event: PubSubEvent) => void): Promise<void> {
    if (!this.subscriber) {
      logger.debug({ channel }, 'Redis not available - skipping subscription');
      return;
    }

    // Register handler
    if (!this.eventHandlers.has(channel)) {
      this.eventHandlers.set(channel, new Set());
    }
    this.eventHandlers.get(channel)!.add(handler);

    // Subscribe to channel
    await this.subscriber.subscribe(channel);
    logger.debug({ channel }, 'Subscribed to Redis channel');
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string, handler?: (event: PubSubEvent) => void): Promise<void> {
    if (!this.subscriber) return;

    if (handler) {
      // Remove specific handler
      this.eventHandlers.get(channel)?.delete(handler);

      // If no handlers left, unsubscribe from channel
      if (this.eventHandlers.get(channel)?.size === 0) {
        await this.subscriber.unsubscribe(channel);
        this.eventHandlers.delete(channel);
        logger.debug({ channel }, 'Unsubscribed from Redis channel');
      }
    } else {
      // Remove all handlers and unsubscribe
      await this.subscriber.unsubscribe(channel);
      this.eventHandlers.delete(channel);
      logger.debug({ channel }, 'Unsubscribed from Redis channel');
    }
  }

  /**
   * Publish event to a channel
   */
  async publish(channel: string, event: PubSubEvent): Promise<void> {
    if (!this.publisher || !this.enabled) {
      logger.debug({ channel, eventType: event.type }, 'Redis not available - skipping publish');
      return;
    }

    try {
      await this.publisher.publish(channel, JSON.stringify(event));
      logger.debug({ channel, eventType: event.type, instanceId: event.instanceId }, 'Published event to Redis');
    } catch (error) {
      logger.error({ error, channel, event }, 'Failed to publish to Redis');
    }
  }

  /**
   * Handle incoming event from Redis
   */
  private handleEvent(channel: string, event: PubSubEvent): void {
    const handlers = this.eventHandlers.get(channel);
    if (!handlers || handlers.size === 0) {
      return;
    }

    logger.debug({
      channel,
      eventType: event.type,
      instanceId: event.instanceId,
      handlerCount: handlers.size
    }, 'Received event from Redis');

    // Call all registered handlers
    handlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        logger.error({ error, channel, event }, 'Error in Redis event handler');
      }
    });
  }

  /**
   * Get presence data from Redis (authoritative source)
   * Returns set of userIds currently in a room across all instances
   */
  async getRoomPresence(roomId: string): Promise<Set<string>> {
    if (!this.publisher || !this.enabled) {
      return new Set();
    }

    try {
      const key = `presence:${roomId}`;
      const members = await this.publisher.smembers(key);
      return new Set(members);
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to get room presence from Redis');
      return new Set();
    }
  }

  /**
   * Add user to room presence in Redis
   */
  async addToPresence(roomId: string, userId: string): Promise<void> {
    if (!this.publisher || !this.enabled) {
      return;
    }

    try {
      const key = `presence:${roomId}`;
      await this.publisher.sadd(key, userId);
      // Set expiry to auto-cleanup stale entries (24 hours)
      await this.publisher.expire(key, 86400);
    } catch (error) {
      logger.error({ error, roomId, userId }, 'Failed to add user to Redis presence');
    }
  }

  /**
   * Remove user from room presence in Redis
   */
  async removeFromPresence(roomId: string, userId: string): Promise<void> {
    if (!this.publisher || !this.enabled) {
      return;
    }

    try {
      const key = `presence:${roomId}`;
      await this.publisher.srem(key, userId);
    } catch (error) {
      logger.error({ error, roomId, userId }, 'Failed to remove user from Redis presence');
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Redis service');

    if (this.subscriber) {
      await this.subscriber.quit();
    }

    if (this.publisher) {
      await this.publisher.quit();
    }

    this.eventHandlers.clear();
    logger.info('Redis service shutdown complete');
  }
}

// Singleton instance
export const redisService = new RedisService();
