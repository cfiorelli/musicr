import { create } from 'zustand';

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

const WS_URL = 'ws://localhost:4000/ws';
const API_URL = 'http://localhost:4000/api';

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
          
          if (data.type === 'song') {
            // Update optimistic message with song result
            const { messages, updateMessage } = get();
            const lastUserMessage = messages.filter(m => m.userId === 'user').pop();
            
            if (lastUserMessage && lastUserMessage.isOptimistic) {
              updateMessage(lastUserMessage.id, {
                songTitle: data.primary?.title,
                songArtist: data.primary?.artist,
                songYear: data.primary?.year,
                alternates: data.alternates,
                reasoning: data.why?.reasoning || data.why?.matchedPhrase,
                isOptimistic: false
              });
            }
          } else if (data.type === 'display') {
            // Message from another user
            const message: Message = {
              id: crypto.randomUUID(),
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Add optimistic user message immediately
      const userMessage: Message = {
        id: crypto.randomUUID(),
        content,
        timestamp: new Date().toISOString(),
        userId: 'user',
        anonHandle: userHandle,
        isOptimistic: true
      };
      get().addMessage(userMessage);
      
      // Send to server
      ws.send(JSON.stringify({ 
        type: 'msg', 
        text: content,
        allowExplicit: !familyFriendly
      }));
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