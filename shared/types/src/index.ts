// WebSocket message types
export interface WSMessage {
  type: 'message' | 'error' | 'ping' | 'pong';
  data?: unknown;
  timestamp?: string;
}

export interface ChatMessage {
  id: string;
  content: string;
  songTitle?: string;
  userId: string;
  timestamp: string;
}

export interface UserMessage extends WSMessage {
  type: 'message';
  data: {
    message: string;
    userId?: string;
  };
}

export interface ServerResponse extends WSMessage {
  type: 'message';
  data: {
    originalMessage: string;
    songTitle: string;
    userId: string;
  };
}

export interface ErrorMessage extends WSMessage {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// User types
export interface User {
  id: string;
  nickname?: string;
  createdAt: string;
  updatedAt: string;
}

// Database types (matches Prisma schema)
export interface Message {
  id: string;
  content: string;
  songTitle?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// Song conversion types
export interface SongConversionResult {
  originalMessage: string;
  songTitle: string;
  confidence: number;
  method: 'openai' | 'huggingface' | 'fallback';
}

// Configuration types
export interface Config {
  server: {
    port: number;
    host: string;
  };
  database: {
    url: string;
  };
  openai?: {
    apiKey: string;
    model: string;
  };
  websocket: {
    heartbeatInterval: number;
  };
}