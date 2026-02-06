import { create } from 'zustand';

// Simple UUID generator for compatibility
function generateId() {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

export interface RoomUser {
  userId: string;
  handle: string;
  joinedAt: string;
}

export interface Message {
  id: string;
  content: string;
  songTitle?: string;
  songArtist?: string;
  songYear?: number;
  alternates?: Array<{
    id: string;
    title: string;
    artist: string;
    year: number;
    score?: number;
  }>;
  reasoning?: string;
  similarity?: number; // 0-1 score indicating match confidence
  reactions?: Array<{
    emoji: string;
    count: number;
    users: Array<{ userId: string; anonHandle: string }>;
    hasReacted?: boolean; // Current user has reacted
  }>;
  timestamp: string;
  userId: string;
  anonHandle: string;
  isOptimistic?: boolean;
}

export interface ChatState {
  messages: Message[];
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  ws: WebSocket | null;
  userId: string;
  userHandle: string;
  currentRoom: string;
  selectedMessage: string | null;
  alternates: Message['alternates'];
  roomUsers: RoomUser[];
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  debugInfo: {
    connectionInstanceId?: string;
    lastUserJoinedInstanceId?: string;
    lastUserLeftInstanceId?: string;
    lastReactionInstanceId?: string;
    eventLog: Array<{ type: string; instanceId?: string; timestamp: string }>;
    lastMessageTime?: number;
    lastHeartbeatTime?: number;
    reconnectAttempts?: number;
    isReconnecting?: boolean;
  };

  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  checkConnectionHealth: () => void;
  handleVisibilityChange: () => void;
  setupLifecycleListeners: () => () => void;
  resyncAfterReconnect: () => Promise<void>;
  sendMessage: (content: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  selectAlternate: (messageId: string, alternate: NonNullable<Message['alternates']>[0]) => void;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  getUserSession: () => Promise<void>;
  fetchRoomUsers: () => Promise<void>;
  addRoomUser: (user: RoomUser) => void;
  removeRoomUser: (userId: string) => void;
  fetchMessageHistory: (roomId: string, limit?: number) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
}

// Derive URLs dynamically so the app works from localhost or LAN IPs
// Allow overrides via Vite env vars when needed
const { VITE_WS_URL, VITE_API_URL } = (import.meta as any).env || {};

function deriveBaseUrls() {
  try {
    // Use window.location to determine current host and protocol
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = loc.hostname; // e.g., localhost or 10.0.0.106
    // Backend runs on 4000 by default
    const apiOrigin = `${loc.protocol}//${host}:4000`;
    const wsOrigin = `${protocol}//${host}:4000`;
    
    return {
      apiUrl: `${apiOrigin}/api`,
      wsUrl: `${wsOrigin}/ws`,
    };
  } catch (error) {
    console.error('[URL DEBUG] Error in deriveBaseUrls:', error);
    // Fallback to localhost if window is not available
    return {
      apiUrl: 'http://localhost:4000/api',
      wsUrl: 'ws://localhost:4000/ws',
    };
  }
}

const derived = deriveBaseUrls();
const API_URL = VITE_API_URL || derived.apiUrl;
const WS_URL = VITE_WS_URL || derived.wsUrl;

// Generate UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Get or create user ID from localStorage
function getUserId(): string {
  const STORAGE_KEY = 'musicr_user_id';

  try {
    let userId = localStorage.getItem(STORAGE_KEY);

    if (!userId) {
      // Generate new UUID and store it
      userId = generateUUID();
      localStorage.setItem(STORAGE_KEY, userId);
      console.log('[USER_ID] Generated new user ID:', userId);
    } else {
      console.log('[USER_ID] Using existing user ID from localStorage');
    }

    return userId;
  } catch (error) {
    // Fallback if localStorage is not available
    console.error('[USER_ID] localStorage not available, using session-only ID:', error);
    return generateUUID();
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  connectionStatus: 'disconnected',
  ws: null,
  userId: '',
  userHandle: '',
  currentRoom: 'main',
  selectedMessage: null,
  alternates: [],
  roomUsers: [],
  isLoadingHistory: false,
  hasMoreHistory: true,
  debugInfo: {
    eventLog: []
  },

  getUserSession: async () => {
    try {
      const userId = getUserId();
      const response = await fetch(`${API_URL}/user/session`, {
        credentials: 'include', // Keep for backward compatibility
        headers: {
          'X-Musicr-User-Id': userId
        }
      });
      const data = await response.json();
      set({ userHandle: data.user.handle });
    } catch (error) {
      console.error('Error getting user session:', error);
      set({ userHandle: 'anonymous-user-123' }); // fallback
    }
  },

  fetchRoomUsers: async () => {
    try {
      const { currentRoom, userHandle } = get();
      const userId = getUserId();
      console.log('Fetching room users for room:', currentRoom);
      const response = await fetch(`${API_URL}/rooms/${currentRoom}/users`, {
        credentials: 'include', // Keep for backward compatibility
        headers: {
          'X-Musicr-User-Id': userId
        }
      });
      const data = await response.json();
      console.log('API returned room users:', data);
      
      // Ensure current user is included in the list
      let users = data.users || [];
      const currentUserExists = users.some((u: RoomUser) => u.handle === userHandle);
      
      if (!currentUserExists && userHandle && userHandle !== 'anonymous-user-123') {
        // Add current user to the list if they're missing
        console.log('Adding missing current user:', userHandle);
        users.push({
          userId: 'current-user',
          handle: userHandle,
          joinedAt: new Date().toISOString()
        });
      }
      
      set({ roomUsers: users });
      console.log('Fetched room users:', users.length, 'users -', users.map((u: RoomUser) => u.handle));
    } catch (error) {
      console.error('Error fetching room users:', error);
    }
  },

  addRoomUser: (user: RoomUser) => {
    set((state) => {
      // Remove any existing user with same handle or userId to avoid duplicates
      const filtered = state.roomUsers.filter(u => 
        u.userId !== user.userId && u.handle !== user.handle
      );
      return {
        roomUsers: [...filtered, user]
      };
    });
    console.log('Added room user:', user.handle);
  },

  removeRoomUser: (userId: string) => {
    set((state) => {
      const filtered = state.roomUsers.filter(u => u.userId !== userId);
      console.log('Removed room user, remaining:', filtered.length, 'users');
      return {
        roomUsers: filtered
      };
    });
  },

  connect: () => {
    const { ws, connectionStatus, getUserSession } = get();
    
    if (ws && connectionStatus === 'connected') {
      return; // Already connected
    }

    // Get user session first
    getUserSession();

    set({ connectionStatus: 'connecting' });

    try {
      // Include userId as query parameter for WebSocket connection
      const userId = getUserId();
      const wsUrlWithUserId = `${WS_URL}?userId=${encodeURIComponent(userId)}`;
      const websocket = new WebSocket(wsUrlWithUserId);
      
      websocket.onopen = async () => {
        console.log('WebSocket connected');
        const wasReconnecting = get().debugInfo.isReconnecting;

        set((state) => ({
          connectionStatus: 'connected',
          ws: websocket,
          debugInfo: {
            ...state.debugInfo,
            reconnectAttempts: 0, // Reset on successful connection
            isReconnecting: false,
            lastMessageTime: Date.now(),
            eventLog: [
              ...state.debugInfo.eventLog,
              { type: 'websocket_open', timestamp: new Date().toISOString() }
            ].slice(-50)
          }
        }));

        // If this was a reconnection, resync state
        if (wasReconnecting) {
          const isDebug = window.location.search.includes('debug=1');
          if (isDebug) console.log('[RECONNECT] Successful reconnection, resyncing state');
          await get().resyncAfterReconnect();
        }

        // Room joining happens automatically on the server side

        // Start heartbeat mechanism (ping every 30 seconds)
        const heartbeatInterval = setInterval(() => {
          const { ws: currentWs, connectionStatus } = get();
          if (currentWs && currentWs.readyState === WebSocket.OPEN && connectionStatus === 'connected') {
            try {
              currentWs.send(JSON.stringify({ type: 'ping' }));
              const isDebug = window.location.search.includes('debug=1');
              if (isDebug) console.log('[HEARTBEAT] Sent ping');
            } catch (error) {
              console.error('[HEARTBEAT] Failed to send ping:', error);
            }
          } else {
            clearInterval(heartbeatInterval);
          }
        }, 30000);
      };
      
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket received data:', data);

          // Track message receipt time for stale connection detection
          set((state) => ({
            debugInfo: {
              ...state.debugInfo,
              lastMessageTime: Date.now()
            }
          }));

          // Handle heartbeat pong responses
          if (data.type === 'pong') {
            const isDebug = window.location.search.includes('debug=1');
            if (isDebug) console.log('[HEARTBEAT] Received pong');
            set((state) => ({
              debugInfo: {
                ...state.debugInfo,
                lastHeartbeatTime: Date.now()
              }
            }));
            return; // Don't process further
          }

          if (data.type === 'song') {
            // Update optimistic message with song result
            const { messages, updateMessage } = get();
            const lastUserMessage = messages.filter(m => m.userId === 'user').pop();
            console.log('Looking for optimistic message to update:', lastUserMessage);
            
            if (lastUserMessage && lastUserMessage.isOptimistic) {
              console.log('Updating optimistic message with song result:', data);
              updateMessage(lastUserMessage.id, {
                ...(data.messageId && { id: data.messageId }),
                songTitle: data.primary?.title,
                songArtist: data.primary?.artist,
                songYear: data.primary?.year,
                alternates: data.alternates,
                reasoning: data.why?.reasoning || data.why?.matchedPhrase,
                similarity: data.why?.similarity,
                isOptimistic: false
              });
            } else {
              console.log('No optimistic message found to update');
            }
          } else if (data.primary && !data.type) {
            // Direct song mapping response (for user's own message)
            const { messages, updateMessage } = get();
            const lastUserMessage = messages.filter(m => m.userId === 'user').pop();
            console.log('Received song mapping response for user message:', lastUserMessage);
            
            if (lastUserMessage && lastUserMessage.isOptimistic) {
              console.log('Updating optimistic message with song mapping:', data);
              updateMessage(lastUserMessage.id, {
                ...(data.messageId && { id: data.messageId }),
                songTitle: data.primary?.title,
                songArtist: data.primary?.artist,
                songYear: data.primary?.year,
                alternates: data.alternates,
                reasoning: data.why?.reasoning || data.why?.matchedPhrase || data.why,
                similarity: data.why?.similarity,
                isOptimistic: false
              });
            } else {
              console.log('No optimistic message found to update with song mapping');
            }
          } else if (data.type === 'display') {
            // Message from another user or historical message
            const message: Message = {
              id: data.id || generateId(), // Use server ID if available
              content: data.originalText,
              songTitle: data.primary?.title,
              songArtist: data.primary?.artist,
              songYear: data.primary?.year,
              alternates: data.alternates,
              reasoning: data.why?.reasoning || data.why?.matchedPhrase || data.why,
              similarity: data.why?.similarity,
              timestamp: data.timestamp || new Date().toISOString(),
              userId: data.userId,
              anonHandle: data.anonHandle,
            };
            
            // For historical messages, add them in order without duplicating
            if (data.isHistorical) {
              // Check if we already have this message to avoid duplicates
              const { messages } = get();
              const exists = messages.find(m => m.timestamp === message.timestamp && m.content === message.content);
              if (!exists) {
                // Insert historical messages in chronological order
                set((state) => {
                  const newMessages = [...state.messages, message];
                  return {
                    messages: newMessages.sort((a, b) => 
                      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                    )
                  };
                });
              }
            } else {
              // Live message - add normally
              get().addMessage(message);
            }
          } else if (data.type === 'connected') {
            // Connection confirmation - update user handle and ID
            set((state) => ({
              userId: data.userId,
              userHandle: data.anonHandle,
              debugInfo: {
                ...state.debugInfo,
                connectionInstanceId: data.instanceId,
                eventLog: [
                  ...state.debugInfo.eventLog,
                  { type: 'connected', instanceId: data.instanceId, timestamp: new Date().toISOString() }
                ].slice(-50) // Keep last 50 events
              }
            }));
            console.log('Connected to room:', data.roomName, 'as', data.anonHandle, 'instanceId:', data.instanceId);
            console.log('Current users after WebSocket events:', get().roomUsers.length, get().roomUsers.map((u: RoomUser) => u.handle));
            
            // DON'T fetch from API - we already got the correct state via WebSocket events
            // The API might return stale data and overwrite the correct real-time state
            console.log('Skipping API fetch - using WebSocket state instead');
            
            // Ensure current user is in the list (fallback safety check)
            const currentUserInList = get().roomUsers.some((u: RoomUser) => u.handle === data.anonHandle);
            if (!currentUserInList) {
              console.log('Adding current user to list as safety fallback');
              get().addRoomUser({
                userId: 'current-user',
                handle: data.anonHandle,
                joinedAt: new Date().toISOString()
              });
            }
            // Removed fetchRoomUsers() call to prevent overwriting WebSocket state
            
            // Set up periodic user list validation (every 120 seconds)
            // Only sync if we suspect we're missing users or have connectivity issues
            const syncInterval = setInterval(() => {
              const currentState = get();
              if (currentState.connectionStatus === 'connected') {
                // Only sync if we have no users at all (likely a problem)
                if (currentState.roomUsers.length === 0) {
                  console.log('No users detected, emergency sync...', currentState.roomUsers.length);
                  currentState.fetchRoomUsers();
                } else {
                  console.log('Room has', currentState.roomUsers.length, 'users, WebSocket working fine');
                }
              } else {
                clearInterval(syncInterval);
              }
            }, 120000); // Increased to 2 minutes and only for emergencies
          } else if (data.type === 'user_joined') {
            // New user joined the room
            const { addRoomUser } = get();
            const newUser = {
              userId: data.user.id,
              handle: data.user.handle,
              joinedAt: data.timestamp
            };
            addRoomUser(newUser);

            // Capture instanceId for debug
            set((state) => ({
              debugInfo: {
                ...state.debugInfo,
                lastUserJoinedInstanceId: data.instanceId,
                eventLog: [
                  ...state.debugInfo.eventLog,
                  { type: 'user_joined', instanceId: data.instanceId, timestamp: new Date().toISOString() }
                ].slice(-50)
              }
            }));

            console.log('User joined:', data.user.handle, 'Total users now:', get().roomUsers.length, 'instanceId:', data.instanceId);
          } else if (data.type === 'user_left') {
            // User left the room
            const { removeRoomUser } = get();
            removeRoomUser(data.user.id);

            // Capture instanceId for debug
            set((state) => ({
              debugInfo: {
                ...state.debugInfo,
                lastUserLeftInstanceId: data.instanceId,
                eventLog: [
                  ...state.debugInfo.eventLog,
                  { type: 'user_left', instanceId: data.instanceId, timestamp: new Date().toISOString() }
                ].slice(-50)
              }
            }));

            console.log('User left:', data.user.handle, 'instanceId:', data.instanceId);
          } else if (data.type === 'reaction_added') {
            // Reaction added to a message
            set((state) => {
              const messages = state.messages.map(msg => {
                if (msg.id === data.messageId) {
                  const reactions = msg.reactions || [];
                  const existing = reactions.find(r => r.emoji === data.emoji);

                  if (existing) {
                    // Increment count
                    return {
                      ...msg,
                      reactions: reactions.map(r =>
                        r.emoji === data.emoji
                          ? {
                              ...r,
                              count: r.count + 1,
                              users: [...r.users, { userId: data.userId, anonHandle: data.anonHandle }],
                              hasReacted: data.userId === state.userId || r.hasReacted
                            }
                          : r
                      )
                    };
                  } else {
                    // Add new emoji
                    return {
                      ...msg,
                      reactions: [
                        ...reactions,
                        {
                          emoji: data.emoji,
                          count: 1,
                          users: [{ userId: data.userId, anonHandle: data.anonHandle }],
                          hasReacted: data.userId === state.userId
                        }
                      ]
                    };
                  }
                }
                return msg;
              });

              return {
                messages,
                debugInfo: {
                  ...state.debugInfo,
                  lastReactionInstanceId: data.instanceId,
                  eventLog: [
                    ...state.debugInfo.eventLog,
                    { type: 'reaction_added', instanceId: data.instanceId, timestamp: new Date().toISOString() }
                  ].slice(-50)
                }
              };
            });
          } else if (data.type === 'reaction_removed') {
            // Reaction removed from a message
            set((state) => {
              const messages = state.messages.map(msg => {
                if (msg.id === data.messageId) {
                  const reactions = (msg.reactions || [])
                    .map(r => {
                      if (r.emoji === data.emoji) {
                        const newUsers = r.users.filter(u => u.userId !== data.userId);
                        return {
                          ...r,
                          count: newUsers.length,
                          users: newUsers,
                          hasReacted: r.hasReacted && data.userId !== state.userId
                        };
                      }
                      return r;
                    })
                    .filter(r => r.count > 0); // Remove emoji if count is 0

                  return { ...msg, reactions };
                }
                return msg;
              });

              return {
                messages,
                debugInfo: {
                  ...state.debugInfo,
                  lastReactionInstanceId: data.instanceId,
                  eventLog: [
                    ...state.debugInfo.eventLog,
                    { type: 'reaction_removed', instanceId: data.instanceId, timestamp: new Date().toISOString() }
                  ].slice(-50)
                }
              };
            });
          } else if (data.type === 'error') {
            // Server error - remove optimistic message and show error
            console.error('Server error:', data.message);

            // Remove the optimistic message that failed
            const { messages } = get();
            const lastOptimisticMessage = messages.filter(m => m.isOptimistic && m.userId === 'user').pop();
            if (lastOptimisticMessage) {
              console.log('Removing failed optimistic message:', lastOptimisticMessage.id);
              set((state) => ({
                messages: state.messages.filter(m => m.id !== lastOptimisticMessage.id)
              }));
            }

            // Add system error message
            const errorMessage: Message = {
              id: generateId(),
              content: `Error: ${data.message}`,
              timestamp: new Date().toISOString(),
              userId: 'system',
              anonHandle: 'System',
              isModeration: true,
            };
            get().addMessage(errorMessage);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      websocket.onerror = (error) => {
        const isDebug = window.location.search.includes('debug=1');
        if (isDebug) {
          console.error('[ERROR] WebSocket error:', error);
        } else {
          console.error('WebSocket error:', error);
        }

        set((state) => ({
          connectionStatus: 'disconnected',
          debugInfo: {
            ...state.debugInfo,
            eventLog: [
              ...state.debugInfo.eventLog,
              { type: 'websocket_error', timestamp: new Date().toISOString() }
            ].slice(-50)
          }
        }));
        // Note: onclose will be called after onerror, which will trigger reconnect
      };
      
      websocket.onclose = (event) => {
        const isDebug = window.location.search.includes('debug=1');
        if (isDebug) {
          console.log('[DISCONNECT] WebSocket closed:', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });
        } else {
          console.log('WebSocket disconnected');
        }

        set((state) => ({
          connectionStatus: 'disconnected',
          ws: null,
          debugInfo: {
            ...state.debugInfo,
            eventLog: [
              ...state.debugInfo.eventLog,
              {
                type: 'websocket_close',
                timestamp: new Date().toISOString(),
                code: event.code,
                wasClean: event.wasClean
              }
            ].slice(-50)
          }
        }));

        // Trigger reconnection with exponential backoff
        get().reconnect();
      };
      
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      set({ connectionStatus: 'disconnected' });
    }
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
      set({ ws: null, connectionStatus: 'disconnected' });
    }
  },

  reconnect: () => {
    const { debugInfo, connectionStatus } = get();
    const isDebug = window.location.search.includes('debug=1');

    if (isDebug) {
      console.log('[RECONNECT] Attempting reconnect, current status:', connectionStatus);
    }

    // Don't reconnect if already connecting or connected
    if (connectionStatus === 'connecting' || connectionStatus === 'connected') {
      if (isDebug) {
        console.log('[RECONNECT] Skipping - already', connectionStatus);
      }
      return;
    }

    // Calculate exponential backoff delay
    const attempts = debugInfo.reconnectAttempts || 0;
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);

    if (isDebug) {
      console.log(`[RECONNECT] Scheduling reconnect in ${delay}ms (attempt ${attempts + 1})`);
    }

    set((state) => ({
      debugInfo: {
        ...state.debugInfo,
        reconnectAttempts: attempts + 1,
        isReconnecting: true,
        eventLog: [
          ...state.debugInfo.eventLog,
          { type: 'reconnect_scheduled', timestamp: new Date().toISOString() }
        ].slice(-50)
      }
    }));

    setTimeout(() => {
      const currentState = get();
      if (currentState.connectionStatus === 'disconnected') {
        if (isDebug) {
          console.log('[RECONNECT] Executing scheduled reconnect');
        }
        currentState.connect();
      }
    }, delay);
  },

  checkConnectionHealth: () => {
    const { ws, debugInfo, connectionStatus } = get();
    const isDebug = window.location.search.includes('debug=1');
    const now = Date.now();
    const staleThreshold = 45000; // 45 seconds without activity = stale

    const lastActivity = Math.max(
      debugInfo.lastMessageTime || 0,
      debugInfo.lastHeartbeatTime || 0
    );

    const timeSinceActivity = now - lastActivity;

    if (isDebug) {
      console.log('[HEALTH] Checking connection health:', {
        status: connectionStatus,
        wsReadyState: ws?.readyState,
        timeSinceActivity: Math.round(timeSinceActivity / 1000) + 's',
        isStale: timeSinceActivity > staleThreshold
      });
    }

    // If connected but stale, treat as disconnected and reconnect
    if (connectionStatus === 'connected' && timeSinceActivity > staleThreshold) {
      if (isDebug) {
        console.log('[HEALTH] Connection is stale, forcing reconnect');
      }

      set((state) => ({
        debugInfo: {
          ...state.debugInfo,
          eventLog: [
            ...state.debugInfo.eventLog,
            { type: 'stale_connection_detected', timestamp: new Date().toISOString() }
          ].slice(-50)
        }
      }));

      get().disconnect();
      get().reconnect();
    }

    // If WebSocket exists but is not OPEN, reconnect
    if (ws && ws.readyState !== WebSocket.OPEN && connectionStatus === 'connected') {
      if (isDebug) {
        console.log('[HEALTH] WebSocket not OPEN but status is connected, reconnecting');
      }
      get().disconnect();
      get().reconnect();
    }
  },

  handleVisibilityChange: () => {
    const { connectionStatus, debugInfo } = get();
    const isDebug = window.location.search.includes('debug=1');

    if (isDebug) {
      console.log('[VISIBILITY] Page visibility changed:', {
        hidden: document.hidden,
        status: connectionStatus
      });
    }

    set((state) => ({
      debugInfo: {
        ...state.debugInfo,
        eventLog: [
          ...state.debugInfo.eventLog,
          {
            type: document.hidden ? 'page_hidden' : 'page_visible',
            timestamp: new Date().toISOString()
          }
        ].slice(-50)
      }
    }));

    // When page becomes visible again
    if (!document.hidden) {
      if (isDebug) {
        console.log('[VISIBILITY] Page visible, checking connection health');
      }

      // Check connection health immediately
      get().checkConnectionHealth();

      // If disconnected, reconnect
      if (connectionStatus === 'disconnected') {
        if (isDebug) {
          console.log('[VISIBILITY] Disconnected, triggering reconnect');
        }
        get().reconnect();
      }
    }
  },

  setupLifecycleListeners: () => {
    const isDebug = window.location.search.includes('debug=1');

    if (isDebug) {
      console.log('[LIFECYCLE] Setting up visibility and focus listeners');
    }

    // Handle page visibility changes (tab switching, app backgrounding)
    const handleVisibility = () => get().handleVisibilityChange();

    // Handle page focus (additional safety net)
    const handleFocus = () => {
      const { connectionStatus } = get();
      if (isDebug) {
        console.log('[FOCUS] Page focused, status:', connectionStatus);
      }

      // Check health when page gains focus
      get().checkConnectionHealth();

      if (connectionStatus === 'disconnected') {
        if (isDebug) {
          console.log('[FOCUS] Disconnected on focus, reconnecting');
        }
        get().reconnect();
      }
    };

    // Setup listeners
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    // Set up periodic health checks (every 30 seconds)
    const healthCheckInterval = setInterval(() => {
      get().checkConnectionHealth();
    }, 30000);

    // Return cleanup function
    return () => {
      if (isDebug) {
        console.log('[LIFECYCLE] Cleaning up listeners');
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      clearInterval(healthCheckInterval);
    };
  },

  resyncAfterReconnect: async () => {
    const { currentRoom, messages } = get();
    const userId = getUserId();
    const isDebug = window.location.search.includes('debug=1');

    if (isDebug) {
      console.log('[RESYNC] Starting post-reconnect sync');
    }

    try {
      // Fetch recent messages (last 20) to catch anything missed
      const response = await fetch(`${API_URL}/rooms/${currentRoom}/messages?limit=20`, {
        headers: {
          'X-Musicr-User-Id': userId
        }
      });

      if (!response.ok) {
        console.error('[RESYNC] Failed to fetch recent messages:', response.statusText);
        return;
      }

      const data = await response.json();
      const recentMessages: Message[] = (data.messages || data).map((msg: any) => ({
        id: msg.id,
        content: msg.originalText,
        songTitle: msg.chosenSong?.title || msg.primary?.title,
        songArtist: msg.chosenSong?.artist || msg.primary?.artist,
        songYear: msg.chosenSong?.year || msg.primary?.year,
        alternates: msg.alternates || [],
        reasoning: msg.why,
        similarity: msg.primary?.score,
        timestamp: msg.timestamp || new Date().toISOString(),
        userId: msg.userId,
        anonHandle: msg.anonHandle,
        isOptimistic: false,
        reactions: msg.reactions || []
      }));

      // Merge with existing messages, avoiding duplicates
      const existingIds = new Set(messages.map(m => m.id));
      const newMessages = recentMessages.filter(m => !existingIds.has(m.id));

      if (newMessages.length > 0) {
        if (isDebug) {
          console.log(`[RESYNC] Adding ${newMessages.length} missed messages`);
        }

        set((state) => ({
          messages: [...state.messages, ...newMessages].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          ),
          debugInfo: {
            ...state.debugInfo,
            eventLog: [
              ...state.debugInfo.eventLog,
              {
                type: 'resync_complete',
                timestamp: new Date().toISOString()
              }
            ].slice(-50)
          }
        }));
      } else {
        if (isDebug) {
          console.log('[RESYNC] No new messages to add');
        }
      }

      // Re-fetch room users to ensure presence is correct
      await get().fetchRoomUsers();

    } catch (error) {
      console.error('[RESYNC] Error during resync:', error);
    }
  },

  sendMessage: (content: string) => {
    const { ws, userHandle, familyFriendly } = get();
    console.log('[SEND DEBUG] Attempting to send message:', {
      content,
      wsState: ws?.readyState,
      wsOpen: ws?.readyState === WebSocket.OPEN,
      userHandle
    });
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Add optimistic user message immediately
      const userMessage: Message = {
        id: generateId(),
        content,
        timestamp: new Date().toISOString(),
        userId: 'user',
        anonHandle: userHandle,
        isOptimistic: true
      };
      get().addMessage(userMessage);
      
      // Send to server
      const messageData = {
        type: 'msg',
        text: content
      };
      console.log('[SEND DEBUG] Sending WebSocket message:', messageData);
      ws.send(JSON.stringify(messageData));
    } else {
      console.error('[SEND DEBUG] Cannot send - WebSocket not ready:', {
        ws: !!ws,
        readyState: ws?.readyState,
        expectedOpen: WebSocket.OPEN
      });
    }
  },

  addMessage: (message: Message) => {
    set((state) => ({
      messages: [...state.messages, message],
    }));
  },

  updateMessage: (id: string, updates: Partial<Message>) => {
    set((state) => ({
      messages: state.messages.map(message =>
        message.id === id ? { ...message, ...updates } : message
      )
    }));
  },

  selectAlternate: (messageId: string, alternate: NonNullable<Message['alternates']>[0]) => {
    set((state) => ({
      messages: state.messages.map(message =>
        message.id === messageId
          ? {
              ...message,
              songTitle: alternate.title,
              songArtist: alternate.artist,
              songYear: alternate.year
            }
          : message
      )
    }));
  },

  addReaction: (messageId: string, emoji: string) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('addReaction: WebSocket not connected, reaction not sent');
      return;
    }

    ws.send(JSON.stringify({
      type: 'reaction_add',
      messageId,
      emoji
    }));
  },

  removeReaction: (messageId: string, emoji: string) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('removeReaction: WebSocket not connected, reaction not sent');
      return;
    }

    ws.send(JSON.stringify({
      type: 'reaction_remove',
      messageId,
      emoji
    }));
  },

  fetchMessageHistory: async (roomId: string, limit: number = 50) => {
    try {
      const response = await fetch(`${API_URL}/rooms/${roomId}/messages?limit=${limit}`);
      if (!response.ok) {
        console.error('Failed to fetch message history:', response.statusText);
        return;
      }

      const data = await response.json();
      // API returns { messages: [...], hasMore, oldestId }
      const messageList = data.messages || data; // Support both wrapped and unwrapped
      const messages: Message[] = messageList.map((msg: any) => ({
        id: msg.id,
        content: msg.originalText,
        songTitle: msg.chosenSong?.title || msg.primary?.title,
        songArtist: msg.chosenSong?.artist || msg.primary?.artist,
        songYear: msg.chosenSong?.year || msg.primary?.year,
        alternates: msg.alternates || [],
        reasoning: msg.why,
        similarity: msg.primary?.score,
        timestamp: msg.timestamp || new Date().toISOString(),
        userId: msg.userId,
        anonHandle: msg.anonHandle,
        isOptimistic: false
      }));

      set({
        messages,
        hasMoreHistory: data.hasMore !== undefined ? data.hasMore : messages.length >= limit
      });
    } catch (error) {
      console.error('Error fetching message history:', error);
    }
  },

  loadOlderMessages: async () => {
    const { messages, currentRoom, isLoadingHistory, hasMoreHistory } = get();

    if (isLoadingHistory || !hasMoreHistory || messages.length === 0) {
      return;
    }

    set({ isLoadingHistory: true });

    try {
      const userId = getUserId();
      const oldestMessage = messages[0];
      const oldCount = messages.length;
      const fetchUrl = `${API_URL}/rooms/${currentRoom}/messages?limit=50&before=${oldestMessage.id}`;

      if (window.location.search.includes('debug=1')) {
        console.log('[STORE] Fetching older messages from:', fetchUrl);
      }

      const response = await fetch(fetchUrl, {
        headers: {
          'X-Musicr-User-Id': userId
        }
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        console.error('[STORE] Failed to load older messages:', {
          status: response.status,
          statusText: response.statusText,
          url: fetchUrl,
          body: errorBody
        });
        set({ isLoadingHistory: false });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      // API returns { messages: [...], hasMore, oldestId }
      const messageList = data.messages || data; // Support both wrapped and unwrapped
      const olderMessages: Message[] = messageList.map((msg: any) => ({
        id: msg.id,
        content: msg.originalText,
        songTitle: msg.chosenSong?.title || msg.primary?.title,
        songArtist: msg.chosenSong?.artist || msg.primary?.artist,
        songYear: msg.chosenSong?.year || msg.primary?.year,
        alternates: msg.alternates || [],
        reasoning: msg.why,
        similarity: msg.primary?.score,
        timestamp: msg.timestamp || new Date().toISOString(),
        userId: msg.userId,
        anonHandle: msg.anonHandle,
        isOptimistic: false,
        reactions: msg.reactions || []
      }));

      const newHasMore = data.hasMore !== undefined ? data.hasMore : olderMessages.length >= 50;

      console.log(`[STORE] Loaded ${olderMessages.length} older messages:`, {
        cursor: oldestMessage.id,
        loaded: olderMessages.length,
        oldTotal: oldCount,
        newTotal: oldCount + olderMessages.length,
        hasMore: newHasMore
      });

      set({
        messages: [...olderMessages, ...messages],
        isLoadingHistory: false,
        hasMoreHistory: newHasMore
      });
    } catch (error) {
      console.error('[STORE] Error loading older messages:', error);
      set({ isLoadingHistory: false });
      throw error; // Re-throw so UI can handle it
    }
  }
}));