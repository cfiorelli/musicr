# SSL/TLS Configuration for PostgreSQL

## Overview

This document explains SSL configuration for the musicr database connection across different environments.

## SSL Modes

PostgreSQL supports several SSL modes via the `sslmode` parameter:

| Mode | Behavior | Security |
|------|----------|----------|
| `disable` | No SSL (plaintext) | ❌ Not secure |
| `allow` | Try non-SSL, fallback to SSL | ⚠️ Weak |
| `prefer` | Try SSL, fallback to non-SSL | ⚠️ Better but can downgrade |
| `require` | SSL required, no cert verification | ✅ Good for most cases |
| `verify-ca` | SSL + verify server cert against CA | ✅ More secure |
| `verify-full` | SSL + verify cert + hostname | ✅ Most secure |

## Configuration by Environment

### Production (Railway, AWS RDS, etc.)

**Always use `sslmode=require` or higher:**

```bash
DATABASE_URL="postgresql://user:password@host:port/database?sslmode=require"
```

Railway PostgreSQL **does support SSL** and should be used in production:
```bash
# Railway example
DATABASE_URL="postgresql://postgres:***@your-app.proxy.rlwy.net:27490/railway?sslmode=require"
```

### Local Development (Docker Compose)

The docker-compose.yml uses `sslmode=prefer` which works for local development:
```yaml
DATABASE_URL: postgresql://musicr:password@database:5432/musicr?schema=public&sslmode=prefer
```

### Testing SSL Connection

```bash
# Test if SSL is available
psql "postgresql://user:password@host:port/database?sslmode=require" -c "SELECT version();"

# Check if SSL is active in your connection
psql "your-database-url" -c "SELECT ssl_is_used();"
```

## Current Configuration

### Code Files

- **Schema:** [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma#L9-L12)
  - Uses `env("DATABASE_URL")` - SSL mode controlled via environment variable

- **Environment Config:** [apps/api/src/config/env.ts](apps/api/src/config/env.ts#L13-L37)
  - Constructs DATABASE_URL from Railway env vars if not explicitly set
  - No SSL mode specified in code (defers to environment)

- **Docker Compose:** [docker-compose.yml](docker-compose.yml#L38)
  - Uses `sslmode=prefer` for local development

### Environment Files

- [.env.example](.env.example#L27) - Updated to recommend `sslmode=require`
- [apps/api/.env.example](apps/api/.env.example#L10-L12) - Updated to recommend `sslmode=require`

## Migration from sslmode=disable

### Phase 1 (Completed)
Used `sslmode=disable` for initial testing and debugging.

### Phase 2 (Current)
**Action:** All production deployments should use `sslmode=require`.

**Steps:**
1. Update Railway environment variable:
   ```bash
   # In Railway dashboard or CLI
   railway variables set DATABASE_URL="postgresql://postgres:***@host:port/railway?sslmode=require"
   ```

2. Verify SSL is working:
   ```bash
   psql "postgresql://postgres:***@host:port/railway?sslmode=require" -c "SELECT version();"
   ```

3. If connection fails:
   - Check if Railway PostgreSQL has SSL enabled (it should by default)
   - Try `sslmode=prefer` as fallback (less secure but more compatible)
   - Check Railway logs for SSL-related errors

## Recommendations

1. **Production:** Always use `sslmode=require` minimum
2. **Staging:** Use `sslmode=require`
3. **Local Dev:** Use `sslmode=prefer` or `sslmode=disable` (Docker Compose default is fine)
4. **CI/CD:** Use `sslmode=require` if connecting to cloud databases

## Railway SSL Support

Railway PostgreSQL **supports SSL by default**. If you encounter connection issues:

1. Verify the connection works with `sslmode=disable` first (debugging only)
2. Check Railway dashboard for any SSL-related settings
3. Ensure your Railway PostgreSQL instance is not an old version
4. Contact Railway support if SSL is genuinely unavailable

## Security Impact

Using `sslmode=disable` in production means:
- ❌ Database credentials transmitted in plaintext
- ❌ Query data visible to network observers
- ❌ Vulnerable to man-in-the-middle attacks

**Never use `sslmode=disable` in production.**
