/**
 * API URL utility for making backend requests
 * Uses VITE_API_URL env var if set, otherwise derives from window.location
 */

const { VITE_API_URL } = (import.meta as any).env || {};

function deriveApiUrl(): string {
  try {
    const loc = window.location;
    const host = loc.hostname;
    // Backend runs on port 4000 by default
    const apiOrigin = `${loc.protocol}//${host}:4000`;
    return `${apiOrigin}/api`;
  } catch (error) {
    // Fallback if window is not available (SSR context)
    return 'http://localhost:4000/api';
  }
}

export const API_URL = VITE_API_URL || deriveApiUrl();
