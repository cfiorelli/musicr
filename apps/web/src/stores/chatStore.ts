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
  isModeration?: boolean;
  moderationCategory?: string;
}

export interface ChatState {
  messages: Message[];
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  ws: WebSocket | null;
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
  };

  connect: () => void;
  disconnect: () => void;
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

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  connectionStatus: 'disconnected',
  ws: null,
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
      const response = await fetch(`${API_URL}/user/session`, {
        credentials: 'include'
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
      console.log('Fetching room users for room:', currentRoom);
      const response = await fetch(`${API_URL}/rooms/${currentRoom}/users`, {
        credentials: 'include'
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
      const websocket = new WebSocket(WS_URL);
      
      websocket.onopen = () => {
        console.log('WebSocket connected');
        set({ connectionStatus: 'connected', ws: websocket });

        // Room joining happens automatically on the server side
      };
      
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket received data:', data);
          
          if (data.type === 'song') {
            // Update optimistic message with song result
            const { messages, updateMessage } = get();
            const lastUserMessage = messages.filter(m => m.userId === 'user').pop();
            console.log('Looking for optimistic message to update:', lastUserMessage);
            
            if (lastUserMessage && lastUserMessage.isOptimistic) {
              console.log('Updating optimistic message with song result:', data);
              updateMessage(lastUserMessage.id, {
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
            // Connection confirmation - update user handle
            set((state) => ({
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
                              hasReacted: data.userId === state.user?.id || r.hasReacted
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
                          hasReacted: data.userId === state.user?.id
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
                          hasReacted: r.hasReacted && data.userId !== state.user?.id
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
          } else if (data.type === 'moderation_notice') {
            // Content was moderated - show notice to sender
            const moderationMessage: Message = {
              id: generateId(),
              content: data.message,
              timestamp: new Date().toISOString(),
              userId: 'system',
              anonHandle: 'System',
              isModeration: true,
              moderationCategory: data.category
            };
            get().addMessage(moderationMessage);
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
        console.error('WebSocket error:', error);
        set({ connectionStatus: 'disconnected' });
      };
      
      websocket.onclose = () => {
        console.log('WebSocket disconnected');
        set({ connectionStatus: 'disconnected', ws: null });
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'reaction_add',
      messageId,
      emoji
    }));
  },

  removeReaction: (messageId: string, emoji: string) => {
    const { ws } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'reaction_remove',
      messageId,
      emoji
    }));
  },

  fetchMessageHistory: async (roomId: string, limit: number = 50) => {
    try {
      const response = await fetch(`${API_URL}/api/rooms/${roomId}/messages?limit=${limit}`);
      if (!response.ok) {
        console.error('Failed to fetch message history:', response.statusText);
        return;
      }

      const data = await response.json();
      const messages: Message[] = data.map((msg: any) => ({
        id: msg.id,
        content: msg.originalText,
        songTitle: msg.primary?.title,
        songArtist: msg.primary?.artist,
        songYear: msg.primary?.year,
        alternates: msg.alternates || [],
        reasoning: msg.why,
        similarity: msg.primary?.score,
        timestamp: new Date().toISOString(),
        userId: msg.userId,
        anonHandle: msg.anonHandle,
        isOptimistic: false
      }));

      set({
        messages,
        hasMoreHistory: messages.length >= limit
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
      const oldestMessage = messages[0];
      const response = await fetch(
        `${API_URL}/api/rooms/${currentRoom}/messages?limit=50&before=${oldestMessage.id}`
      );

      if (!response.ok) {
        console.error('Failed to load older messages:', response.statusText);
        set({ isLoadingHistory: false });
        return;
      }

      const data = await response.json();
      const olderMessages: Message[] = data.map((msg: any) => ({
        id: msg.id,
        content: msg.originalText,
        songTitle: msg.primary?.title,
        songArtist: msg.primary?.artist,
        songYear: msg.primary?.year,
        alternates: msg.alternates || [],
        reasoning: msg.why,
        similarity: msg.primary?.score,
        timestamp: new Date().toISOString(),
        userId: msg.userId,
        anonHandle: msg.anonHandle,
        isOptimistic: false
      }));

      set({
        messages: [...olderMessages, ...messages],
        isLoadingHistory: false,
        hasMoreHistory: olderMessages.length >= 50
      });
    } catch (error) {
      console.error('Error loading older messages:', error);
      set({ isLoadingHistory: false });
    }
  }
}));