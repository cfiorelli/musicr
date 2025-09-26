import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { config, logger } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './services/database.js';
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

    // Connect to database (this will run migrations if needed)
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
