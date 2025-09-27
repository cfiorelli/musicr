import { create } from 'zustand';

// Simple UUID generator for compatibility
function generateId() {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
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
  
  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setFamilyFriendly: (value: boolean) => void;
  selectAlternate: (messageId: string, alternate: NonNullable<Message['alternates']>[0]) => void;
  getUserSession: () => Promise<void>;
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
        
        // Join default room
        websocket.send(JSON.stringify({
          type: 'join',
          roomName: get().currentRoom
        }));
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
            // Message from another user
            const message: Message = {
              id: generateId(),
              content: data.originalText,
              songTitle: data.primary?.title,
              songArtist: data.primary?.artist,
              songYear: data.primary?.year,
              alternates: data.alternates,
              reasoning: data.why?.reasoning || data.why?.matchedPhrase,
              timestamp: new Date().toISOString(),
              userId: data.userId,
              anonHandle: data.anonHandle,
            };
            get().addMessage(message);
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