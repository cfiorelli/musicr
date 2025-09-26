/**
 * Room Configuration Examples
 * 
 * This file demonstrates how to configure different room types with 
 * explicit content filtering and family-friendly settings.
 */

import { SongRecommendationPipeline } from './pipeline.js';
import type { RoomConfig } from './pipeline.js';

// Example room configurations for different use cases
export const roomConfigurations = {
  
  // Default room - allows all content
  default: {
    allowExplicit: true,
    familyFriendlyMode: false
  } as RoomConfig,
  
  // Family-friendly room - filters explicit content, prefers radio edits
  familyFriendly: {
    allowExplicit: false,
    familyFriendlyMode: true
  } as RoomConfig,
  
  // School/workplace - strict filtering
  school: {
    allowExplicit: false, 
    familyFriendlyMode: true
  } as RoomConfig,
  
  // Teen room - allows mild content but filters explicit
  teen: {
    allowExplicit: false,
    familyFriendlyMode: false
  } as RoomConfig,
  
  // Adult room - allows all content
  adult: {
    allowExplicit: true,
    familyFriendlyMode: false
  } as RoomConfig
};

/**
 * Create a pipeline with room-specific configuration
 */
export function createPipelineForRoom(
  prisma: any,
  _roomType: keyof typeof roomConfigurations
): SongRecommendationPipeline {
  const pipeline = new SongRecommendationPipeline(prisma);
  return pipeline;
}

/**
 * Generate recommendations with room context
 */
export async function getRecommendationsForRoom(
  pipeline: SongRecommendationPipeline,
  message: string,
  roomType: keyof typeof roomConfigurations,
  userId?: string,
  recentSongs?: string[]
) {
  const roomConfig = roomConfigurations[roomType];
  
  return await pipeline.generateCandidates(message, {
    userId,
    recentSongs,
    roomConfig
  });
}

/**
 * Example usage patterns
 */
export const usageExamples = {
  
  // Family room example
  async familyRoom(pipeline: SongRecommendationPipeline, message: string) {
    return await pipeline.generateCandidates(message, {
      roomConfig: {
        allowExplicit: false,
        familyFriendlyMode: true
      }
    });
  },
  
  // Adult chat room example  
  async adultRoom(pipeline: SongRecommendationPipeline, message: string) {
    return await pipeline.generateCandidates(message, {
      roomConfig: {
        allowExplicit: true,
        familyFriendlyMode: false
      }
    });
  },
  
  // User with history example
  async withUserContext(
    pipeline: SongRecommendationPipeline, 
    message: string, 
    userId: string,
    recentlyPlayed: string[]
  ) {
    return await pipeline.generateCandidates(message, {
      userId,
      recentSongs: recentlyPlayed,
      roomConfig: {
        allowExplicit: false,  // Safe default
        familyFriendlyMode: true
      }
    });
  }
};