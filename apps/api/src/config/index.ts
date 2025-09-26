import { env } from './env.js';
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

export const config: Config = {
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

// Export env as well for direct access
export { env };
export { logger } from '../utils/logger.js';

// Log configuration on startup
logger.info({
  server: {
    port: config.server.port,
    host: config.server.host,
    frontendOrigin: config.server.frontendOrigin,
  },
  nodeEnv: config.nodeEnv,
  hasOpenAIKey: !!config.openai?.apiKey,
}, 'Configuration loaded');