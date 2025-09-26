/**
 * Prisma type definitions
 * Inferred from the Prisma client to ensure type safety
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Infer types from the Prisma client
export type Song = Awaited<ReturnType<typeof prisma.song.findFirstOrThrow>>;
export type User = Awaited<ReturnType<typeof prisma.user.findFirstOrThrow>>;
export type Room = Awaited<ReturnType<typeof prisma.room.findFirstOrThrow>>;
export type Message = Awaited<ReturnType<typeof prisma.message.findFirstOrThrow>>;

// Utility types for creating new records
export type SongCreate = Parameters<typeof prisma.song.create>[0]['data'];
export type UserCreate = Parameters<typeof prisma.user.create>[0]['data'];
export type RoomCreate = Parameters<typeof prisma.room.create>[0]['data'];
export type MessageCreate = Parameters<typeof prisma.message.create>[0]['data'];