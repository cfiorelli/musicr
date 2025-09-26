import OpenAI from 'openai';
import { logger } from '../../config/index.js';
import { 
  Embedder, 
  OpenAIEmbedderConfig, 
  EmbeddingError 
} from '../types.js';

export class OpenAIEmbedder implements Embedder {
  private client: OpenAI;
  private config: OpenAIEmbedderConfig;

  constructor(config: OpenAIEmbedderConfig) {
    const defaults = {
      model: 'text-embedding-3-small',
      dimensions: 1536, // Default for text-embedding-3-small
      maxTokens: 8192,
      batchSize: 100
    };

    this.config = {
      ...defaults,
      ...config
    };

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }

    try {
      // Process in batches to avoid rate limits
      const batches = this.batchTexts(texts, this.config.batchSize || 100);
      const allEmbeddings: number[][] = [];

      for (const batch of batches) {
        const response = await this.client.embeddings.create({
          model: this.config.model,
          input: batch,
          dimensions: this.config.dimensions,
        });

        const batchEmbeddings = response.data.map(item => item.embedding);
        allEmbeddings.push(...batchEmbeddings);

        // Log usage for monitoring
        if (response.usage) {
          logger.debug({
            provider: 'openai',
            model: this.config.model,
            tokens: response.usage.total_tokens,
            texts: batch.length
          }, 'Generated embeddings');
        }

        // Rate limiting courtesy delay
        if (batches.length > 1) {
          await this.delay(100);
        }
      }

      return allEmbeddings;
    } catch (error) {
      logger.error({ error, textsCount: texts.length }, 'OpenAI embedding failed');
      throw new EmbeddingError(
        `OpenAI embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'openai',
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
    return this.config.dimensions;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test with a simple embedding
      await this.client.embeddings.create({
        model: this.config.model,
        input: 'test',
        dimensions: this.config.dimensions,
      });
      return true;
    } catch (error) {
      logger.warn({ error }, 'OpenAI embedder availability check failed');
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}