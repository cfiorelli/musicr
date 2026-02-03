/**
 * API Schemas with Zod validation
 * 
 * Defines request/response schemas for HTTP endpoints with validation
 */

import { z } from 'zod';

// Map endpoint schemas
export const MapRequestSchema = z.object({
  text: z.string().min(1, 'Text is required').max(1000, 'Text too long'),
  allowExplicit: z.boolean().optional().default(false),
  userId: z.string().uuid().optional(), // Optional for analytics
});

export const SongSchema = z.object({
  title: z.string(),
  artist: z.string(),
  year: z.number().optional(),
});

export const AlternateSchema = z.object({
  title: z.string(),
  artist: z.string(),
  year: z.number().optional(),
  score: z.number(),
});

export const WhySchema = z.object({
  matchedPhrase: z.string().optional(),
  mood: z.string().optional(),
  similarity: z.number().optional(),
});

export const MapResponseSchema = z.object({
  primary: SongSchema,
  alternates: z.array(AlternateSchema),
  scores: z.object({
    confidence: z.number(),
    strategy: z.string(),
    reasoning: z.string(),
  }),
  why: z.string(),
  metadata: z.object({
    processingTime: z.number(),
    timestamp: z.string(),
    totalCandidates: z.number().optional(),
    debug: z.any().optional(), // Instance fingerprint when DEBUG_MATCHING=1
  }),
});

// Search endpoint schemas
export const SearchRequestSchema = z.object({
  q: z.string().min(1, 'Query parameter "q" is required'),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  strategy: z.enum(['exact', 'phrase', 'embedding', 'all']).optional().default('all'),
  allowExplicit: z.boolean().optional().default(false),
});

export const SearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  year: z.number().optional(),
  popularity: z.number(),
  tags: z.array(z.string()),
  phrases: z.array(z.string()),
  matchType: z.enum(['title', 'artist', 'phrase', 'tag', 'embedding']).optional(),
  score: z.number().optional(),
});

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  metadata: z.object({
    query: z.string(),
    strategy: z.string(),
    total: z.number(),
    limit: z.number(),
    processingTime: z.number(),
    timestamp: z.string(),
  }),
});

// Error response schema
export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
  timestamp: z.string(),
  details: z.record(z.any()).optional(),
});

// Type exports
export type MapRequest = z.infer<typeof MapRequestSchema>;
export type MapResponse = z.infer<typeof MapResponseSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Validation helpers
export function validateMapRequest(data: unknown): MapRequest {
  return MapRequestSchema.parse(data);
}

export function validateSearchRequest(data: unknown): SearchRequest {
  return SearchRequestSchema.parse(data);
}

export function createErrorResponse(error: string, message: string, statusCode: number = 400): ErrorResponse {
  return {
    error,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
  };
}