/**
 * Prisma type definitions
 * Manually defined based on schema to ensure type safety
 * Updated: 2025-09-26 - Force Railway rebuild
 */

// Base model types
export interface Song {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  popularity: number;
  tags: string[];
  phrases: string[];
  mbid: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  anonHandle: string;
  ipHash: string;
  createdAt: Date;
}

export interface Room {
  id: string;
  name: string;
  allowExplicit: boolean;
  createdAt: Date;
}

export interface Message {
  id: string;
  userId: string;
  roomId: string;
  text: string;
  chosenSongId: string | null;
  scores: any;
  createdAt: Date;
}

// Create input types
export interface SongCreate {
  title: string;
  artist: string;
  year?: number | null;
  popularity?: number;
  tags?: string[];
  phrases?: string[];
  mbid?: string | null;
}

export interface UserCreate {
  anonHandle: string;
  ipHash: string;
}

export interface RoomCreate {
  name: string;
  allowExplicit?: boolean;
}

export interface MessageCreate {
  userId: string;
  roomId: string;
  text: string;
  chosenSongId?: string | null;
  scores?: any;
}