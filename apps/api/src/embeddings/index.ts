/**
 * Embedding subsystem - Pluggable provider interface for generating text embeddings
 * 
 * This module provides a unified interface for generating embeddings using different
 * providers (OpenAI, local models) with automatic fallback capabilities.
 */

// Core interfaces and types
export * from './types.js';

// Embedding providers
export { OpenAIEmbedder } from './providers/openai.js';
export { LocalEmbedder } from './providers/local.js';

// Main service with fallback logic
export { EmbeddingService, getEmbeddingService, resetEmbeddingService } from './service.js';

// Vector utilities and similarity functions
export { VectorUtilities, vectorUtils, cosineSimilarity, euclideanDistance, dotProduct, normalize, magnitude } from './utils.js';