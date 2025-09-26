/**
 * User Management Service
 * 
 * Handles anonymous user creation, cookie management, and user authentication.
 * Creates anonymous users with handles like ${adjective}-${animal}-${nanoid(3)}
 * and persists userId in HttpOnly cookies for 1 year.
 */

import { PrismaClient, User } from '@prisma/client';
import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { generateAnonHandle } from '../utils/anon-handle.js';
import { logger } from '../config/index.js';

interface UserSession {
  userId: string;
  anonHandle: string;
  createdAt: Date;
  isNew: boolean;
}

interface CreateUserOptions {
  ipAddress: string;
  userAgent?: string;
  retryCount?: number;
}

export class UserService {
  private prisma: PrismaClient;
  private readonly COOKIE_NAME = 'musicr_user_id';
  private readonly COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds
  private readonly MAX_RETRY_ATTEMPTS = 5;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get or create user session from request
   * For WebSocket connections, pass null for reply to skip cookie setting
   */
  async getUserSession(request: FastifyRequest, reply: FastifyReply | null): Promise<UserSession> {
    // Try to get existing user from cookie
    const existingUserId = request.cookies?.[this.COOKIE_NAME];
    
    if (existingUserId) {
      const user = await this.getUserById(existingUserId);
      if (user) {
        logger.debug({
          userId: user.id,
          anonHandle: user.anonHandle
        }, 'Existing user session found');
        
        return {
          userId: user.id,
          anonHandle: user.anonHandle,
          createdAt: user.createdAt,
          isNew: false
        };
      } else {
        // Cookie exists but user not found - clear the cookie if reply is available
        if (reply) {
          reply.clearCookie(this.COOKIE_NAME);
        }
        logger.warn({
          userId: existingUserId
        }, 'User not found for existing cookie, creating new user');
      }
    }

    // Create new anonymous user
    const ipAddress = this.getClientIP(request);
    const userAgent = request.headers['user-agent'] || undefined;
    
    const user = await this.createAnonymousUser({
      ipAddress,
      userAgent
    });

    // Set HttpOnly cookie with 1 year expiration (only if reply is available)
    if (reply) {
      reply.setCookie(this.COOKIE_NAME, user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: this.COOKIE_MAX_AGE,
        path: '/'
      });
    } else {
      logger.info({
        userId: user.id,
        anonHandle: user.anonHandle
      }, 'New user created for WebSocket connection - cookie will be set on next HTTP request');
    }

    logger.info({
      userId: user.id,
      anonHandle: user.anonHandle,
      ipHash: user.ipHash.substring(0, 8)
    }, 'New anonymous user created');

    return {
      userId: user.id,
      anonHandle: user.anonHandle,
      createdAt: user.createdAt,
      isNew: true
    };
  }

  /**
   * Create a new anonymous user
   */
  async createAnonymousUser(options: CreateUserOptions): Promise<User> {
    const { ipAddress, userAgent, retryCount = 0 } = options;
    
    if (retryCount >= this.MAX_RETRY_ATTEMPTS) {
      throw new Error('Max retry attempts reached for user creation');
    }

    const anonHandle = generateAnonHandle();
    const ipHash = this.hashIP(ipAddress);

    try {
      const user = await this.prisma.user.create({
        data: {
          anonHandle,
          ipHash,
          createdAt: new Date()
        }
      });

      logger.debug({
        userId: user.id,
        anonHandle,
        ipHash: ipHash.substring(0, 8),
        userAgent: userAgent?.substring(0, 50)
      }, 'Anonymous user created successfully');

      return user;

    } catch (error: any) {
      // Handle unique constraint violation (duplicate anonHandle)
      if (error.code === 'P2002' && error.meta?.target?.includes('anonHandle')) {
        logger.debug({
          anonHandle,
          retryCount
        }, 'Anonymous handle collision, retrying');
        
        return this.createAnonymousUser({
          ...options,
          retryCount: retryCount + 1
        });
      }

      logger.error({
        error,
        anonHandle,
        ipHash: ipHash.substring(0, 8)
      }, 'Failed to create anonymous user');
      
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id: userId }
      });
    } catch (error) {
      logger.error({ error, userId }, 'Error fetching user by ID');
      return null;
    }
  }

  /**
   * Get user by anonymous handle
   */
  async getUserByHandle(anonHandle: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { anonHandle }
      });
    } catch (error) {
      logger.error({ error, anonHandle }, 'Error fetching user by handle');
      return null;
    }
  }

  /**
   * Get recent users by IP hash (for analytics/moderation)
   */
  async getRecentUsersByIP(ipAddress: string, limit: number = 10): Promise<User[]> {
    const ipHash = this.hashIP(ipAddress);
    
    try {
      return await this.prisma.user.findMany({
        where: { ipHash },
        orderBy: { createdAt: 'desc' },
        take: limit
      });
    } catch (error) {
      logger.error({ error, ipHash: ipHash.substring(0, 8) }, 'Error fetching users by IP');
      return [];
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId: string): Promise<{
    messageCount: number;
    firstMessage?: Date;
    lastMessage?: Date;
    accountAge: number; // days
  } | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          messages: {
            select: {
              createdAt: true
            },
            orderBy: {
              createdAt: 'asc'
            }
          }
        }
      });

      if (!user) return null;

      const messageCount = user.messages.length;
      const firstMessage = user.messages[0]?.createdAt;
      const lastMessage = user.messages[messageCount - 1]?.createdAt;
      const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));

      return {
        messageCount,
        firstMessage,
        lastMessage,
        accountAge
      };
    } catch (error) {
      logger.error({ error, userId }, 'Error fetching user stats');
      return null;
    }
  }

  /**
   * Clean up old users (for maintenance)
   */
  async cleanupOldUsers(daysOld: number = 365): Promise<number> {
    const cutoffDate = new Date(Date.now() - (daysOld * 24 * 60 * 60 * 1000));
    
    try {
      const result = await this.prisma.user.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
          messages: { none: {} } // Only delete users with no messages
        }
      });

      logger.info({
        deletedCount: result.count,
        cutoffDate
      }, 'Old users cleanup completed');

      return result.count;
    } catch (error) {
      logger.error({ error }, 'Error during user cleanup');
      return 0;
    }
  }

  /**
   * Hash IP address for privacy
   */
  private hashIP(ipAddress: string): string {
    return createHash('sha256')
      .update(ipAddress + process.env.IP_SALT || 'musicr-salt')
      .digest('hex')
      .substring(0, 32); // Use first 32 chars
  }

  /**
   * Get client IP address from request
   */
  private getClientIP(request: FastifyRequest): string {
    // Check common headers for proxy/load balancer scenarios
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }

    const realIP = request.headers['x-real-ip'];
    if (typeof realIP === 'string') {
      return realIP.trim();
    }

    // Fallback to socket remote address
    return request.socket.remoteAddress || 'unknown';
  }

  /**
   * Validate user session cookie
   */
  isValidUserSession(userId: string): boolean {
    // Basic UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(userId);
  }

  /**
   * Clear user session
   */
  clearUserSession(reply: FastifyReply): void {
    reply.clearCookie(this.COOKIE_NAME, {
      path: '/'
    });
  }
}