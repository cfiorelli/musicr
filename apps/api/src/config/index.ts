import { loadServerEnv } from './env.js';
import { logger } from '../utils/logger.js';

export interface Config {
  server: {
    port: number;
    host: string;
    frontendOrigin: string;
  };
  database: {
    url: string;
  };
  openai?: {
    apiKey: string;
  };
  nodeEnv: 'development' | 'production' | 'test';
}

// Lazy-loaded configuration - doesn't evaluate env at import time
let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = loadServerEnv();

  cachedConfig = {
    server: {
      port: env.PORT,
      host: env.HOST,
      frontendOrigin: env.FRONTEND_ORIGIN,
    },
    database: {
      url: env.DATABASE_URL,
    },
    openai: env.OPENAI_API_KEY ? {
      apiKey: env.OPENAI_API_KEY,
    } : undefined,
    nodeEnv: env.NODE_ENV,
  };

  // Log configuration on startup
  logger.info({
    server: {
      port: cachedConfig.server.port,
      host: cachedConfig.server.host,
      frontendOrigin: cachedConfig.server.frontendOrigin,
    },
    nodeEnv: cachedConfig.nodeEnv,
    hasOpenAIKey: !!cachedConfig.openai?.apiKey,
  }, 'Configuration loaded');

  return cachedConfig;
}

// For backward compatibility, export a getter that loads on demand
export const config = new Proxy({} as Config, {
  get(_target, prop) {
    const loadedConfig = loadConfig();
    return loadedConfig[prop as keyof typeof loadedConfig];
  }
});

// Export loadServerEnv for direct access if needed
export { loadServerEnv as env };
export { logger } from '../utils/logger.js';