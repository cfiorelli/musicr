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
import { RateLimiter } from './utils/rate-limiter.js';
import { getEmbeddingService } from './embeddings/index.js';
import { phraseLexicon } from './services/phrase-lexicon-service.js';
import { 
  validateMapRequest, 
  validateSearchRequest, 
  createErrorResponse,
  MapResponse,
  SearchResponse 
} from './schemas/api.js';

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
  }
});

// Register CORS plugin
await fastify.register(cors, {
  origin: config.server.frontendOrigin,
  credentials: true,
});

// Register cookie plugin
await fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET || 'default-cookie-secret-change-in-production',
  parseOptions: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
  }
});

// Register websocket plugin
await fastify.register(websocket);

// Initialize services
const userService = new UserService(prisma);
const roomService = new RoomService(prisma);
const songMatchingService = new SongMatchingService(prisma);
const songSearchService = new SongSearchService(prisma);
const connectionManager = new ConnectionManager();
const rateLimiter = new RateLimiter();

// Health check route
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Test page for WebSocket functionality
fastify.get('/test', async (request, reply) => {
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
            primary: songResult.primary,
            alternates: songResult.alternates,
            reasoning: songResult.why,
            timestamp: new Date().toISOString(),
            source: 'api_map'
          }
        }
      });
    }

    const processingTime = Date.now() - startTime;
    
    const response: MapResponse = {
      primary: songResult.primary,
      alternates: songResult.alternates,
      scores: songResult.scores,
      why: songResult.why,
      metadata: {
        processingTime,
        timestamp: new Date().toISOString(),
      }
    };

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
    } else if (error instanceof Error && error.message.includes('inappropriate language')) {
      // Handle moderation errors
      const errorResponse = createErrorResponse('content_policy', error.message, 400);
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

// WebSocket route for real-time chat
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, async (connection, req) => {
    try {
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

      // Handle incoming messages
      connection.on('message', async (rawMessage: Buffer) => {
        try {
          const messageData = JSON.parse(rawMessage.toString());
          
          // Update connection activity
          connectionManager.updateActivity(connectionId);

          // Validate message format
          if (!messageData.type || messageData.type !== 'msg' || !messageData.text) {
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

          // Process message for song matching
          let songMatchResult;
          try {
            songMatchResult = await songMatchingService.matchSongs(
              messageData.text, 
              defaultRoom.allowExplicit,
              userSession.userId,
              defaultRoom.allowExplicit
            );

            // Save message to database
            await prisma.message.create({
              data: {
                userId: userSession.userId,
                roomId: defaultRoom.id,
                text: messageData.text,
                chosenSongId: null, // Will be set later when user selects
                scores: {
                  primary: songMatchResult.primary,
                  alternates: songMatchResult.alternates,
                  reasoning: songMatchResult.why
                }
              }
            });

            // Send song response to sender
            connection.send(JSON.stringify(songMatchResult));

          } catch (moderationError) {
            // Handle moderation errors in WebSocket
            if (moderationError instanceof Error && moderationError.message.includes('inappropriate language')) {
              connection.send(JSON.stringify({
                type: 'moderation_error',
                message: moderationError.message,
                timestamp: Date.now()
              }));
              return;
            }
            throw moderationError; // Re-throw other errors
          }

          // Only broadcast if we have a valid result
          if (songMatchResult) {
            // Broadcast display message to room
            const displayMessage = {
              type: 'display',
              user: {
                id: userSession.userId,
                handle: userSession.anonHandle,
              },
              message: messageData.text,
              song: songMatchResult.primary,
              timestamp: new Date().toISOString(),
            };

            connectionManager.broadcastToRoom(defaultRoom.id, displayMessage, connectionId);
            
            logger.info({
              userId: userSession.userId,
              anonHandle: userSession.anonHandle,
              primarySong: `${songMatchResult.primary.artist} - ${songMatchResult.primary.title}`,
              strategy: songMatchResult.scores.strategy,
              confidence: songMatchResult.scores.confidence
            }, 'WebSocket song matching completed');
          }

        } catch (error) {
          logger.error({
            error,
            connectionId,
            userId: userSession.userId
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
    
    // Initialize phrase lexicon
    await phraseLexicon.initialize();
    
    // Initialize room service (creates default room)
    await roomService.initialize();
    
    // Initialize embedding service
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
          model: 'text-embedding-ada-002',
          dimensions: 1536
        } : undefined
      });
      logger.info('Embedding service initialized');
    } catch (error) {
      logger.warn({ error }, 'Embedding service initialization failed - song matching may be limited');
    }
    
    await fastify.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });
    logger.info(`Server listening on ${config.server.host}:${config.server.port}`);
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