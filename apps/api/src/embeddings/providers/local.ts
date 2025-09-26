import { pipeline } from '@xenova/transformers';
import { logger } from '../../config/index.js';
import { 
  Embedder, 
  LocalEmbedderConfig, 
  EmbeddingError 
} from '../types.js';

export class LocalEmbedder implements Embedder {
  private config: LocalEmbedderConfig;
  private pipeline: any = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(config: LocalEmbedderConfig) {
    const defaults = {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384, // all-MiniLM-L6-v2 default
      pooling: 'mean' as const,
      normalize: true,
      batchSize: 32
    };

    this.config = {
      ...defaults,
      ...config
    };
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._initialize();
    return this.initializationPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      logger.info({ model: this.config.model }, 'Initializing local embedder');
      
      this.pipeline = await pipeline('feature-extraction', this.config.model);

      this.isInitialized = true;
      logger.info({ model: this.config.model }, 'Local embedder initialized');
    } catch (error) {
      logger.error({ error, model: this.config.model }, 'Failed to initialize local embedder');
      throw new EmbeddingError(
        `Failed to initialize local embedder: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'local',
        error instanceof Error ? error : undefined
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }

    await this.initialize();

    if (!this.pipeline) {
      throw new EmbeddingError('Local embedder not initialized', 'local');
    }

    try {
      // Process in batches to manage memory usage
      const batches = this.batchTexts(texts, this.config.batchSize || 32);
      const allEmbeddings: number[][] = [];

      for (const batch of batches) {
        logger.debug({ 
          model: this.config.model,
          batchSize: batch.length,
          totalBatches: batches.length 
        }, 'Processing local embedding batch');

        // Get embeddings from the pipeline
        const output = await this.pipeline(batch);

        // Convert tensor output to number arrays
        const batchEmbeddings = this.tensorToArrays(output);
        allEmbeddings.push(...batchEmbeddings);
      }

      logger.debug({
        model: this.config.model,
        textsCount: texts.length,
        embeddingsCount: allEmbeddings.length
      }, 'Generated local embeddings');

      return allEmbeddings;
    } catch (error) {
      logger.error({ error, textsCount: texts.length }, 'Local embedding failed');
      throw new EmbeddingError(
        `Local embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'local',
        error instanceof Error ? error : undefined
      );
    }
  }

  async embedSingle(text: string): Promise<number[]> {
    const embeddings = await this.embed([text]);
    return embeddings[0];
  }

  getModel(): string {
    return this.config.model;
  }

  getDimensions(): number {
    // all-MiniLM-L6-v2 produces 384-dimensional embeddings
    return 384;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.initialize();
      
      // Test with a simple embedding
      if (this.pipeline) {
        await this.pipeline('test');
        return true;
      }
      return false;
    } catch (error) {
      logger.warn({ error }, 'Local embedder availability check failed');
      return false;
    }
  }

  private batchTexts(texts: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }
    return batches;
  }

  private tensorToArrays(output: any): number[][] {
    // Handle the tensor output from @xenova/transformers
    // The output structure can vary, so we need to be flexible
    
    if (output?.data && Array.isArray(output.data)) {
      // Single embedding case
      return [Array.from(output.data)];
    }
    
    if (Array.isArray(output)) {
      // Multiple embeddings case
      return output.map(item => {
        if (item?.data && Array.isArray(item.data)) {
          return Array.from(item.data);
        }
        if (Array.isArray(item)) {
          return Array.from(item);
        }
        return item;
      });
    }

    // Fallback: try to convert directly
    if (output && typeof output.tolist === 'function') {
      return output.tolist();
    }

    throw new Error('Unexpected tensor output format');
  }
}