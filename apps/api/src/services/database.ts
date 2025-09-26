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
      logger.info('No tables found, creating database schema...');
      
      // Create tables using raw SQL
      await createTables();
      logger.info('✅ Database schema created successfully');
    } else {
      logger.info('Database tables already exist, skipping schema creation');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to create database schema');
    throw error;
  }
}

// Create database tables programmatically
async function createTables() {
  try {
    // Create songs table
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS songs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        year INTEGER,
        popularity INTEGER DEFAULT 0,
        tags TEXT[] DEFAULT '{}',
        phrases TEXT[] DEFAULT '{}',
        mbid TEXT UNIQUE,
        embedding JSONB,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    
    // Create users table
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "anonHandle" TEXT UNIQUE NOT NULL,
        "ipHash" TEXT NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    
    // Create rooms table
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT UNIQUE NOT NULL,
        "allowExplicit" BOOLEAN DEFAULT FALSE,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `;
    
    // Create messages table
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL,
        "roomId" UUID NOT NULL,
        text TEXT NOT NULL,
        "chosenSongId" UUID,
        scores JSONB,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY ("roomId") REFERENCES rooms(id) ON DELETE CASCADE,
        FOREIGN KEY ("chosenSongId") REFERENCES songs(id)
      );
    `;
    
    // Create indexes
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_songs_tags ON songs USING gin(tags);`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_songs_phrases ON songs USING gin(phrases);`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_songs_title_artist ON songs(title, artist);`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_songs_popularity ON songs(popularity);`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year);`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages("userId");`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages("roomId");`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_messages_song_id ON messages("chosenSongId");`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages("createdAt");`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_users_anon_handle ON users("anonHandle");`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_users_ip_hash ON users("ipHash");`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users("createdAt");`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_rooms_name ON rooms(name);`;
    await prisma.$queryRaw`CREATE INDEX IF NOT EXISTS idx_rooms_created_at ON rooms("createdAt");`;
    
    // Insert default room
    await prisma.$queryRaw`
      INSERT INTO rooms (id, name, "allowExplicit", "createdAt")
      VALUES (gen_random_uuid(), 'main', false, NOW())
      ON CONFLICT (name) DO NOTHING;
    `;
    
  } catch (error) {
    logger.error({ error }, 'Failed to create tables');
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