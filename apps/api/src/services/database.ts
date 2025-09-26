import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

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

// Test database connection
export async function connectDatabase() {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
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