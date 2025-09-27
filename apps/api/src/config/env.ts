import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
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

  // Log all available environment variables for debugging
  console.error('Available environment variables:', Object.keys(process.env).filter(key =>
    key.includes('DATABASE') || key.includes('PG') || key.includes('DB') || key.includes('SQL')
  ).map(key => `${key}=${process.env[key]}`).join(', '));

  // If we can't construct it, throw an error
  throw new Error('DATABASE_URL is not set and cannot be constructed from Railway PostgreSQL environment variables');
}

// Lazy-loaded environment configuration - doesn't throw at import time
let cachedEnv: ReturnType<typeof envSchema.parse> | null = null;

export function loadServerEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  try {
    // Parse environment variables
    const rawEnv = { ...process.env };
    rawEnv.DATABASE_URL = getDatabaseUrl();

    cachedEnv = envSchema.parse(rawEnv);
    return cachedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error('Missing/invalid server env: ' + JSON.stringify(error.format()));
    }
    throw error;
  }
}

// For backward compatibility, export a getter that loads on demand
export const env = new Proxy({} as ReturnType<typeof envSchema.parse>, {
  get(_target, prop) {
    const loadedEnv = loadServerEnv();
    return loadedEnv[prop as keyof typeof loadedEnv];
  }
});