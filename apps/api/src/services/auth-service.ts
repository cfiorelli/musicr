/**
 * Google Auth Service
 *
 * Handles Google OAuth flow, session creation/validation, and user management.
 * Sessions are DB-backed for multi-instance correctness on Railway.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID      — OAuth 2.0 Client ID
 *   GOOGLE_CLIENT_SECRET  — OAuth 2.0 Client Secret
 *   APP_BASE_URL          — Public app URL (e.g. https://musicrweb-production.up.railway.app)
 *                           The callback hits the API, so this should be the API base URL in prod.
 *                           Set APP_API_BASE_URL for the API if separate from the web app.
 */

import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Config helpers (read at call time — not at import time to allow lazy loading)
// ---------------------------------------------------------------------------

export function getAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  // API base URL for constructing the callback. Falls back to APP_BASE_URL.
  const apiBaseUrl = process.env.APP_API_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:4000';

  return { clientId, clientSecret, apiBaseUrl };
}

export function isAuthConfigured(): boolean {
  const { clientId, clientSecret } = getAuthConfig();
  return !!(clientId && clientSecret);
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SESSION_COOKIE = 'musicr_session';
const STATE_COOKIE = 'musicr_oauth_state';
const SESSION_TTL_DAYS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;          // AuthUser.id
  email: string;
  displayName: string | null;
  avatar: string | null;
}

interface GoogleUserInfo {
  id: string;          // Google subject
  email: string;
  name?: string;
  picture?: string;
  verified_email?: boolean;
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

// ---------------------------------------------------------------------------
// AuthService class
// ---------------------------------------------------------------------------

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  // Build the Google OAuth redirect URL + generate state token
  buildAuthUrl(): { url: string; state: string } {
    const { clientId, apiBaseUrl } = getAuthConfig();
    const state = generateToken(24);
    const callbackUrl = `${apiBaseUrl}/auth/google/callback`;

    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
    });

    return { url: `${GOOGLE_AUTH_URL}?${params}`, state };
  }

  // Exchange OAuth code for tokens + fetch user info
  async exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
    const { clientId, clientSecret, apiBaseUrl } = getAuthConfig();
    const callbackUrl = `${apiBaseUrl}/auth/google/callback`;

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Google token exchange failed (${tokenRes.status}): ${body}`);
    }

    const tokens = await tokenRes.json() as { access_token: string };

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      throw new Error(`Google userinfo fetch failed (${userRes.status})`);
    }

    return await userRes.json() as GoogleUserInfo;
  }

  // Find or create AuthUser from Google profile. Upserts on google_sub.
  async findOrCreateUser(googleUser: GoogleUserInfo): Promise<{ id: string }> {
    const user = await this.prisma.authUser.upsert({
      where: { googleSub: googleUser.id },
      create: {
        googleSub: googleUser.id,
        email: googleUser.email,
        displayName: googleUser.name ?? null,
        avatar: googleUser.picture ?? null,
      },
      update: {
        // Update mutable profile fields on each login
        displayName: googleUser.name ?? null,
        avatar: googleUser.picture ?? null,
      },
      select: { id: true },
    });
    return user;
  }

  // Create a new session for an AuthUser. Returns raw token (for cookie).
  async createSession(authUserId: string, anonUserId?: string): Promise<string> {
    const rawToken = generateToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.authSession.create({
      data: {
        tokenHash,
        authUserId,
        expiresAt,
        anonUserId: anonUserId ?? null,
      },
    });

    return rawToken;
  }

  // Validate session from raw token. Returns user info or null if invalid/expired.
  async validateSession(rawToken: string): Promise<SessionUser | null> {
    const tokenHash = hashToken(rawToken);

    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { authUser: { select: { id: true, email: true, displayName: true, avatar: true } } },
    });

    if (!session) return null;
    if (session.expiresAt < new Date()) {
      // Expired — clean up
      await this.prisma.authSession.delete({ where: { tokenHash } }).catch(() => {});
      return null;
    }

    return {
      id: session.authUser.id,
      email: session.authUser.email,
      displayName: session.authUser.displayName,
      avatar: session.authUser.avatar,
    };
  }

  // Delete session by raw token.
  async deleteSession(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.authSession.delete({ where: { tokenHash } }).catch(() => {});
  }

  // Cookie name constants (exported for use in routes)
  static readonly SESSION_COOKIE = SESSION_COOKIE;
  static readonly STATE_COOKIE = STATE_COOKIE;
}
