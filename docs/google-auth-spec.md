# Google Auth (Google-First MVP) — Spec

_Created: 2026-02-23_

## 1. Goal

Add Google Sign-In to Musicr as an opt-in layer on top of the existing anonymous
session system. Signed-in users get a persistent identity tied to their Google
account. Anonymous usage remains the default and is never gated.

## 2. Non-Goals

- No password auth, no other OAuth providers in this phase
- No user profile pages or public identity features
- No content restrictions or features gated behind auth
- No migration of existing anon messages to a Google account (best-effort only)
- No email verification flow (Google is already verified)
- No admin role or permission system

## 3. Flow

```
Anonymous (default, unchanged):
  User visits → room + chat work as before, no sign-in required

Sign-in flow:
  User clicks "Sign in with Google" →
    GET /auth/google/start
      → generate state token (stored in signed cookie)
      → redirect to Google OAuth consent screen

  Google redirects to →
    GET /auth/google/callback?code=...&state=...
      → validate state (CSRF check)
      → exchange code for tokens (Google API)
      → fetch Google user info (sub, email, name, picture)
      → find or create AuthUser (by google_sub)
      → create AuthSession (random token, hashed, 30d expiry)
      → set session cookie (musicr_session, HttpOnly, Secure, SameSite=Lax)
      → attempt anon-to-user link (non-destructive, best-effort)
      → redirect to / (app)

Session bootstrap (on every page load):
    GET /auth/session
      → reads musicr_session cookie
      → looks up AuthSession by hash, checks expiry
      → returns { userId, displayName, email, avatar } or { user: null }

Sign-out:
    POST /auth/logout
      → deletes AuthSession row
      → clears musicr_session cookie
      → returns 200

Web app:
  - Zustand authStore: { user: AuthUser | null, loading: bool }
  - on mount: fetch /auth/session → populate store
  - header/nav: show "Sign in with Google" | display name + avatar + "Sign out"
  - anonymous chat still works regardless of auth state
```

## 4. Data + API Changes

### New Prisma model: AuthUser

```
id          String  @id @default(uuid())
googleSub   String  @unique   -- Google subject ID
email       String
displayName String?
avatar      String?           -- URL
createdAt   DateTime @default(now())
updatedAt   DateTime @updatedAt

INDEX: googleSub, email
```

### New Prisma model: AuthSession

```
id          String   @id @default(uuid())
tokenHash   String   @unique   -- SHA-256(raw_token), hex
authUserId  String
expiresAt   DateTime
createdAt   DateTime @default(now())
anonUserId  String?  @db.Uuid  -- anon User.id at time of login (for linking)

RELATION: AuthUser (cascade delete)
INDEX: tokenHash, expiresAt, authUserId
```

### New API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/google/start` | Redirect to Google OAuth |
| GET | `/auth/google/callback` | OAuth callback, create session |
| POST | `/auth/logout` | Destroy session |
| GET | `/auth/session` | Return current session info |

### Cookie: `musicr_session`
- Value: raw random token (32 bytes, hex)
- HttpOnly: true
- Secure: true (prod), false (dev)
- SameSite: Lax
- MaxAge: 30 days

### Required env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 Client ID from Google Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 Client Secret |
| `APP_BASE_URL` | Yes | Full public URL, e.g. `https://musicrweb-production.up.railway.app` |
| `SESSION_SECRET` | Prod only | 32+ byte random for state token signing (falls back to COOKIE_SECRET) |

### Google Console config

Authorized redirect URIs:
- `https://musicrweb-production.up.railway.app/auth/google/callback` (prod)
- `http://localhost:4000/auth/google/callback` (local dev)

Note: The callback is served by the **API**, not the web app.

## 5. Failure Modes

| Failure | Handling |
|---------|----------|
| State mismatch (CSRF) | Return 400, log warning, clear state cookie |
| Google token exchange fails | Return 500, log error |
| Google user info missing `sub` | Return 500, discard token |
| Duplicate google_sub on insert | `upsert` — update name/avatar, reuse user |
| Session not found or expired | Return `{ user: null }`, clear cookie |
| Anon-to-user link fails | Log warning, continue (sign-in still succeeds) |
| Cookie not set (missing Secure on HTTP) | Dev: allow non-secure; prod: Secure always |
| Auth routes unavailable | Anon flow continues unaffected |

## 6. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Rooms and chat work without any sign-in (anonymous default preserved) |
| 2 | Clicking "Sign in with Google" initiates OAuth and redirects to Google |
| 3 | After Google auth, session cookie is set and `/auth/session` returns user data |
| 4 | Refreshing the page preserves the signed-in state |
| 5 | "Sign out" clears session and returns to anonymous state |
| 6 | State mismatch (CSRF attempt) returns 400 with no session created |
| 7 | Two login events with the same Google account do not create duplicate AuthUser rows |
| 8 | Session expires after 30 days |
| 9 | Session token stored hashed (SHA-256) in DB; raw token only in cookie |
| 10 | `/auth/session` returns `{ user: null }` for unauthenticated requests (not 4xx) |
| 11 | All auth routes pass through existing IP blocklist middleware |
| 12 | No existing test or anonymous chat flow regresses |

## 7. Anonymous-to-User Linking (Best-Effort)

When a user signs in, the `anonUserId` (the anon `User.id` stored in the WS session)
is saved on `AuthSession`. This allows future features to attribute pre-login messages
to the authenticated account. No messages are re-attributed in this phase.

## 8. Security Notes

- State token is a random 32-byte nonce set as a short-lived cookie (10 min); validated
  on callback before any token exchange
- Session token is `crypto.randomBytes(32).toString('hex')` — 256 bits of entropy
- Token stored as `SHA-256(token)` in the DB; raw value only exists in the cookie
- All auth routes inherit the existing IP blocklist hook
- `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` never logged or exposed in responses
