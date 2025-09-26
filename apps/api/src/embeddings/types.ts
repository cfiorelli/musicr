/**
 * Core embedding system interfaces and types
 */

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage?: {
    totalTokens: number;
    promptTokens: number;
  };
}

export interface Embedder {
  /**
   * Generate embeddings for multiple texts
   */
  embed(texts: string[]): Promise<number[][]>;
  
  /**
   * Generate embedding for a single text
   */
  embedSingle(text: string): Promise<number[]>;
  
  /**
   * Get the model name
   */
  getModel(): string;
  
  /**
   * Get the embedding dimensions
   */
  getDimensions(): number;
  
  /**
   * Check if the embedder is available/initialized
   */
  isAvailable(): Promise<boolean>;
}

export interface EmbedderConfig {
  model: string;
  dimensions: number;
  maxTokens?: number;
  batchSize?: number;
}

export interface OpenAIEmbedderConfig extends EmbedderConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface LocalEmbedderConfig extends EmbedderConfig {
  device?: 'cpu' | 'gpu';
  quantized?: boolean;
  pooling?: 'mean' | 'cls';
  normalize?: boolean;
}

export type EmbedderProvider = 'openai' | 'local';

export interface EmbeddingServiceConfig {
  primaryProvider: EmbedderProvider;
  fallbackProvider?: EmbedderProvider;
  openai?: OpenAIEmbedderConfig;
  local?: LocalEmbedderConfig;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public provider: EmbedderProvider,
    public cause?: Error
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Vector similarity utilities
 */
export interface SimilarityResult {
  similarity: number;
  distance: number;
}

export type SimilarityMetric = 'cosine' | 'euclidean' | 'dot';

export interface VectorUtils {
  cosineSimilarity(a: number[], b: number[]): number;
  euclideanDistance(a: number[], b: number[]): number;
  dotProduct(a: number[], b: number[]): number;
  normalize(vector: number[]): number[];
  magnitude(vector: number[]): number;
}