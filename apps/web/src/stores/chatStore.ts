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
  familyFriendly: boolean;
  selectedMessage: string | null;
  alternates: Message['alternates'];
  roomUsers: RoomUser[];
  
  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setFamilyFriendly: (value: boolean) => void;
  selectAlternate: (messageId: string, alternate: NonNullable<Message['alternates']>[0]) => void;
  getUserSession: () => Promise<void>;
  fetchRoomUsers: () => Promise<void>;
  addRoomUser: (user: RoomUser) => void;
  removeRoomUser: (userId: string) => void;
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
  familyFriendly: true,
  selectedMessage: null,
  alternates: [],
  roomUsers: [],

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
        
        // Send initial preference to server
        const { familyFriendly } = get();
        websocket.send(JSON.stringify({
          type: 'pref',
          familyFriendly
        }));
        
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
                isOptimistic: false
              });
            } else {
              console.log('No optimistic message found to update');
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
            // Connection confirmation - update user handle and fetch room users
            set({ userHandle: data.anonHandle });
            console.log('Connected to room:', data.roomName, 'as', data.anonHandle);
            console.log('Current users before API fetch:', get().roomUsers.length);
            
            // Fetch current room users from API
            get().fetchRoomUsers();
            get().fetchRoomUsers();
            
            // Set up periodic user list validation (every 60 seconds)
            // Only sync if we suspect missing users (don't overwrite working real-time updates)
            const syncInterval = setInterval(() => {
              const currentState = get();
              if (currentState.connectionStatus === 'connected') {
                // Only sync if we have very few users (likely missing some)
                if (currentState.roomUsers.length <= 1) {
                  console.log('Few users detected, syncing user list...', currentState.roomUsers.length);
                  currentState.fetchRoomUsers();
                } else {
                  console.log('Room has', currentState.roomUsers.length, 'users, skipping sync');
                }
              } else {
                clearInterval(syncInterval);
              }
            }, 60000); // Increased to 60 seconds
          } else if (data.type === 'user_joined') {
            // New user joined the room
            const { addRoomUser } = get();
            const newUser = {
              userId: data.user.id,
              handle: data.user.handle,
              joinedAt: data.timestamp
            };
            addRoomUser(newUser);
            console.log('User joined:', data.user.handle, 'Total users now:', get().roomUsers.length);
          } else if (data.type === 'user_left') {
            // User left the room
            const { removeRoomUser } = get();
            removeRoomUser(data.user.id);
            console.log('User left:', data.user.handle);
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
        text: content,
        allowExplicit: !familyFriendly
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

  setFamilyFriendly: (value: boolean) => {
    set({ familyFriendly: value });
    
    // Send preference update to server
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'pref',
        familyFriendly: value
      }));
    }
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
  }
}));