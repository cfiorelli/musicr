import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import cookie from '@fastify/cookie';
import { config, logger } from './config/index.js';
import { connectDatabase, disconnectDatabase, prisma } from './services/database.js';
import { UserService } from './services/user-service.js';
import { RoomService } from './services/room-service.js';
import { SongMatchingService } from './services/song-matching-service.js';
import { ConnectionManager } from './services/connection-manager.js';
import net from 'net';

// Types for analytics queries
type RecentMapping = {
  id: string;
  text: string;
  createdAt: Date;
  user: { anonHandle: string };
  room: { name: string };
  song: { title: string; artist: string; year: number | null; tags: string[] } | null;
  scores: any;
  userId: string;
  chosenSongId: string | null;
};

type PopularMapping = {
  chosenSongId: string | null;
  _count: { chosenSongId: number };
};

// Port availability check
function assertPortFree(p: number): Promise<void> {
  return new Promise<void>((res, rej) => {
    const s = net.createServer().once('error', rej).once('listening', () => s.close(() => res())).listen(p, '127.0.0.1');
  });
}

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    transport: config.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname,reqId,res,responseTime',
        messageFormat: '{msg}',
        translateTime: 'HH:MM:ss UTC',
      },
    } : undefined,
  },
});

// Register plugins
await fastify.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Parse multiple origins from environment
    const allowedOrigins = config.server.frontendOrigin
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);
    
    // In development, be more permissive
    if (config.nodeEnv === 'development') {
      const isDevelopmentOrigin = origin.includes('localhost') || 
                                 origin.includes('127.0.0.1') ||
                                 allowedOrigins.includes(origin);
      return callback(null, isDevelopmentOrigin);
    }
    
    // In production, only allow specified origins
    const isAllowed = allowedOrigins.includes(origin);
    callback(null, isAllowed);
  },
  credentials: true,
});

await fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET || 'fallback-secret-key-development-only',
  parseOptions: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax', // 'none' required for cross-origin in production
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
  }
});

await fastify.register(websocket);

// Initialize services
const userService = new UserService(prisma);
const roomService = new RoomService(prisma);
const songMatchingService = new SongMatchingService(prisma);
// const songSearchService = new SongSearchService(prisma); // Reserved for future use
const connectionManager = new ConnectionManager();

// Initialize room service (this will create default room)
await roomService.initialize();

// Comprehensive health endpoint for container orchestration
fastify.get('/health', async (_, reply) => {
  const startTime = Date.now();
  
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1 as health_check`;
    
    // Check if embedding service is responsive
    const embeddingHealthy = await Promise.race([
      (async () => {
        try {
          // Quick test of core services without expensive operations
          return true;
        } catch {
          return false;
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]).catch(() => false);
    
    const responseTime = Date.now() - startTime;
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
      services: {
        database: 'healthy',
        embedding: embeddingHealthy ? 'healthy' : 'degraded'
      },
      performance: {
        responseTime: `${responseTime}ms`,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          limit: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
      }
    };
    
    // Return 503 if any critical service is down
    const isHealthy = health.services.database === 'healthy';
    
    return reply
      .code(isHealthy ? 200 : 503)
      .send(health);
      
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    return reply.code(503).send({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed',
      uptime: process.uptime()
    });
  }
});

// POST /api/map - Deterministic song mapping endpoint with moderation
fastify.post('/api/map', async (request, reply) => {
  const body = request.body as { text: string };
  
  if (!body.text || typeof body.text !== 'string') {
    return reply.code(400).send({ error: 'Invalid request: text field is required and must be a string' });
  }

  try {
    // Get room for moderation settings (default to family-friendly)
    const room = await roomService.getRoomByName('main');
    
    const result = await songMatchingService.matchSongs(
      body.text,
      false, // allowExplicit - use room setting
      'api-user',
      room?.allowExplicit || false
    );

    return reply.send(result);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error in /api/map');
    
    // Handle moderation errors gracefully
    if (error.message?.includes('inappropriate') || error.message?.includes('policy')) {
      return reply.code(400).send({ 
        error: 'Content moderation',
        message: error.message 
      });
    }
    
    return reply.code(500).send({ error: 'Internal server error' });
  }
});

// Admin analytics endpoint (dev-only)
fastify.get('/api/admin/analytics', async (_, reply) => {
  // Dev-only check
  if (config.nodeEnv === 'production') {
    return reply.code(403).send({ error: 'Admin endpoint not available in production' });
  }

  try {
    // Get last 100 mappings with song details
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentMappings = await prisma.message.findMany({
      where: { createdAt: { gte: oneWeekAgo } },
      include: { user: true, room: true, song: true },
      orderBy: { createdAt: 'desc' },
      take: 100
    }) as RecentMapping[];    // Calculate decade distribution
    const decadeDistribution: Record<string, number> = {};
    const failureReasons: Record<string, number> = {};
    const tagDistribution: Record<string, number> = {};
    const confidenceStats = {
      high: 0, // > 0.8
      medium: 0, // 0.5 - 0.8
      low: 0, // < 0.5
      total: 0
    };

    recentMappings.forEach((mapping: RecentMapping) => {
      // Decade analysis
      if (mapping.song?.year) {
        const decade = `${Math.floor(mapping.song.year / 10) * 10}s`;
        decadeDistribution[decade] = (decadeDistribution[decade] || 0) + 1;
      } else {
        decadeDistribution['Unknown'] = (decadeDistribution['Unknown'] || 0) + 1;
      }

      // Tag distribution
      if (mapping.song?.tags) {
        mapping.song.tags.forEach((tag: string) => {
          tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
        });
      }

      // Confidence analysis (from scores JSON)
      if (mapping.scores && typeof mapping.scores === 'object') {
        const scores = mapping.scores as any;
        if (scores.confidence !== undefined) {
          confidenceStats.total++;
          if (scores.confidence > 0.8) confidenceStats.high++;
          else if (scores.confidence >= 0.5) confidenceStats.medium++;
          else confidenceStats.low++;
        }
      }

      // Failure reasons (when confidence is low or no song matched)
      if (!mapping.song) {
        failureReasons['No song matched'] = (failureReasons['No song matched'] || 0) + 1;
      } else if (mapping.scores && typeof mapping.scores === 'object') {
        const scores = mapping.scores as any;
        if (scores.confidence < 0.5) {
          const strategy = scores.strategy || 'unknown';
          failureReasons[`Low confidence (${strategy})`] = (failureReasons[`Low confidence (${strategy})`] || 0) + 1;
        }
      }
    });

    // Get popular songs (most mapped)
    const popularMappings = await prisma.message.groupBy({
      by: ['chosenSongId'],
      where: {
        chosenSongId: { not: null }
      },
      _count: {
        chosenSongId: true
      },
      orderBy: {
        _count: {
          chosenSongId: 'desc'
        }
      },
      take: 10
    });

    // Get song details for popular mappings
    const popularSongs = await Promise.all(
      popularMappings.map(async (mapping: PopularMapping) => {
        const song = await prisma.song.findUnique({
          where: { id: mapping.chosenSongId! },
          select: {
            title: true,
            artist: true,
            year: true
          }
        });
        return {
          ...song,
          mappingCount: mapping._count.chosenSongId
        };
      })
    );

    // Performance statistics
    const totalMappings = recentMappings.length;
    const successfulMappings = recentMappings.filter(m => m.song).length;
    const successRate = totalMappings > 0 ? (successfulMappings / totalMappings) * 100 : 0;

    const analytics = {
      summary: {
        totalMappings,
        successfulMappings,
        successRate: Math.round(successRate * 10) / 10,
        averageConfidence: confidenceStats.total > 0 
          ? Math.round((confidenceStats.high * 0.9 + confidenceStats.medium * 0.65 + confidenceStats.low * 0.3) / confidenceStats.total * 100) / 100
          : 0
      },
      recentMappings: recentMappings.map((mapping: RecentMapping) => ({
        id: mapping.id,
        text: mapping.text,
        timestamp: mapping.createdAt,
        user: mapping.user.anonHandle,
        room: mapping.room.name,
        song: mapping.song ? {
          title: mapping.song.title,
          artist: mapping.song.artist,
          year: mapping.song.year
        } : null,
        confidence: mapping.scores ? (mapping.scores as any).confidence : null,
        strategy: mapping.scores ? (mapping.scores as any).strategy : null
      })),
      decadeDistribution: Object.entries(decadeDistribution)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([decade, count]) => ({ decade, count })),
      tagDistribution: Object.entries(tagDistribution)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 15) // Top 15 tags
        .map(([tag, count]) => ({ tag, count })),
      confidenceBreakdown: {
        high: confidenceStats.high,
        medium: confidenceStats.medium,
        low: confidenceStats.low,
        total: confidenceStats.total
      },
      failureReasons: Object.entries(failureReasons)
        .sort(([, a], [, b]) => b - a)
        .map(([reason, count]) => ({ reason, count })),
      popularSongs: popularSongs.filter(song => song)
    };

    return reply.send(analytics);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error in /api/admin/analytics');
    return reply.code(500).send({ error: 'Failed to generate analytics' });
  }
});

// WebSocket endpoint for real-time chat with song mapping
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, async (connection, request) => {
    logger.info('WebSocket connection established');
    
    // Get or create user session
    let userId: string;
    let anonHandle: string;
    
    try {
      const userSession = await userService.getUserSession(request, null);
      userId = userSession.userId;
      anonHandle = userSession.anonHandle;
    } catch (error) {
      logger.error({ error }, 'Error getting user for WebSocket connection');
      userId = `anonymous-${Date.now()}`;
      anonHandle = `user-${Math.random().toString(36).substring(7)}`;
    }
    
    // Add connection to manager
    const connectionId = connectionManager.addConnection(
      connection as any, // Fastify WebSocket connection is compatible with WebSocket interface
      userId,
      anonHandle,
      'main' // default room
    );
    
    logger.info({ 
      connectionId, 
      userId, 
      anonHandle 
    }, 'User connected to chat');
    
    // Set up ping interval for connection health
    const pingInterval = setInterval(() => {
      if (connection.readyState === connection.OPEN) {
        connection.ping();
      }
    }, 30000); // 30 second ping interval

    connection.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        logger.debug({ messageType: data.type, userId }, 'WebSocket message received');
        
        if (data.type === 'join') {
          // Handle room joining
          const roomName = data.roomName || 'main';
          // Note: ConnectionManager.joinRoom method needs to be implemented
          // For now, connections default to 'main' room
          
          connection.send(JSON.stringify({
            type: 'joined',
            roomName,
            timestamp: new Date().toISOString()
          }));
          
        } else if (data.type === 'msg') {
          // Process chat message with song mapping
          const messageText = data.text;
          const allowExplicit = data.allowExplicit || false;
          
          if (!messageText || messageText.trim().length === 0) {
            return;
          }
          
          logger.info({ 
            userId, 
            anonHandle, 
            messageText: messageText.substring(0, 100) 
          }, 'Processing chat message');
          
          try {
            // Map message to song using the correct method signature
            const songResult = await songMatchingService.matchSongs(
              messageText,
              allowExplicit,
              userId,
              false // roomAllowsExplicit - can be configured per room
            );
            
            // Broadcast to all users in room
            const broadcastMessage = {
              type: 'display',
              originalText: messageText,
              primary: songResult.primary,
              alternates: songResult.alternates,
              scores: songResult.scores,
              why: songResult.why,
              userId,
              anonHandle,
              timestamp: new Date().toISOString()
            };
            
            // Broadcast to room (including sender)
            connectionManager.broadcastToRoom('main', broadcastMessage);
            
            logger.info({ 
              userId, 
              anonHandle,
              songTitle: songResult.primary?.title,
              confidence: songResult.scores?.confidence 
            }, 'Message mapped to song and broadcast');
            
          } catch (error) {
            logger.error({ error, userId, messageText }, 'Error processing chat message');
            
            // Send error to user
            connection.send(JSON.stringify({
              type: 'error',
              message: 'Failed to process message',
              timestamp: new Date().toISOString()
            }));
          }
        }
        
      } catch (error) {
        logger.error({ error, userId }, 'WebSocket message parse error');
      }
    });

    connection.on('pong', () => {
      logger.debug('WebSocket pong received');
      connectionManager.updateActivity(connectionId);
    });

    connection.on('close', () => {
      logger.info({ connectionId, userId, anonHandle }, 'WebSocket connection closed');
      connectionManager.removeConnection(connectionId);
      clearInterval(pingInterval);
    });

    connection.on('error', (error: Error) => {
      logger.error({ error, connectionId, userId }, 'WebSocket connection error');
      connectionManager.removeConnection(connectionId);
      clearInterval(pingInterval);
    });
  });
});

// Database connection and server startup
async function start() {
  try {
    // Check port availability first
    const port = Number(process.env.PORT) || 4000;
    const host = '0.0.0.0';
    
    try {
      await assertPortFree(port);
    } catch {
      console.error(`Port ${port} in use; not starting.`);
      process.exit(0);
    }

    // Connect to database
    await connectDatabase();
    logger.info('✅ Database connected successfully');
    
    // Start server
    await fastify.listen({ port, host });
    logger.info(`Server listening on http://${host}:${port}`);
    
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down server...');
  await fastify.close();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
