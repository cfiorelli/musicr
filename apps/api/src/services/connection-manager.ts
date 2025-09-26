/**
 * WebSocket Connection Manager
 * 
 * Manages WebSocket connections, room assignments, and message broadcasting
 * for the real-time chat system.
 */

import type { WebSocket } from 'ws';
import { logger } from '../config/index.js';

interface Connection {
  id: string;
  socket: WebSocket;
  userId: string;
  anonHandle: string;
  roomId: string;
  joinedAt: Date;
  lastActivity: Date;
}

interface BroadcastMessage {
  type: string;
  [key: string]: any;
}

export class ConnectionManager {
  private connections: Map<string, Connection> = new Map();
  private roomConnections: Map<string, Set<string>> = new Map();
  private userConnections: Map<string, string> = new Map(); // userId -> connectionId
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup stale connections every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 30000);

    logger.info('Connection manager initialized');
  }

  /**
   * Add a new WebSocket connection
   */
  addConnection(
    socket: WebSocket,
    userId: string,
    anonHandle: string,
    roomId: string
  ): string {
    const connectionId = this.generateConnectionId();
    
    const connection: Connection = {
      id: connectionId,
      socket,
      userId,
      anonHandle,
      roomId,
      joinedAt: new Date(),
      lastActivity: new Date()
    };

    // Store connection mappings
    this.connections.set(connectionId, connection);
    this.userConnections.set(userId, connectionId);

    // Add to room
    if (!this.roomConnections.has(roomId)) {
      this.roomConnections.set(roomId, new Set());
    }
    this.roomConnections.get(roomId)!.add(connectionId);

    // Setup connection event handlers
    this.setupConnectionHandlers(connection);

    logger.info({
      connectionId,
      userId,
      anonHandle,
      roomId,
      totalConnections: this.connections.size
    }, 'WebSocket connection added');

    // Notify room about new user
    this.broadcastToRoom(roomId, {
      type: 'user_joined',
      user: {
        id: userId,
        handle: anonHandle
      },
      timestamp: new Date().toISOString()
    }, connectionId);

    return connectionId;
  }

  /**
   * Remove a connection
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Remove from room
    const roomConnections = this.roomConnections.get(connection.roomId);
    if (roomConnections) {
      roomConnections.delete(connectionId);
      if (roomConnections.size === 0) {
        this.roomConnections.delete(connection.roomId);
      }
    }

    // Remove user mapping
    this.userConnections.delete(connection.userId);
    
    // Remove connection
    this.connections.delete(connectionId);

    logger.info({
      connectionId,
      userId: connection.userId,
      anonHandle: connection.anonHandle,
      roomId: connection.roomId,
      totalConnections: this.connections.size
    }, 'WebSocket connection removed');

    // Notify room about user leaving
    this.broadcastToRoom(connection.roomId, {
      type: 'user_left',
      user: {
        id: connection.userId,
        handle: connection.anonHandle
      },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Update connection activity timestamp
   */
  updateActivity(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastActivity = new Date();
    }
  }

  /**
   * Send message to a specific connection
   */
  sendToConnection(connectionId: string, message: BroadcastMessage): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.socket.readyState !== 1) {
      return false;
    }

    try {
      connection.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.warn({ error, connectionId }, 'Failed to send message to connection');
      this.removeConnection(connectionId);
      return false;
    }
  }

  /**
   * Send message to a specific user
   */
  sendToUser(userId: string, message: BroadcastMessage): boolean {
    const connectionId = this.userConnections.get(userId);
    if (!connectionId) return false;

    return this.sendToConnection(connectionId, message);
  }

  /**
   * Broadcast message to all connections in a room
   */
  broadcastToRoom(roomId: string, message: BroadcastMessage, excludeConnectionId?: string): number {
    const roomConnections = this.roomConnections.get(roomId);
    if (!roomConnections || roomConnections.size === 0) {
      return 0;
    }

    let sentCount = 0;
    const failedConnections: string[] = [];

    for (const connectionId of roomConnections) {
      if (connectionId === excludeConnectionId) continue;

      if (this.sendToConnection(connectionId, message)) {
        sentCount++;
      } else {
        failedConnections.push(connectionId);
      }
    }

    // Clean up failed connections
    failedConnections.forEach(connectionId => this.removeConnection(connectionId));

    logger.debug({
      roomId,
      sentCount,
      totalInRoom: roomConnections.size,
      messageType: message.type
    }, 'Broadcasted message to room');

    return sentCount;
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): Connection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get connection by user ID
   */
  getConnectionByUser(userId: string): Connection | undefined {
    const connectionId = this.userConnections.get(userId);
    return connectionId ? this.connections.get(connectionId) : undefined;
  }

  /**
   * Get all connections in a room
   */
  getRoomConnections(roomId: string): Connection[] {
    const connectionIds = this.roomConnections.get(roomId);
    if (!connectionIds) return [];

    return Array.from(connectionIds)
      .map(id => this.connections.get(id))
      .filter(Boolean) as Connection[];
  }

  /**
   * Get room statistics
   */
  getRoomStats(roomId: string): {
    connectionCount: number;
    uniqueUsers: number;
    connections: Array<{ userId: string; handle: string; joinedAt: Date }>;
  } {
    const connections = this.getRoomConnections(roomId);
    
    return {
      connectionCount: connections.length,
      uniqueUsers: new Set(connections.map(c => c.userId)).size,
      connections: connections.map(c => ({
        userId: c.userId,
        handle: c.anonHandle,
        joinedAt: c.joinedAt
      }))
    };
  }

  /**
   * Get overall statistics
   */
  getStats(): {
    totalConnections: number;
    totalRooms: number;
    roomStats: Record<string, { connections: number; users: number }>;
  } {
    const roomStats: Record<string, { connections: number; users: number }> = {};

    for (const [roomId, connectionIds] of this.roomConnections) {
      const connections = Array.from(connectionIds)
        .map(id => this.connections.get(id))
        .filter(Boolean) as Connection[];

      roomStats[roomId] = {
        connections: connections.length,
        users: new Set(connections.map(c => c.userId)).size
      };
    }

    return {
      totalConnections: this.connections.size,
      totalRooms: this.roomConnections.size,
      roomStats
    };
  }

  /**
   * Shutdown the connection manager
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
    
    // Close all connections
    for (const connection of this.connections.values()) {
      try {
        connection.socket.close();
      } catch (error) {
        // Ignore errors during shutdown
      }
    }

    this.connections.clear();
    this.roomConnections.clear();
    this.userConnections.clear();

    logger.info('Connection manager shutdown complete');
  }

  /**
   * Setup event handlers for a connection
   */
  private setupConnectionHandlers(connection: Connection): void {
    connection.socket.on('close', () => {
      this.removeConnection(connection.id);
    });

    connection.socket.on('error', (error: Error) => {
      logger.warn({ 
        error, 
        connectionId: connection.id,
        userId: connection.userId 
      }, 'WebSocket connection error');
      this.removeConnection(connection.id);
    });

    // Update activity on any message
    connection.socket.on('message', () => {
      this.updateActivity(connection.id);
    });
  }

  /**
   * Clean up stale connections
   */
  private cleanupStaleConnections(): void {
    const now = new Date();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const staleConnections: string[] = [];

    for (const [connectionId, connection] of this.connections) {
      const timeSinceActivity = now.getTime() - connection.lastActivity.getTime();
      
      if (timeSinceActivity > staleThreshold || connection.socket.readyState !== 1) {
        staleConnections.push(connectionId);
      }
    }

    if (staleConnections.length > 0) {
      logger.info({ 
        staleCount: staleConnections.length 
      }, 'Cleaning up stale connections');

      staleConnections.forEach(connectionId => this.removeConnection(connectionId));
    }
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}