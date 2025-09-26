/**
 * Room Management Service
 * 
 * Handles room creation, retrieval, and management for real-time chat.
 * Ensures default 'main' room exists for MVP functionality.
 */

import { PrismaClient, Room } from '@prisma/client';
import { logger } from '../config/index.js';

export class RoomService {
  private prisma: PrismaClient;
  private readonly DEFAULT_ROOM_NAME = 'main';

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Initialize the service and ensure default room exists
   */
  async initialize(): Promise<void> {
    await this.ensureDefaultRoom();
    logger.info('Room service initialized with default room');
  }

  /**
   * Get the default main room
   */
  async getDefaultRoom(): Promise<Room> {
    const room = await this.prisma.room.findUnique({
      where: { name: this.DEFAULT_ROOM_NAME }
    });

    if (!room) {
      throw new Error('Default room not found. Service not properly initialized.');
    }

    return room;
  }

  /**
   * Get room by ID
   */
  async getRoomById(roomId: string): Promise<Room | null> {
    try {
      return await this.prisma.room.findUnique({
        where: { id: roomId }
      });
    } catch (error) {
      logger.error({ error, roomId }, 'Error getting room by ID');
      return null;
    }
  }

  /**
   * Get room by name
   */
  async getRoomByName(name: string): Promise<Room | null> {
    try {
      return await this.prisma.room.findUnique({
        where: { name }
      });
    } catch (error) {
      logger.error({ error, name }, 'Error getting room by name');
      return null;
    }
  }

  /**
   * Create a new room
   */
  async createRoom(name: string, allowExplicit: boolean = false): Promise<Room> {
    try {
      const room = await this.prisma.room.create({
        data: {
          name,
          allowExplicit
        }
      });

      logger.info({
        roomId: room.id,
        name: room.name,
        allowExplicit: room.allowExplicit
      }, 'Room created successfully');

      return room;
    } catch (error) {
      logger.error({ error, name, allowExplicit }, 'Error creating room');
      throw error;
    }
  }

  /**
   * List all rooms
   */
  async getAllRooms(): Promise<Room[]> {
    try {
      return await this.prisma.room.findMany({
        orderBy: { createdAt: 'asc' }
      });
    } catch (error) {
      logger.error({ error }, 'Error getting all rooms');
      return [];
    }
  }

  /**
   * Delete a room (except default room)
   */
  async deleteRoom(roomId: string): Promise<boolean> {
    try {
      const room = await this.getRoomById(roomId);
      if (!room) {
        logger.warn({ roomId }, 'Attempted to delete non-existent room');
        return false;
      }

      if (room.name === this.DEFAULT_ROOM_NAME) {
        logger.warn({ roomId, name: room.name }, 'Cannot delete default room');
        return false;
      }

      await this.prisma.room.delete({
        where: { id: roomId }
      });

      logger.info({ roomId, name: room.name }, 'Room deleted successfully');
      return true;
    } catch (error) {
      logger.error({ error, roomId }, 'Error deleting room');
      return false;
    }
  }

  /**
   * Get room statistics
   */
  async getRoomStats(roomId: string): Promise<{
    messageCount: number;
    uniqueUsers: number;
    lastActivity?: Date;
  } | null> {
    try {
      const room = await this.getRoomById(roomId);
      if (!room) return null;

      const [messageCount, uniqueUsersResult, lastMessage] = await Promise.all([
        this.prisma.message.count({
          where: { roomId }
        }),
        this.prisma.message.findMany({
          where: { roomId },
          select: { userId: true },
          distinct: ['userId']
        }),
        this.prisma.message.findFirst({
          where: { roomId },
          orderBy: { createdAt: 'desc' }
        })
      ]);

      return {
        messageCount,
        uniqueUsers: uniqueUsersResult.length,
        lastActivity: lastMessage?.createdAt
      };
    } catch (error) {
      logger.error({ error, roomId }, 'Error getting room statistics');
      return null;
    }
  }

  /**
   * Ensure the default room exists
   */
  private async ensureDefaultRoom(): Promise<void> {
    try {
      const existingRoom = await this.getRoomByName(this.DEFAULT_ROOM_NAME);
      
      if (!existingRoom) {
        await this.createRoom(this.DEFAULT_ROOM_NAME, false);
        logger.info(`Default room '${this.DEFAULT_ROOM_NAME}' created`);
      } else {
        logger.debug(`Default room '${this.DEFAULT_ROOM_NAME}' already exists`);
      }
    } catch (error) {
      logger.error({ error }, 'Error ensuring default room exists');
      throw error;
    }
  }
}