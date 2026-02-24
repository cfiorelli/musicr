/**
 * Auth store — manages Google-authenticated user state.
 *
 * Anonymous chat is always available regardless of auth state.
 * This is an opt-in layer on top of the existing anon session.
 */

import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatar: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** URL of the API server (without /api suffix), for auth endpoints */
  apiOrigin: string;

  /** Fetch session on app mount */
  bootstrap: () => Promise<void>;
  /** Start Google sign-in (redirects away from the page) */
  signIn: () => void;
  /** Sign out: destroy session on server + clear local state */
  signOut: () => Promise<void>;
}

// Derive API origin from VITE_API_URL or window.location (same logic as chatStore)
function deriveApiOrigin(): string {
  try {
    const viteApiUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
    if (viteApiUrl) {
      // VITE_API_URL is the full /api url — strip the /api suffix
      return viteApiUrl.replace(/\/api$/, '');
    }
    const loc = window.location;
    return `${loc.protocol}//${loc.hostname}:4000`;
  } catch {
    return 'http://localhost:4000';
  }
}

const API_ORIGIN = deriveApiOrigin();

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  loading: true,
  apiOrigin: API_ORIGIN,

  bootstrap: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${API_ORIGIN}/auth/session`, { credentials: 'include' });
      if (!res.ok) {
        set({ user: null, loading: false });
        return;
      }
      const data = await res.json() as { user: AuthUser | null };
      set({ user: data.user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  signIn: () => {
    // Redirect to API which handles the OAuth flow
    window.location.href = `${API_ORIGIN}/auth/google/start`;
  },

  signOut: async () => {
    try {
      await fetch(`${API_ORIGIN}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network errors — still clear local state
    }
    set({ user: null });
  },
}));
