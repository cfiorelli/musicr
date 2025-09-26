import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('localhost'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  OPENAI_API_KEY: z.string().optional(),
});

// Helper function to construct DATABASE_URL from Railway's PostgreSQL environment variables
function getDatabaseUrl(): string {
  // If DATABASE_URL is already set, use it
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Try to construct from Railway's PostgreSQL environment variables
  const host = process.env.PGHOST;
  const port = process.env.PGPORT;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;

  if (host && port && database && user && password) {
    return `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }

  // If we can't construct it, throw an error
  throw new Error('DATABASE_URL is not set and cannot be constructed from Railway PostgreSQL environment variables');
}

// Parse environment variables
const rawEnv = { ...process.env };
rawEnv.DATABASE_URL = getDatabaseUrl();

export const env = envSchema.parse(rawEnv);