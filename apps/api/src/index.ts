import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import cookie from '@fastify/cookie';
import { config, logger } from './config/index.js';
import { connectDatabase, disconnectDatabase, prisma } from './services/database.js';
import { UserService } from './services/user-service.js';
import { RoomService } from './services/room-service.js';
import { SongMatchingService } from './services/song-matching-service.js';
import { SongSearchService } from './services/song-search-service.js';
import { ConnectionManager } from './services/connection-manager.js';
import { redisService } from './services/redis-service.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { getEmbeddingService } from './embeddings/index.js';
import {
  validateMapRequest,
  validateSearchRequest,
  createErrorResponse,
  MapResponse,
  SearchResponse
} from './schemas/api.js';
import { getInstanceFingerprint, createRequestFingerprint } from './utils/fingerprint.js';
import { nanoid } from 'nanoid';
import os from 'os';

// Instance fingerprint for split-brain detection
const INSTANCE_ID = `${os.hostname()}-${Date.now()}-${nanoid(6)}`;
const DEBUG_PRESENCE = process.env.DEBUG_PRESENCE === '1';

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'info' : 'debug',
    transport: config.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    } : undefined,
  },
  trustProxy: true, // Railway uses a proxy
});

// Register CORS plugin
await fastify.register(cors, {
  origin: config.server.frontendOrigin,
  credentials: true,
});

// Register cookie plugin
await fastify.register(cookie, {
  secret: (() => {
    if (config.nodeEnv === 'production' && !process.env.COOKIE_SECRET) {
      throw new Error('COOKIE_SECRET environment variable is required in production');
    }
    return process.env.COOKIE_SECRET || 'dev-secret-not-for-production';
  })(),
  parseOptions: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
  }
});

// Register websocket plugin
await fastify.register(websocket);

// Add instance ID to all responses for debugging multi-instance routing
fastify.addHook('onSend', async (_request, reply) => {
  reply.header('X-Instance-Id', INSTANCE_ID);
});

// Initialize services
const userService = new UserService(prisma);
const roomService = new RoomService(prisma);
const songMatchingService = new SongMatchingService(prisma);
const songSearchService = new SongSearchService(prisma);
const connectionManager = new ConnectionManager();
const rateLimiter = new RateLimiter();

// Setup Redis subscriptions for cross-instance reaction sync
if (redisService.isEnabled()) {
  await redisService.subscribe('reactions:events', (event) => {
    // Type guard to ensure this is a reaction event
    if (event.type !== 'reaction_added' && event.type !== 'reaction_removed') {
      return;
    }

    // Ignore events from this instance (already handled locally)
    if (event.instanceId === INSTANCE_ID) {
      return;
    }

    logger.debug({
      eventType: event.type,
      fromInstance: event.instanceId,
      messageId: event.messageId,
      emoji: event.emoji
    }, 'Received reaction event from another instance');

    // Broadcast to local connections in the room
    if (event.type === 'reaction_added') {
      connectionManager.broadcastToRoom(event.roomId, {
        type: 'reaction_added',
        messageId: event.messageId,
        emoji: event.emoji,
        userId: event.userId,
        anonHandle: event.anonHandle,
        instanceId: event.instanceId
      });
    } else if (event.type === 'reaction_removed') {
      connectionManager.broadcastToRoom(event.roomId, {
        type: 'reaction_removed',
        messageId: event.messageId,
        emoji: event.emoji,
        userId: event.userId,
        instanceId: event.instanceId
      });
    }
  });

  logger.info('Redis reaction subscriptions active');

  // Cross-instance message broadcast: re-send display messages created on other instances
  await redisService.subscribe('messages:events', (event) => {
    if (event.type !== 'message_created') {
      return;
    }

    // Ignore events from this instance (already handled locally)
    if (event.instanceId === INSTANCE_ID) {
      return;
    }

    logger.debug({
      eventType: event.type,
      fromInstance: event.instanceId,
      messageId: event.id,
      roomId: event.roomId
    }, 'Received message event from another instance');

    // Rebuild as a display message and broadcast to local connections
    connectionManager.broadcastToRoom(event.roomId, {
      type: 'display',
      id: event.id,
      originalText: event.originalText,
      userId: event.userId,
      anonHandle: event.anonHandle,
      primary: event.primary,
      alternates: event.alternates,
      why: event.why,
      similarity: event.similarity,
      timestamp: event.timestamp,
      replyToMessageId: event.replyToMessageId || null
    });
  });

  logger.info('Redis message subscriptions active');
}

// Test page for WebSocket functionality
fastify.get('/test', async (_, reply) => {
  reply.type('text/html');
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Musicr WebSocket Test</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .container {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            margin: 10px 0;
        }
        .messages {
            height: 400px;
            overflow-y: auto;
            border: 1px solid #ccc;
            padding: 10px;
            margin: 10px 0;
            background: #f9f9f9;
        }
        .message {
            margin: 5px 0;
            padding: 5px;
            border-radius: 4px;
        }
        .message.user {
            background: #e3f2fd;
        }
        .message.song {
            background: #f3e5f5;
        }
        .message.display {
            background: #e8f5e8;
        }
        .message.error {
            background: #ffebee;
            color: #c62828;
        }
        .input-container {
            display: flex;
            gap: 10px;
        }
        input[type="text"] {
            flex: 1;
            padding: 8px;
            border: 1px solid #ccc;
            border-radius: 4px;
        }
        button {
            padding: 8px 16px;
            background: #2196f3;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover {
            background: #1976d2;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .status {
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
        }
        .status.connected {
            background: #e8f5e8;
            color: #2e7d32;
        }
        .status.disconnected {
            background: #ffebee;
            color: #c62828;
        }
    </style>
</head>
<body>
    <h1>🎵 Musicr WebSocket Test</h1>
    
    <div class="container">
        <h3>Connection Status</h3>
        <div id="status" class="status disconnected">Disconnected</div>
        <button id="connectBtn" onclick="connect()">Connect</button>
        <button id="disconnectBtn" onclick="disconnect()" disabled>Disconnect</button>
    </div>

    <div class="container">
        <h3>Messages</h3>
        <div id="messages" class="messages"></div>
        
        <div class="input-container">
            <input type="text" id="messageInput" placeholder="Type a message to find songs..." disabled>
            <button id="sendBtn" onclick="sendMessage()" disabled>Send</button>
        </div>
        <small>Example: "I want something happy and upbeat" or "Play some romantic music"</small>
    </div>

    <div class="container">
        <h3>User Info</h3>
        <div id="userInfo">Not connected</div>
    </div>

    <script>
        let ws = null;
        let userId = null;
        let userHandle = null;

        function addMessage(type, content) {
            const messagesDiv = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${type}\`;
            
            const timestamp = new Date().toLocaleTimeString();
            messageDiv.innerHTML = \`<strong>[\${timestamp}]</strong> \${content}\`;
            
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function updateStatus(status, message) {
            const statusDiv = document.getElementById('status');
            statusDiv.className = \`status \${status}\`;
            statusDiv.textContent = message;
        }

        function updateUserInfo(user) {
            const userInfoDiv = document.getElementById('userInfo');
            if (user) {
                userInfoDiv.innerHTML = \`
                    <strong>Handle:</strong> \${user.handle}<br>
                    <strong>ID:</strong> \${user.id}<br>
                    <strong>New User:</strong> \${user.isNew ? 'Yes' : 'No'}
                \`;
                userId = user.id;
                userHandle = user.handle;
            } else {
                userInfoDiv.textContent = 'Not connected';
                userId = null;
                userHandle = null;
            }
        }

        async function getUserSession() {
            try {
                const response = await fetch('/api/user/session', {
                    credentials: 'include'
                });
                const data = await response.json();
                return data.user;
            } catch (error) {
                console.error('Failed to get user session:', error);
                return null;
            }
        }

        async function connect() {
            try {
                updateStatus('connecting', 'Connecting...');
                
                // First get user session
                const user = await getUserSession();
                if (!user) {
                    throw new Error('Failed to establish user session');
                }
                
                updateUserInfo(user);
                
                // Connect WebSocket
                ws = new WebSocket('ws://localhost:4000/ws');
                
                ws.onopen = function() {
                    updateStatus('connected', \`Connected as \${user.handle}\`);
                    document.getElementById('connectBtn').disabled = true;
                    document.getElementById('disconnectBtn').disabled = false;
                    document.getElementById('messageInput').disabled = false;
                    document.getElementById('sendBtn').disabled = false;
                    
                    addMessage('user', \`✅ Connected as <strong>\${user.handle}</strong>\`);
                };
                
                ws.onmessage = function(event) {
                    try {
                        const message = JSON.parse(event.data);
                        handleMessage(message);
                    } catch (error) {
                        addMessage('error', 'Failed to parse message: ' + event.data);
                    }
                };
                
                ws.onclose = function() {
                    updateStatus('disconnected', 'Disconnected');
                    document.getElementById('connectBtn').disabled = false;
                    document.getElementById('disconnectBtn').disabled = true;
                    document.getElementById('messageInput').disabled = true;
                    document.getElementById('sendBtn').disabled = true;
                    
                    addMessage('user', '❌ Connection closed');
                    updateUserInfo(null);
                };
                
                ws.onerror = function(error) {
                    addMessage('error', 'WebSocket error: ' + error.message);
                };
                
            } catch (error) {
                updateStatus('disconnected', 'Connection failed');
                addMessage('error', 'Connection failed: ' + error.message);
            }
        }

        function handleMessage(message) {
            switch (message.type) {
                case 'song':
                    addMessage('song', \`
                        🎵 <strong>Song Match:</strong><br>
                        <strong>\${message.primary.artist} - \${message.primary.title}</strong> \${message.primary.year ? \`(\${message.primary.year})\` : ''}<br>
                        \${message.why.matchedPhrase ? \`<em>Matched: "\${message.why.matchedPhrase}"</em><br>\` : ''}
                        \${message.why.mood ? \`<em>Mood: \${message.why.mood}</em><br>\` : ''}
                        \${message.why.similarity ? \`<em>Similarity: \${(message.why.similarity * 100).toFixed(1)}%</em><br>\` : ''}
                        \${message.alternates.length > 0 ? \`<br><strong>Alternatives:</strong><br>\${message.alternates.map(alt => \`• \${alt.artist} - \${alt.title} (\${(alt.score * 100).toFixed(1)}%)\`).join('<br>')}\` : ''}
                    \`);
                    break;
                    
                case 'display':
                    addMessage('display', \`
                        💬 <strong>\${message.user.handle}:</strong> "\${message.message}"<br>
                        🎵 <strong>Playing:</strong> \${message.song.artist} - \${message.song.title}
                    \`);
                    break;
                    
                case 'user_joined':
                    addMessage('user', \`👋 <strong>\${message.user.handle}</strong> joined the room\`);
                    break;
                    
                case 'user_left':
                    addMessage('user', \`👋 <strong>\${message.user.handle}</strong> left the room\`);
                    break;
                    
                case 'rate_limit':
                    addMessage('error', \`⚠️ Rate limit exceeded: \${message.message} (\${message.retryAfter}s remaining)\`);
                    break;
                    
                case 'error':
                    addMessage('error', \`❌ Error: \${message.message}\`);
                    break;
                    
                default:
                    addMessage('user', \`Unknown message type: \${message.type}\`);
            }
        }

        function disconnect() {
            if (ws) {
                ws.close();
            }
        }

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            
            if (!message || !ws || ws.readyState !== WebSocket.OPEN) {
                return;
            }
            
            // Send message
            ws.send(JSON.stringify({
                type: 'msg',
                text: message
            }));
            
            addMessage('user', \`📤 <strong>You:</strong> "\${message}"\`);
            input.value = '';
        }

        // Allow Enter key to send messages
        document.getElementById('messageInput').addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        });

        // Auto-connect on page load
        window.addEventListener('load', function() {
            setTimeout(connect, 500);
        });
    </script>
</body>
</html>`;
});

// Root endpoint
fastify.get('/', async (_,reply) => {
  reply.code(200).send({ service: 'musicr-api', status: 'running' });
});

// Health check endpoint - Railway uses this to verify service is up
// Must be fast and simple - no database queries or external dependencies
fastify.get('/health', async (_, reply) => {
  reply.code(200).send({ ok: true, service: 'api' });
});

// User session endpoint - establishes anonymous user with cookie
fastify.get('/api/user/session', async (request, reply) => {
  try {
    const userSession = await userService.getUserSession(request, reply);
    
    return {
      user: {
        id: userSession.userId,
        handle: userSession.anonHandle,
        isNew: userSession.isNew,
        createdAt: userSession.createdAt.toISOString(),
      }
    };
  } catch (error) {
    logger.error({ error }, 'Error getting user session');
    reply.code(500).send({ error: 'Internal server error' });
  }
});

// POST /api/map - Deterministic song mapping endpoint
fastify.post('/api/map', async (request, reply) => {
  const startTime = Date.now();
  
  try {
    // Validate request body
    const { text, allowExplicit = false, userId } = validateMapRequest(request.body);
    
    logger.info({ text, allowExplicit, userId }, 'Processing song mapping request');

    // Get or determine user ID for preferences
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      try {
        const userSession = await userService.getUserSession(request, null);
        effectiveUserId = userSession.userId;
      } catch (error) {
        logger.debug({ error }, 'No user session found, proceeding without user preferences');
      }
    }

    // Get song mapping using existing engine with user preferences
    const defaultRoom = await roomService.getDefaultRoom();
    const songResult = await songMatchingService.matchSongs(
      text, 
      allowExplicit, 
      effectiveUserId, 
      defaultRoom.allowExplicit
    );
    
    // Get or create user session for analytics
    let analyticsUserId = userId;
    if (!analyticsUserId) {
      try {
        const userSession = await userService.getUserSession(request, null);
        analyticsUserId = userSession.userId;
      } catch (error) {
        logger.warn({ error }, 'Failed to get user session for analytics, continuing without');
      }
    }

    // Persist mapping as Message for analytics
    if (analyticsUserId) {
      await prisma.message.create({
        data: {
          userId: analyticsUserId,
          roomId: defaultRoom.id,
          text: text,
          chosenSongId: null,
          scores: {
            primary: {
              title: songResult.primary.title,
              artist: songResult.primary.artist,
              year: songResult.primary.year
            },
            alternates: songResult.alternates.map(song => ({
              title: song.title,
              artist: song.artist,
              year: song.year
            })),
            reasoning: songResult.why.matchedPhrase || 'song match',
            timestamp: new Date().toISOString(),
            source: 'api_map'
          }
        }
      });
    }

    const processingTime = Date.now() - startTime;

    // Build base response
    const response: MapResponse = {
      primary: {
        title: songResult.primary.title,
        artist: songResult.primary.artist,
        year: songResult.primary.year || undefined
      },
      alternates: songResult.alternates.map((song, index) => ({
        title: song.title,
        artist: song.artist,
        year: song.year || undefined,
        score: 0.8 - (index * 0.1) // Simple scoring for alternates
      })),
      scores: {
        confidence: songResult.scores.confidence,
        strategy: songResult.scores.strategy,
        reasoning: songResult.why.matchedPhrase || songResult.why.mood || 'Song match analysis'
      },
      why: songResult.why.matchedPhrase || songResult.why.mood || 'Based on content analysis',
      metadata: {
        processingTime,
        timestamp: new Date().toISOString(),
      }
    };

    // Add debug fingerprint if DEBUG_MATCHING=1
    if (process.env.DEBUG_MATCHING === '1') {
      const fingerprint = createRequestFingerprint(
        songResult.scores.confidence > 0 ? 'ok' : 'error',
        { dimensions: 1536 }
      );
      (response.metadata as any).debug = fingerprint;
    }

    logger.info({
      text,
      primarySong: `${response.primary.artist} - ${response.primary.title}`,
      alternatesCount: response.alternates.length,
      processingTime
    }, 'Song mapping completed successfully');

    reply.code(200).send(response);
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error({ error, processingTime }, 'Error processing song mapping');
    
    if (error instanceof Error && error.name === 'ZodError') {
      const errorResponse = createErrorResponse('validation_error', error.message, 400);
      reply.code(400).send(errorResponse);
    } else {
      const errorResponse = createErrorResponse('internal_error', 'Internal server error', 500);
      reply.code(500).send(errorResponse);
    }
  }
});

// GET /api/songs/search - Song search endpoint for debugging
fastify.get('/api/songs/search', async (request, reply) => {
  const startTime = Date.now();
  
  try {
    // Validate query parameters
    const searchParams = validateSearchRequest(request.query);
    
    logger.info(searchParams, 'Processing song search request');

    // Perform search
    const searchResult = await songSearchService.search(searchParams);
    
    const response: SearchResponse = {
      results: searchResult.results,
      metadata: {
        ...searchResult.metadata,
        processingTime: Date.now() - startTime,
      }
    };

    logger.info({
      query: searchParams.q,
      strategy: searchParams.strategy,
      resultsCount: response.results.length,
      processingTime: response.metadata.processingTime
    }, 'Song search completed successfully');

    reply.code(200).send(response);
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error({ error, processingTime }, 'Error processing song search');
    
    if (error instanceof Error && error.name === 'ZodError') {
      const errorResponse = createErrorResponse('validation_error', error.message, 400);
      reply.code(400).send(errorResponse);
    } else {
      const errorResponse = createErrorResponse('internal_error', 'Internal server error', 500);
      reply.code(500).send(errorResponse);
    }
  }
});

// GET /api/admin/analytics - Admin dashboard data (development only)
fastify.get('/api/admin/analytics', async (_, reply) => {
  // Allow in Railway development/staging deployments, block in true production
  // (You can add more specific logic here later, like API key authentication)
  const isBlockedProduction = config.nodeEnv === 'production' && 
                               !process.env.RAILWAY_ENVIRONMENT &&
                               process.env.NODE_ENV === 'production';
  
  if (isBlockedProduction) {
    return reply.code(403).send({ error: 'Admin dashboard not available in this environment' });
  }
  
  try {
    // Get connection statistics
    const stats = connectionManager.getStats();
    
    // Get database statistics
    const songsCount = await prisma.song.count();
    const usersCount = await prisma.user.count();
    const messagesCount = await prisma.message.count();
    
    // Get unique IP count for more meaningful user metrics
    const uniqueIPs = await prisma.user.groupBy({
      by: ['ipHash'],
      _count: {
        ipHash: true
      }
    });
    const uniqueDevicesCount = uniqueIPs.length;
    
    // Get recent messages with song matching results
    const recentMessages = await prisma.message.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: true,
        room: true
      }
    });

    // Calculate performance metrics from recent messages
    const messagesWithScores = recentMessages.filter(m => m.scores);
    const averageConfidence = messagesWithScores.length > 0 
      ? messagesWithScores.reduce((sum, m) => {
          const scores = m.scores as any;
          return sum + (scores?.confidence || 0);
        }, 0) / messagesWithScores.length
      : 0;

    const analytics = {
      summary: {
        totalSongs: songsCount,
        totalUsers: usersCount,
        uniqueDevices: uniqueDevicesCount,
        totalMappings: messagesCount,
        successfulMappings: messagesWithScores.length,
        successRate: messagesCount > 0 ? (messagesWithScores.length / messagesCount) * 100 : 0,
        averageConfidence: Math.round(averageConfidence * 100) / 100
      },
      connections: {
        total: stats.totalConnections,
        byRoom: stats.roomStats
      },
      recentMappings: recentMessages.map(msg => ({
        id: msg.id,
        text: msg.text,
        timestamp: msg.createdAt.toISOString(),
        user: msg.user.anonHandle,
        room: msg.room.name,
        song: (msg.scores as any)?.primary ? {
          title: (msg.scores as any).primary.title,
          artist: (msg.scores as any).primary.artist,
          year: (msg.scores as any).primary.year
        } : null,
        confidence: (msg.scores as any)?.confidence || null,
        strategy: (msg.scores as any)?.strategy || null
      })),
      database: {
        status: 'connected',
        songsCount,
        usersCount,
        messagesCount,
        tables: ['users', 'songs', 'rooms', 'messages']
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      },
      timestamp: new Date().toISOString()
    };
    
    return reply.send(analytics);
  } catch (error) {
    logger.error({ error }, 'Error fetching admin analytics');
    return reply.code(500).send({ error: 'Failed to fetch analytics' });
  }
});

// POST /api/admin/seed - Seed database (development only)
fastify.post('/api/admin/seed', async (request, reply) => {
  // Log the request for debugging first
  logger.info({
    nodeEnv: config.nodeEnv,
    railwayEnv: process.env.RAILWAY_ENVIRONMENT,
    method: request.method,
    url: request.url,
    headers: request.headers
  }, 'Seed endpoint called');

  // Security check: disable in production
  if (config.nodeEnv === 'production') {
    return reply.code(403).send({ error: 'Database seeding not available in production' });
  }
  
  try {
    // Check if database is already seeded
    const songCount = await prisma.song.count();
    logger.info({ currentSongCount: songCount }, 'Current song count in database');
    
    if (songCount > 0) {
      return reply.code(200).send({ 
        message: 'Database already seeded', 
        songCount,
        skipped: true 
      });
    }
    if (songCount > 0) {
      return reply.send({ 
        message: 'Database already seeded', 
        songCount,
        skipped: true 
      });
    }

    // Add a few basic songs for testing
    logger.info('Starting basic database seed...');
    
    const basicSongs = [
      { title: "Love Song", artist: "The Cure", year: 1989, popularity: 85, tags: ["love", "rock", "80s"], phrases: ["love", "romantic", "tender"] },
      { title: "Happy", artist: "Pharrell Williams", year: 2013, popularity: 92, tags: ["happy", "pop", "upbeat"], phrases: ["happy", "joy", "celebration"] },
      { title: "Sad Song", artist: "We The Kings", year: 2013, popularity: 70, tags: ["sad", "rock", "emotional"], phrases: ["sad", "heartbreak", "melancholy"] },
      { title: "Party Rock Anthem", artist: "LMFAO", year: 2011, popularity: 88, tags: ["party", "dance", "electronic"], phrases: ["party", "dance", "celebration"] },
      { title: "Peaceful Easy Feeling", artist: "Eagles", year: 1972, popularity: 79, tags: ["peaceful", "rock", "classic"], phrases: ["peaceful", "calm", "relaxed"] }
    ];

    for (const songData of basicSongs) {
      await prisma.song.create({
        data: {
          title: songData.title,
          artist: songData.artist,
          year: songData.year,
          popularity: songData.popularity,
          tags: songData.tags,
          phrases: songData.phrases,
          embedding: new Array(384).fill(0) // Placeholder embedding
        }
      });
    }

    const newSongCount = await prisma.song.count();
    logger.info({ songCount: newSongCount }, 'Basic database seeding completed');

    return reply.code(200).send({ 
      success: true,
      message: 'Database seeded with basic songs', 
      songCount: newSongCount,
      seeded: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ 
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      endpoint: '/api/admin/seed'
    }, 'Error seeding database');
    
    return reply.code(500).send({ 
      success: false,
      error: 'Failed to seed database',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Helper: Check if string is valid UUID format
const isUuid = (value: string): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
};

// GET /api/rooms/:roomId/messages - Fetch recent messages for a room
fastify.get<{
  Params: { roomId: string };
  Querystring: { limit?: string; before?: string };
}>('/api/rooms/:roomId/messages', async (request, reply) => {
  const { roomId: roomParam } = request.params;
  const limitParam = parseInt(request.query.limit || '50');
  const before = request.query.before; // For pagination
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Validate limit
  if (isNaN(limitParam) || limitParam < 1 || limitParam > 100) {
    return reply.status(400).send({ error: 'Invalid limit. Must be between 1 and 100', requestId });
  }
  const limit = limitParam;

  // Validate before cursor if present
  if (before && !isUuid(before)) {
    logger.warn({ requestId, before }, 'Invalid cursor UUID format');
    return reply.status(400).send({ error: 'Invalid cursor format. Must be a valid UUID', requestId });
  }

  try {
    // Get current user session
    const userSession = await userService.getUserSession(request, reply);
    const currentUserId = userSession.userId;

    // Lookup room by UUID or name (but never pass non-UUID to id field)
    let room;
    if (isUuid(roomParam)) {
      // If it's a UUID, look up by id only
      room = await prisma.room.findUnique({
        where: { id: roomParam }
      });
    } else {
      // If it's not a UUID, look up by name only
      room = await prisma.room.findUnique({
        where: { name: roomParam }
      });
    }

    if (!room) {
      logger.warn({ requestId, roomParam, isUuid: isUuid(roomParam) }, 'Room not found');
      return reply.status(404).send({ error: 'Room not found' });
    }

    // If cursor provided, verify it exists in this room
    if (before) {
      const cursorMessage = await prisma.message.findFirst({
        where: {
          id: before,
          roomId: room.id
        }
      });

      if (!cursorMessage) {
        logger.warn({ requestId, before, roomId: room.id }, 'Cursor message not found in room');
        // Return empty result instead of error - cursor may be stale
        return {
          messages: [],
          hasMore: false,
          oldestId: null
        };
      }
    }

    // Fetch one extra message to determine hasMore
    const fetchLimit = limit + 1;

    const messages = await prisma.message.findMany({
      where: {
        roomId: room.id
      },
      include: {
        user: {
          select: {
            anonHandle: true
          }
        },
        song: {
          select: {
            title: true,
            artist: true,
            year: true
          }
        },
        reactions: {
          include: {
            user: {
              select: {
                anonHandle: true
              }
            }
          },
          orderBy: {
            createdAt: 'asc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: fetchLimit,
      ...(before && {
        cursor: {
          id: before
        },
        skip: 1
      })
    });

    // Determine if there are more messages
    const hasMore = messages.length > limit;
    const messagesToReturn = hasMore ? messages.slice(0, limit) : messages;

    // Reverse to get chronological order (oldest first)
    const messagesWithDisplay = messagesToReturn.reverse().map(msg => {
      // Group reactions by emoji
      const reactionsMap = new Map<string, {
        emoji: string;
        count: number;
        users: Array<{ userId: string; anonHandle: string }>;
        hasReacted: boolean;
      }>();

      for (const reaction of msg.reactions) {
        const existing = reactionsMap.get(reaction.emoji);
        const reactionUser = { userId: reaction.userId, anonHandle: reaction.user.anonHandle };

        if (existing) {
          existing.count++;
          existing.users.push(reactionUser);
          if (reaction.userId === currentUserId) {
            existing.hasReacted = true;
          }
        } else {
          reactionsMap.set(reaction.emoji, {
            emoji: reaction.emoji,
            count: 1,
            users: [reactionUser],
            hasReacted: reaction.userId === currentUserId
          });
        }
      }

      return {
        id: msg.id,
        type: 'display',
        originalText: msg.text,
        userId: msg.userId,
        anonHandle: msg.user.anonHandle,
        primary: msg.scores ? (msg.scores as any).primary : null,
        alternates: msg.scores ? (msg.scores as any).alternates : [],
        why: msg.scores ? `Matched using ${(msg.scores as any).strategy}` : '',
        timestamp: msg.createdAt.toISOString(),
        chosenSong: msg.song ? {
          title: msg.song.title,
          artist: msg.song.artist,
          year: msg.song.year
        } : null,
        replyToMessageId: msg.replyToMessageId || null,
        reactions: Array.from(reactionsMap.values())
      };
    });

    logger.info({
      requestId,
      roomName: room.name,
      roomId: room.id,
      cursor: before || 'none',
      returned: messagesWithDisplay.length,
      hasMore
    }, 'Fetched room messages');

    return {
      messages: messagesWithDisplay,
      hasMore,
      oldestId: messagesWithDisplay.length > 0 ? messagesWithDisplay[0].id : null
    };

  } catch (error) {
    logger.error({
      error,
      requestId,
      roomParam,
      before,
      limit,
      stack: (error as Error).stack
    }, 'Failed to fetch room messages');
    reply.status(500).send({ error: 'Failed to fetch messages', requestId });
  }
});

// GET /api/rooms/:roomId/users - Get current users in a room
fastify.get<{
  Params: { roomId: string };
}>('/api/rooms/:roomId/users', async (request, reply) => {
  const { roomId } = request.params;

  try {
    const roomStats = connectionManager.getRoomStats(roomId);
    
    return {
      roomId,
      users: roomStats.connections.map(conn => ({
        userId: conn.userId,
        handle: conn.handle,
        joinedAt: conn.joinedAt
      })),
      totalUsers: roomStats.uniqueUsers,
      totalConnections: roomStats.connectionCount
    };

  } catch (error) {
    logger.error({ error, roomId }, 'Failed to fetch room users');
    reply.status(500).send({ error: 'Failed to fetch room users' });
  }
});

// GET /api/debug/connections - Get WebSocket connection diagnostics 
fastify.get('/api/debug/connections', async (_, reply) => {
  // Allow in production but with basic protection
  try {
    const stats = connectionManager.getStats();
    const roomDetails: Record<string, any> = {};

    for (const [roomId, roomStats] of Object.entries(stats.roomStats)) {
      const connections = connectionManager.getRoomConnections(roomId);
      roomDetails[roomId] = {
        ...roomStats,
        users: connections.map(conn => ({
          userId: conn.userId.substring(0, 8) + '...', // Truncate for privacy
          handle: conn.anonHandle,
          joinedAt: conn.joinedAt,
          lastActivity: conn.lastActivity,
          socketState: conn.socket.readyState,
          socketStates: {
            '0': 'CONNECTING',
            '1': 'OPEN',
            '2': 'CLOSING',
            '3': 'CLOSED'
          }[conn.socket.readyState.toString()]
        }))
      };
    }

    return {
      totalConnections: stats.totalConnections,
      totalRooms: stats.totalRooms,
      rooms: roomDetails,
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv
    };

  } catch (error) {
    logger.error({ error }, 'Failed to get connection diagnostics');
    reply.status(500).send({ error: 'Failed to get diagnostics' });
  }
});

// GET /api/debug/fingerprint - Instance fingerprint for debugging split-brain behavior
fastify.get('/api/debug/fingerprint', async (_, reply) => {
  // Only enabled when DEBUG_MATCHING=1
  if (process.env.DEBUG_MATCHING !== '1') {
    return reply.status(404).send({ error: 'Not found' });
  }

  try {
    const fingerprint = getInstanceFingerprint();

    // Test embedding service status
    let embeddingStatus: 'ok' | 'error' | 'missing_key' = 'ok';
    let embeddingError: string | undefined;

    if (!fingerprint.hasOpenAIKey) {
      embeddingStatus = 'missing_key';
      embeddingError = 'OPENAI_API_KEY not set';
    } else {
      try {
        const embeddingService = await getEmbeddingService();
        const status = await embeddingService.getStatus();
        if (!status.primary.available) {
          embeddingStatus = 'error';
          embeddingError = `Primary embedder (${status.primary.provider}) not available`;
        }
      } catch (error) {
        embeddingStatus = 'error';
        embeddingError = error instanceof Error ? error.message : 'Unknown error';
      }
    }

    return {
      ...fingerprint,
      embeddingStatus,
      embeddingError,
      environment: config.nodeEnv,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.error({ error }, 'Failed to get instance fingerprint');
    reply.status(500).send({ error: 'Failed to get fingerprint' });
  }
});

// Simple test endpoint to verify API is working
fastify.get('/api/test-simple', async (_, reply) => {
  return reply.send({
    message: 'API is working - deployment test v2',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
    debugMatchingValue: process.env.DEBUG_MATCHING,
    debugMatchingType: typeof process.env.DEBUG_MATCHING,
    debugMatchingStrictCheck: process.env.DEBUG_MATCHING === '1',
  });
});

// POST /api/admin/migrate - Run database migrations (development only)
fastify.post('/api/admin/migrate', async (request, reply) => {
  // Better security check - allow if not explicitly production AND if Railway environment
  const isProduction = config.nodeEnv === 'production' && !process.env.RAILWAY_ENVIRONMENT;
  
  if (isProduction) {
    return reply.code(403).send({ error: 'Database migration not available in production' });
  }

  // Log the request for debugging
  logger.info({
    nodeEnv: config.nodeEnv,
    railwayEnv: process.env.RAILWAY_ENVIRONMENT,
    method: request.method,
    url: request.url
  }, 'Migrate endpoint called');
  
  try {
    // First, let's check if tables exist
    const tableCheck = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `;
    
    logger.info({ 
      existingTables: tableCheck 
    }, 'Current database tables');

    // Manual schema creation since Railway might not support migrate deploy
    logger.info('Creating database schema manually...');
    
    // Create tables directly using raw SQL
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "songs" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" TEXT NOT NULL,
        "artist" TEXT NOT NULL,
        "year" INTEGER,
        "popularity" INTEGER NOT NULL DEFAULT 0,
        "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "mbid" TEXT UNIQUE,
        "embedding" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "anonHandle" TEXT UNIQUE NOT NULL,
        "ipHash" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "rooms" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" TEXT UNIQUE NOT NULL,
        "allowExplicit" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL,
        "roomId" UUID NOT NULL,
        "text" TEXT NOT NULL,
        "chosenSongId" UUID,
        "scores" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE,
        CONSTRAINT "messages_chosenSongId_fkey" FOREIGN KEY ("chosenSongId") REFERENCES "songs"("id") ON DELETE SET NULL
      );
    `;

    // Create indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_songs_tags" ON "songs" USING GIN ("tags");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_songs_phrases" ON "songs" USING GIN ("phrases");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_songs_title_artist" ON "songs"("title", "artist");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_songs_popularity" ON "songs"("popularity");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_messages_user_id" ON "messages"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "idx_messages_room_id" ON "messages"("roomId");`;

    // Create default room
    await prisma.$executeRaw`
      INSERT INTO "rooms" ("name", "allowExplicit") 
      VALUES ('general', false) 
      ON CONFLICT ("name") DO NOTHING;
    `;

    logger.info('Manual schema creation completed');

    // Check tables after migration
    const tablesAfter = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `;

    return reply.code(200).send({ 
      success: true,
      message: 'Database schema created successfully',
      tablesAfter,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error({ error }, 'Error running database migration');
    return reply.code(500).send({ 
      success: false,
      error: 'Failed to run database migration',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// WebSocket route for real-time chat
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, async (connection, req) => {
    try {
      // Extract userId from query parameter and add to headers for getUserSession
      const queryUserId = (req.query as any)?.userId;
      if (queryUserId && !req.headers['x-musicr-user-id']) {
        req.headers['x-musicr-user-id'] = queryUserId;
      }

      // Get or create user session
      const userSession = await userService.getUserSession(req, null);
      
      // Get default room for MVP
      const defaultRoom = await roomService.getDefaultRoom();
      
      // Add connection to manager
      const connectionId = connectionManager.addConnection(
        connection,
        userSession.userId,
        userSession.anonHandle,
        defaultRoom.id
      );

      logger.info({
        connectionId,
        userId: userSession.userId,
        anonHandle: userSession.anonHandle,
        roomId: defaultRoom.id,
        isNewUser: userSession.isNew
      }, 'WebSocket connection established');

      // Send recent message history to new connection
      try {
        const recentMessages = await prisma.message.findMany({
          where: {
            roomId: defaultRoom.id
          },
          include: {
            user: {
              select: {
                anonHandle: true
              }
            },
            song: {
              select: {
                title: true,
                artist: true,
                year: true
              }
            },
            reactions: {
              include: {
                user: {
                  select: {
                    anonHandle: true
                  }
                }
              },
              orderBy: {
                createdAt: 'asc'
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 20
        });

        // Send messages in chronological order (oldest first)
        const messagesToSend = recentMessages.reverse().map((msg) => {
            const scores = msg.scores as any;

            // Group reactions by emoji (same format as REST endpoint)
            const reactionsMap = new Map<string, {
              emoji: string;
              count: number;
              users: Array<{ userId: string; anonHandle: string }>;
              hasReacted: boolean;
            }>();

            for (const reaction of msg.reactions) {
              const existing = reactionsMap.get(reaction.emoji);
              const reactionUser = { userId: reaction.userId, anonHandle: reaction.user.anonHandle };

              if (existing) {
                existing.count++;
                existing.users.push(reactionUser);
                if (reaction.userId === userSession.userId) {
                  existing.hasReacted = true;
                }
              } else {
                reactionsMap.set(reaction.emoji, {
                  emoji: reaction.emoji,
                  count: 1,
                  users: [reactionUser],
                  hasReacted: reaction.userId === userSession.userId
                });
              }
            }

            return {
              type: 'display',
              id: msg.id,
              originalText: msg.text,
              userId: msg.userId,
              anonHandle: msg.user.anonHandle,
              primary: scores ? scores.primary : null,
              alternates: scores ? scores.alternates : [],
              why: scores ? {
                reasoning: `Matched using ${scores.strategy}`,
                similarity: scores.confidence,
                matchedPhrase: scores.matchedPhrase
              } : '',
              timestamp: msg.createdAt.toISOString(),
              isHistorical: true,
              replyToMessageId: msg.replyToMessageId || null,
              reactions: Array.from(reactionsMap.values())
            };
          });

        // Send each historical message
        messagesToSend.forEach(msg => {
          connection.send(JSON.stringify(msg));
        });

        // Send connection confirmation after history
        connection.send(JSON.stringify({
          type: 'connected',
          userId: userSession.userId,
          anonHandle: userSession.anonHandle,
          roomId: defaultRoom.id,
          roomName: defaultRoom.name,
          allowExplicit: defaultRoom.allowExplicit,
          timestamp: new Date().toISOString(),
          instanceId: INSTANCE_ID
        }));

        if (DEBUG_PRESENCE) {
          logger.info({ instanceId: INSTANCE_ID, userId: userSession.userId }, '[DEBUG_PRESENCE] Sent connection confirmation');
        }

      } catch (error) {
        logger.error({ error, roomId: defaultRoom.id }, 'Failed to send message history');
        
        // Still send connection confirmation even if history fails
        connection.send(JSON.stringify({
          type: 'connected',
          userId: userSession.userId,
          anonHandle: userSession.anonHandle,
          roomId: defaultRoom.id,
          roomName: defaultRoom.name,
          allowExplicit: defaultRoom.allowExplicit,
          timestamp: new Date().toISOString(),
          instanceId: INSTANCE_ID
        }));
      }

      // Handle incoming messages
      connection.on('message', async (rawMessage: Buffer) => {
        let messageData: any;
        try {
          messageData = JSON.parse(rawMessage.toString());
          
          // Update connection activity
          connectionManager.updateActivity(connectionId);

          // Validate message format
          if (!messageData.type) {
            connection.send(JSON.stringify({
              type: 'error',
              message: 'Invalid message format. Expected: {type:"msg"|"pref", ...}'
            }));
            return;
          }

          // Handle heartbeat ping
          if (messageData.type === 'ping') {
            connection.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          // Handle reaction_add
          if (messageData.type === 'reaction_add') {
            try {
              const { messageId, emoji } = messageData;

              if (!messageId || !emoji) {
                connection.send(JSON.stringify({
                  type: 'error',
                  message: 'Invalid reaction format. Expected: {type:"reaction_add", messageId:string, emoji:string}'
                }));
                return;
              }

              // Validate message exists and is in current room
              const targetMessage = await prisma.message.findFirst({
                where: { id: messageId, roomId: defaultRoom.id }
              });

              if (!targetMessage) {
                connection.send(JSON.stringify({
                  type: 'error',
                  message: 'Message not found'
                }));
                return;
              }

              // Create or get existing reaction
              const reaction = await prisma.messageReaction.upsert({
                where: {
                  messageId_userId_emoji: {
                    messageId,
                    userId: userSession.userId,
                    emoji
                  }
                },
                create: {
                  messageId,
                  userId: userSession.userId,
                  emoji
                },
                update: {},
                include: {
                  user: true
                }
              });

              // Broadcast to room
              const timestamp = new Date().toISOString();
              connectionManager.broadcastToRoom(defaultRoom.id, {
                type: 'reaction_added',
                messageId,
                emoji,
                userId: userSession.userId,
                anonHandle: userSession.anonHandle,
                reactionId: reaction.id,
                instanceId: INSTANCE_ID
              });

              // Publish to Redis for other instances
              if (redisService.isEnabled()) {
                redisService.publish('reactions:events', {
                  type: 'reaction_added',
                  messageId,
                  emoji,
                  userId: userSession.userId,
                  anonHandle: userSession.anonHandle,
                  roomId: defaultRoom.id,
                  timestamp,
                  instanceId: INSTANCE_ID
                });
              }

              if (DEBUG_PRESENCE) {
                logger.info({
                  instanceId: INSTANCE_ID,
                  messageId,
                  emoji,
                  redisEnabled: redisService.isEnabled()
                }, '[DEBUG_PRESENCE] Broadcast reaction_added');
              }

            } catch (error) {
              logger.error({ error }, 'Failed to add reaction');
              connection.send(JSON.stringify({
                type: 'error',
                message: 'Failed to add reaction'
              }));
            }
            return;
          }

          // Handle reaction_remove
          if (messageData.type === 'reaction_remove') {
            try {
              const { messageId, emoji } = messageData;

              if (!messageId || !emoji) {
                connection.send(JSON.stringify({
                  type: 'error',
                  message: 'Invalid reaction format. Expected: {type:"reaction_remove", messageId:string, emoji:string}'
                }));
                return;
              }

              // Delete reaction
              await prisma.messageReaction.deleteMany({
                where: {
                  messageId,
                  userId: userSession.userId,
                  emoji
                }
              });

              // Broadcast to room
              const timestamp = new Date().toISOString();
              connectionManager.broadcastToRoom(defaultRoom.id, {
                type: 'reaction_removed',
                messageId,
                emoji,
                userId: userSession.userId,
                instanceId: INSTANCE_ID
              });

              // Publish to Redis for other instances
              if (redisService.isEnabled()) {
                redisService.publish('reactions:events', {
                  type: 'reaction_removed',
                  messageId,
                  emoji,
                  userId: userSession.userId,
                  anonHandle: userSession.anonHandle,
                  roomId: defaultRoom.id,
                  timestamp,
                  instanceId: INSTANCE_ID
                });
              }

              if (DEBUG_PRESENCE) {
                logger.info({
                  instanceId: INSTANCE_ID,
                  messageId,
                  emoji,
                  redisEnabled: redisService.isEnabled()
                }, '[DEBUG_PRESENCE] Broadcast reaction_removed');
              }

            } catch (error) {
              logger.error({ error }, 'Failed to remove reaction');
              connection.send(JSON.stringify({
                type: 'error',
                message: 'Failed to remove reaction'
              }));
            }
            return;
          }

          // Handle chat messages
          if (messageData.type !== 'msg' || !messageData.text) {
            connection.send(JSON.stringify({
              type: 'error',
              message: 'Invalid message format. Expected: {type:"msg", text:string}'
            }));
            return;
          }

          logger.info({
            connectionId,
            userId: userSession.userId,
            anonHandle: userSession.anonHandle,
            messageType: messageData.type,
            text: messageData.text
          }, 'Processing WebSocket message');

          // Check rate limit
          const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
          const rateLimitResult = rateLimiter.checkLimit(userSession.userId, clientIP);
          
          if (!rateLimitResult.allowed) {
            logger.warn({
              userId: userSession.userId,
              ip: clientIP,
              remaining: rateLimitResult.remaining,
              resetTime: rateLimitResult.resetTime
            }, 'Rate limit exceeded');
            
            connection.send(JSON.stringify({
              type: 'rate_limit',
              message: 'Too many messages. Please wait before sending another message.',
              retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
              remaining: rateLimitResult.remaining,
            }));
            return;
          }

          // Validate optional replyToMessageId
          const replyToMessageId: string | null = messageData.replyToMessageId || null;
          if (replyToMessageId) {
            if (!isUuid(replyToMessageId)) {
              connection.send(JSON.stringify({
                type: 'error',
                message: 'Invalid replyToMessageId format'
              }));
              return;
            }
            const parent = await prisma.message.findFirst({
              where: { id: replyToMessageId, roomId: defaultRoom.id },
              select: { replyToMessageId: true }
            });
            if (!parent) {
              connection.send(JSON.stringify({
                type: 'error',
                message: 'Parent message not found in this room'
              }));
              return;
            }
          }

          // Step 1: Attempt song matching (non-fatal — message persists regardless)
          let songMatchResult: Awaited<ReturnType<typeof songMatchingService.matchSongs>> | null = null;
          try {
            logger.info({
              text: messageData.text,
              userId: userSession.userId,
              allowExplicit: true
            }, 'About to call songMatchingService.matchSongs');

            songMatchResult = await songMatchingService.matchSongs(
              messageData.text,
              true, // Always allow explicit
              userSession.userId,
              defaultRoom.allowExplicit
            );

            logger.info({
              userId: userSession.userId,
              songResult: songMatchResult
            }, 'Song matching completed successfully');
          } catch (matchError) {
            logger.error({ error: matchError, userId: userSession.userId },
              'Song matching failed — message will still be persisted');
          }

          // Step 2: Always save message to DB (scores are null if matching failed)
          let savedMessage;
          try {
            savedMessage = await prisma.message.create({
              data: {
                userId: userSession.userId,
                roomId: defaultRoom.id,
                text: messageData.text,
                chosenSongId: null,
                replyToMessageId,
                ...(songMatchResult && {
                  scores: {
                    primary: {
                      title: songMatchResult.primary.title,
                      artist: songMatchResult.primary.artist,
                      year: songMatchResult.primary.year
                    },
                    alternates: songMatchResult.alternates.map(song => ({
                      title: song.title,
                      artist: song.artist,
                      year: song.year
                    })),
                    confidence: songMatchResult.scores.confidence,
                    strategy: songMatchResult.scores.strategy
                  }
                })
              }
            });
          } catch (dbError) {
            logger.error({ error: dbError, userId: userSession.userId }, 'Failed to persist message');
            connection.send(JSON.stringify({
              type: 'error',
              message: 'Failed to save message',
              timestamp: Date.now()
            }));
            return;
          }

          // Step 3: Always respond to sender with messageId + createdAt
          if (songMatchResult) {
            connection.send(JSON.stringify({
              ...songMatchResult,
              messageId: savedMessage.id,
              createdAt: savedMessage.createdAt.toISOString(),
              replyToMessageId
            }));
          } else {
            // Matching failed: send type:'song' ack so client reconciles the optimistic message
            connection.send(JSON.stringify({
              type: 'song',
              messageId: savedMessage.id,
              createdAt: savedMessage.createdAt.toISOString(),
              primary: null,
              alternates: [],
              scores: null,
              why: null,
              replyToMessageId
            }));
          }

          // Step 4: Always broadcast display message to room
          const displayMessage = {
            type: 'display',
            id: savedMessage.id,
            originalText: messageData.text,
            userId: userSession.userId,
            anonHandle: userSession.anonHandle,
            primary: songMatchResult?.primary || null,
            alternates: songMatchResult?.alternates || [],
            why: songMatchResult?.why || null,
            similarity: songMatchResult?.scores?.confidence || 0,
            timestamp: savedMessage.createdAt.toISOString(),
            replyToMessageId,
          };

          connectionManager.broadcastToRoom(defaultRoom.id, displayMessage, connectionId);

          // Publish to Redis for cross-instance broadcast
          if (redisService.isEnabled()) {
            redisService.publish('messages:events', {
              ...displayMessage,
              type: 'message_created',
              roomId: defaultRoom.id,
              instanceId: INSTANCE_ID
            });
          }

          logger.info({
            userId: userSession.userId,
            anonHandle: userSession.anonHandle,
            primarySong: songMatchResult
              ? `${songMatchResult.primary.artist} - ${songMatchResult.primary.title}`
              : '(no match)',
            strategy: songMatchResult?.scores?.strategy || 'none',
            confidence: songMatchResult?.scores?.confidence || 0
          }, 'WebSocket message processing completed');

        } catch (error) {
          logger.error({
            error: error instanceof Error ? {
              message: error.message,
              stack: error.stack,
              name: error.name
            } : error,
            connectionId,
            userId: userSession.userId,
            messageText: messageData?.text
          }, 'Error processing WebSocket message');
          
          connection.send(JSON.stringify({
            type: 'error',
            message: 'Internal server error processing message'
          }));
        }
      });

      // Handle connection close
      connection.on('close', () => {
        connectionManager.removeConnection(connectionId);
        logger.info({
          connectionId,
          userId: userSession.userId,
          anonHandle: userSession.anonHandle
        }, 'WebSocket connection closed');
      });

    } catch (error) {
      logger.error({ error }, 'Error establishing WebSocket connection');
      connection.close();
    }
  });
});

const start = async () => {
  try {
    // Connect to database
    await connectDatabase();

    // Verify required schema columns exist (migration guard)
    // Wait a moment for database connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      logger.info('Checking database schema...');
      await prisma.$queryRaw`SELECT is_placeholder FROM songs LIMIT 0`;
      logger.info('✅ Schema migration check passed');
    } catch (error: any) {
      const errorMsg = error.message || String(error);

      // Check if it's a connection error vs schema error
      if (errorMsg.includes('connection') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('ETIMEDOUT')) {
        logger.error({ error: errorMsg }, '❌ Database connection failed during schema check');
        logger.error('Database may still be initializing. Server will continue but may have issues.');
      } else if (errorMsg.includes('column') && errorMsg.includes('does not exist')) {
        // This is the schema error we care about
        logger.fatal({
          error: errorMsg,
          hint: 'is_placeholder column missing'
        }, '❌ FATAL: Database schema is out of date!');
        logger.fatal('');
        logger.fatal('Required migration has not been applied to the database.');
        logger.fatal('');
        logger.fatal('To fix this:');
        logger.fatal('  1. Run: pnpm db:migrate:deploy');
        logger.fatal('  2. Or emergency SQL: ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;');
        logger.fatal('  3. Then restart the server');
        logger.fatal('');
        logger.fatal('If deploying to Railway, ensure startCommand runs migrations:');
        logger.fatal('  startCommand = "pnpm start:railway" (runs migrations + starts server)');
        logger.fatal('');
        process.exit(1);
      } else {
        // Unknown error - log but don't exit
        logger.warn({ error: errorMsg }, '⚠️  Schema check had unexpected error, continuing anyway');
      }
    }

    // Initialize room service (creates default room)
    await roomService.initialize();
    logger.info('Room service initialized');

    // Start server FIRST (so Railway health checks pass)
    const address = await fastify.listen({
      port: config.server.port,
      host: config.server.host
    });

    // Initialize embedding service BEFORE declaring server ready
    // This prevents requests from arriving before embeddings are available
    logger.info('Initializing embedding service (may take 30-60s for model download)...');
    try {
      await getEmbeddingService({
        primaryProvider: 'local',
        fallbackProvider: 'openai',
        local: {
          model: 'Xenova/all-MiniLM-L6-v2',
          dimensions: 384
        },
        openai: process.env.OPENAI_API_KEY ? {
          apiKey: process.env.OPENAI_API_KEY,
          model: 'text-embedding-3-small',
          dimensions: 384  // CRITICAL: Must match song embedding dimensions
        } : undefined
      });
      logger.info('✅ Embedding service initialized - full semantic search available');
    } catch (error) {
      logger.error({ error }, '❌ Embedding service initialization FAILED - semantic search will not work');
      // Don't exit - let server start anyway for health checks, but matching will fail
    }

    // Clear startup logging for Railway
    console.log(`✅ SERVER READY - listening host=${config.server.host} port=${config.server.port}`);
    console.log(`✅ Health check available at: ${address}/health`);
    logger.info(`Server listening on ${address}`);
  } catch (err) {
    fastify.log.error(err);
    await disconnectDatabase();
    connectionManager.shutdown();
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  connectionManager.shutdown();
  await disconnectDatabase();
  await fastify.close();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  connectionManager.shutdown();
  await disconnectDatabase();
  await fastify.close();
});

start();