import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { execSync } from 'child_process';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Prevent multiple instances of Prisma Client in development
export const prisma = globalThis.__prisma || new PrismaClient({
  log: ['query', 'error', 'info', 'warn'],
});

if (process.env.NODE_ENV === 'development') {
  globalThis.__prisma = prisma;
}

// Check if database has tables
async function hasTables(): Promise<boolean> {
  try {
    const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    return Number(result[0]?.count || 0) > 0;
  } catch (error) {
    logger.warn({ error }, 'Could not check for existing tables');
    return false;
  }
}

// Run database migrations if needed
async function runMigrationsIfNeeded() {
  try {
    const tablesExist = await hasTables();
    if (!tablesExist) {
      logger.info('No tables found, running database migrations...');
      execSync('npx prisma db push --accept-data-loss', { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
      logger.info('✅ Database migrations completed');
    } else {
      logger.info('Database tables already exist, skipping migrations');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to run database migrations');
    throw error;
  }
}

// Test database connection
export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
    
    // Run migrations in production if database is empty
    if (process.env.NODE_ENV === 'production') {
      await runMigrationsIfNeeded();
    }
  } catch (error) {
    logger.error({ error }, '❌ Database connection failed');
    throw error;
  }
}

// Graceful shutdown
export async function disconnectDatabase() {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from database');
  }
}