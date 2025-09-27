import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { config, logger } from './config/index.js';
import { connectDatabase, disconnectDatabase, prisma } from './services/database.js';
import { RoomService } from './services/room-service.js';
import { SongMatchingService } from './services/song-matching-service.js';
import net from 'net';

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

// Initialize services (will be initialized after database connection)
let roomService: RoomService;
let songMatchingService: SongMatchingService;

// Health endpoint for container orchestration
fastify.get('/health', async (_, reply) => {
  const startTime = Date.now();
  
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1 as health_check`;
    
    const responseTime = Date.now() - startTime;
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: config.nodeEnv,
      services: {
        database: 'healthy'
      },
      performance: {
        responseTime: `${responseTime}ms`,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          limit: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
      }
    };
    
    return reply.code(200).send(health);
      
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

// POST /api/map - Song mapping endpoint
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

async function start() {
  try {
    // Load configuration first (lazy loading)
    const { loadConfig } = await import('./config/index.js');
    loadConfig();

    // Check port availability first
    const port = Number(process.env.PORT) || 4000;
    const host = '0.0.0.0';
    
    try {
      await assertPortFree(port);
    } catch {
      console.error(`Port ${port} in use; not starting.`);
      process.exit(0);
    }

    // Connect to database (this will run migrations if needed)
    await connectDatabase();
    logger.info('✅ Database connected successfully');
    
    // Initialize services AFTER database is ready
    roomService = new RoomService(prisma);
    songMatchingService = new SongMatchingService(prisma);

    // Initialize room service (this will create default room)
    await roomService.initialize();
    
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
