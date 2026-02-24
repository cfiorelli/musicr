# Google Auth Setup Guide

_Last updated: 2026-02-24_

## Overview

Google Sign-In is an opt-in layer. Anonymous chat always works without it.
The auth flow is: web app → API `/auth/google/start` → Google → API
`/auth/google/callback` → redirects back to web app with session cookie set.

---

## Required environment variables

Set these on the **API** service in Railway:

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 Client ID from Google Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 Client Secret |
| `APP_API_BASE_URL` | Yes | Full public URL of the **API** service, e.g. `https://musicrapi-production.up.railway.app` |
| `COOKIE_SECRET` | Prod | 32+ byte random string for signing cookies |

`APP_API_BASE_URL` is used to build the OAuth callback URL
(`${APP_API_BASE_URL}/auth/google/callback`). This must match what is
registered in the Google Console exactly.

---

## Google Console setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. Enable the **Google Identity** / **OAuth 2.0** API
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add Authorized redirect URIs:

   ```
   https://musicrapi-production.up.railway.app/auth/google/callback
   http://localhost:4000/auth/google/callback
   ```

7. Copy **Client ID** and **Client secret** → set as env vars on Railway

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/google/start` | Redirect to Google OAuth (requires env configured) |
| `GET` | `/auth/google/callback` | Handle OAuth callback, create session, redirect to web |
| `GET` | `/auth/session` | Return `{ user }` or `{ user: null }` |
| `POST` | `/auth/logout` | Delete session, clear cookie |

If `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are not set, `/auth/google/start`
returns `503`. All other auth routes work normally (session/logout).

---

## Session cookie

Name: `musicr_session`
- HttpOnly, Secure (prod), SameSite=Lax
- 30-day expiry
- Value: 32-byte random hex (64 chars)
- Stored in DB as SHA-256 hash (never raw token in DB)

---

## Local development

```bash
# .env (apps/api/.env)
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
APP_API_BASE_URL=http://localhost:4000
```

Visit `http://localhost:4000/auth/google/start` to test the flow locally.
Add `http://localhost:4000/auth/google/callback` to the Google Console redirect URIs.

---

## DB tables used

| Table | Purpose |
|-------|---------|
| `auth_users` | One row per Google account (`google_sub` unique key) |
| `auth_sessions` | Server-side sessions (token stored hashed) |

---

## Rollback

Auth is fully additive — no existing flows are affected. To disable:
1. Remove `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env vars → `/auth/google/start` returns 503
2. OR: Redeploy without the auth routes (remove import + route block from index.ts)
The anonymous chat flow is unaffected in either case.
