import { logger } from '../config/index.js';
import { 
  Embedder, 
  EmbeddingServiceConfig, 
  EmbedderProvider,
  EmbeddingError,
  LocalEmbedderConfig
} from './types.js';
import { OpenAIEmbedder } from './providers/openai.js';
import { LocalEmbedder } from './providers/local.js';

export class EmbeddingService {
  private primaryEmbedder: Embedder | null = null;
  private fallbackEmbedder: Embedder | null = null;
  private config: EmbeddingServiceConfig;

  constructor(config: EmbeddingServiceConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info({
      primary: this.config.primaryProvider,
      fallback: this.config.fallbackProvider
    }, 'Initializing embedding service');

    // Initialize primary embedder
    this.primaryEmbedder = await this.createEmbedder(
      this.config.primaryProvider,
      this.config
    );

    // Initialize fallback embedder if configured
    if (this.config.fallbackProvider) {
      try {
        this.fallbackEmbedder = await this.createEmbedder(
          this.config.fallbackProvider,
          this.config
        );
      } catch (error) {
        logger.warn({ 
          error, 
          provider: this.config.fallbackProvider 
        }, 'Failed to initialize fallback embedder');
      }
    }

    logger.info('Embedding service initialized');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }

    // Try primary embedder first
    if (this.primaryEmbedder) {
      try {
        const isAvailable = await this.primaryEmbedder.isAvailable();
        if (isAvailable) {
          logger.debug({
            provider: this.config.primaryProvider,
            textsCount: texts.length
          }, 'Using primary embedder');
          
          return await this.primaryEmbedder.embed(texts);
        }
      } catch (error) {
        logger.warn({
          error,
          provider: this.config.primaryProvider,
          textsCount: texts.length
        }, 'Primary embedder failed, trying fallback');
      }
    }

    // Try fallback embedder
    if (this.fallbackEmbedder) {
      try {
        const isAvailable = await this.fallbackEmbedder.isAvailable();
        if (isAvailable) {
          logger.info({
            provider: this.config.fallbackProvider,
            textsCount: texts.length
          }, 'Using fallback embedder');
          
          return await this.fallbackEmbedder.embed(texts);
        }
      } catch (error) {
        logger.error({
          error,
          provider: this.config.fallbackProvider,
          textsCount: texts.length
        }, 'Fallback embedder failed');
      }
    }

    throw new EmbeddingError(
      'All embedding providers failed',
      this.config.primaryProvider
    );
  }

  async embedSingle(text: string): Promise<number[]> {
    const embeddings = await this.embed([text]);
    return embeddings[0];
  }

  getActiveModel(): string {
    return this.primaryEmbedder?.getModel() || 'unknown';
  }

  getActiveDimensions(): number {
    return this.primaryEmbedder?.getDimensions() || 0;
  }

  async getStatus(): Promise<{
    primary: { provider: EmbedderProvider; model: string; available: boolean };
    fallback?: { provider: EmbedderProvider; model: string; available: boolean };
  }> {
    const status: any = {
      primary: {
        provider: this.config.primaryProvider,
        model: this.primaryEmbedder?.getModel() || 'unknown',
        available: this.primaryEmbedder ? await this.primaryEmbedder.isAvailable() : false
      }
    };

    if (this.fallbackEmbedder && this.config.fallbackProvider) {
      status.fallback = {
        provider: this.config.fallbackProvider,
        model: this.fallbackEmbedder.getModel(),
        available: await this.fallbackEmbedder.isAvailable()
      };
    }

    return status;
  }

  private async createEmbedder(
    provider: EmbedderProvider, 
    config: EmbeddingServiceConfig
  ): Promise<Embedder> {
    switch (provider) {
      case 'openai':
        if (!config.openai) {
          throw new EmbeddingError('OpenAI config required', provider);
        }
        return new OpenAIEmbedder(config.openai);

      case 'local':
        const localConfig: LocalEmbedderConfig = config.local || {
          model: 'Xenova/all-MiniLM-L6-v2',
          dimensions: 384
        };
        return new LocalEmbedder(localConfig);

      default:
        throw new EmbeddingError(`Unknown provider: ${provider}`, provider);
    }
  }
}

/**
 * Global embedding service instance
 */
let embeddingService: EmbeddingService | null = null;

export async function getEmbeddingService(config?: EmbeddingServiceConfig): Promise<EmbeddingService> {
  if (!embeddingService) {
    if (!config) {
      throw new Error('Embedding service config required for initialization');
    }
    
    embeddingService = new EmbeddingService(config);
    await embeddingService.initialize();
  }
  
  return embeddingService;
}

export function resetEmbeddingService(): void {
  embeddingService = null;
}