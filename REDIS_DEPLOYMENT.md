# Redis Deployment Guide

## Overview

Musicr supports two deployment modes:

1. **Standalone Mode** (no Redis) - Single backend instance, all state in-memory
2. **Multi-Instance Mode** (with Redis) - Multiple backend instances with coordinated state

## When Do You Need Redis?

### You DON'T need Redis if:
- Running locally for development
- Single backend instance deployment
- Low traffic application
- Deploying to a platform with sticky sessions (all tabs connect to same instance)

### You NEED Redis if:
- Horizontal scaling with multiple backend instances
- Railway auto-scaling enabled
- Platform load-balances requests across instances
- Users report: "Other users don't show up" or "Reactions not syncing"

## Quick Start: Local Development (No Redis)

```bash
# No configuration needed!
cd apps/api
pnpm dev
```

Application runs in standalone mode automatically.

## Local Development with Redis (Testing Multi-Instance)

### 1. Install Redis

**macOS:**
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian:**
```bash
sudo apt-get install redis-server
sudo systemctl start redis
```

**Docker:**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

### 2. Configure Environment

```bash
# apps/api/.env
REDIS_URL=redis://localhost:6379
DEBUG_PRESENCE=1  # Optional: see instance coordination logs
```

### 3. Start Application

```bash
cd apps/api
pnpm dev
```

Look for log line:
```
Redis publisher connected
Redis presence subscriptions active
Redis reaction subscriptions active
```

### 4. Test Multi-Instance Simulation

**Terminal 1:**
```bash
cd apps/api
PORT=4000 pnpm dev
```

**Terminal 2:**
```bash
cd apps/api
PORT=4001 pnpm dev
```

**Terminal 3 (Frontend for instance 1):**
```bash
cd apps/web
VITE_API_URL=http://localhost:4000 pnpm dev --port 5173
```

**Terminal 4 (Frontend for instance 2):**
```bash
cd apps/web
VITE_API_URL=http://localhost:4001 pnpm dev --port 5174
```

Open:
- http://localhost:5173?debug=1
- http://localhost:5174?debug=1

They should show different instance IDs but synced user lists!

## Railway Deployment

### Option 1: Add Redis Addon (Recommended)

1. Go to Railway project dashboard
2. Click "New" → "Database" → "Add Redis"
3. Railway automatically sets `REDIS_URL` environment variable
4. Redeploy your API service (automatic if using GitHub integration)

### Option 2: External Redis (Upstash, Redis Cloud)

1. Create Redis instance at provider
2. Get connection URL (format: `redis://user:password@host:port`)
3. Add to Railway environment variables:
   ```
   REDIS_URL=redis://your-redis-url
   ```
4. Redeploy

### Verification

Check Railway logs for:
```
[INFO] Redis publisher connected
[INFO] Redis presence subscriptions active
[INFO] Redis reaction subscriptions active
[INFO] Connection manager initialized { instanceId: '...', redisEnabled: true }
```

If you see errors:
```
[WARN] Redis not configured - running in standalone mode
```

Then `REDIS_URL` is not set correctly.

## Redis Providers

### Railway Redis (Easiest)
- **Pros:** Auto-configured, same network, low latency
- **Cons:** Costs money (but affordable)
- **Setup:** One click addon

### Upstash (Free Tier Available)
- **URL:** https://upstash.com
- **Pros:** Free tier, serverless, global
- **Cons:** Higher latency (external network)
- **Setup:**
  1. Create database
  2. Copy "Redis URL"
  3. Set as `REDIS_URL` in Railway

### Redis Cloud (Free Tier Available)
- **URL:** https://redis.com/cloud
- **Pros:** Free 30MB tier
- **Cons:** External network
- **Setup:** Similar to Upstash

## Connection URL Formats

```bash
# Basic
REDIS_URL=redis://localhost:6379

# With password
REDIS_URL=redis://:password@hostname:6379

# With username and password (Redis 6+)
REDIS_URL=redis://username:password@hostname:6379

# TLS/SSL
REDIS_URL=rediss://hostname:6379
```

## Monitoring Redis

### Check Connection

```bash
# Local Redis
redis-cli ping
# Should return: PONG

# Remote Redis
redis-cli -u redis://your-url ping
```

### Inspect Presence Data

```bash
redis-cli
> SMEMBERS presence:default
# Shows all user IDs in "default" room

> KEYS presence:*
# Shows all presence keys (one per room)
```

### Inspect Pub/Sub Activity

```bash
redis-cli
> SUBSCRIBE presence:events
# You'll see messages when users join/leave

> SUBSCRIBE reactions:events
# You'll see messages when reactions added/removed
```

### Clear All Data (Reset)

```bash
redis-cli
> FLUSHDB
# Clears all presence data (users will re-populate on next connect)
```

## Troubleshooting

### "Redis not connected" errors

**Check connection string:**
```bash
# apps/api/.env
REDIS_URL=redis://localhost:6379  # Must be valid
```

**Test connection:**
```bash
redis-cli -u $REDIS_URL ping
```

**Check logs:**
```bash
cd apps/api
DEBUG_PRESENCE=1 pnpm dev
```

### Users not syncing across instances

**Verify Redis is enabled:**
```
[INFO] Connection manager initialized { instanceId: '...', redisEnabled: true }
```

If `redisEnabled: false`, Redis connection failed.

**Check pub/sub:**
```bash
redis-cli
> PUBSUB CHANNELS
# Should show: presence:events, reactions:events
```

### Performance Issues

**Increase connection pool (optional):**

Redis defaults to 1 connection per publisher/subscriber. For high traffic:

```typescript
// apps/api/src/services/redis-service.ts
// Modify initialization if needed

this.publisher = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
  // Add these for high traffic:
  enableReadyCheck: true,
  maxLoadingRetryTime: 3000
});
```

**Monitor latency:**

```bash
redis-cli --latency
```

Should be <10ms for local, <50ms for cloud.

## Cost Estimates

### Railway Redis Addon
- **~$5/month** for 256MB
- Scales with usage

### Upstash Free Tier
- 10,000 commands/day
- 256MB storage
- Serverless pricing after free tier

### Redis Cloud Free Tier
- 30MB storage
- Sufficient for presence (stores user IDs only)
- Estimate: ~1KB per user = 30,000 users

## Scaling Strategy

### Small App (<100 concurrent users)
- **Recommendation:** Standalone mode (no Redis)
- **Cost:** $0 for Redis
- **Setup:** Nothing to configure

### Medium App (100-1000 users)
- **Recommendation:** Railway Redis addon
- **Cost:** ~$5/month
- **Setup:** One-click addon

### Large App (1000+ users)
- **Recommendation:** Redis Cloud or dedicated instance
- **Cost:** ~$15-50/month
- **Setup:** External provider + REDIS_URL

## Architecture with Redis

```
┌──────────────┐         ┌──────────────┐
│  Browser A   │         │  Browser B   │
│  (Tab 1)     │         │  (Tab 2)     │
└──────┬───────┘         └──────┬───────┘
       │ WebSocket              │ WebSocket
       │                        │
       ▼                        ▼
┌──────────────┐         ┌──────────────┐
│ API Instance │         │ API Instance │
│      #1      │         │      #2      │
│  (Port 4000) │         │  (Port 4001) │
└──────┬───────┘         └──────┬───────┘
       │                        │
       │    ┌────────────┐     │
       └───▶│   Redis    │◀────┘
            │  Pub/Sub   │
            └────────────┘

User joins in Tab 1:
1. Instance #1 handles WebSocket
2. Instance #1 broadcasts locally
3. Instance #1 publishes to Redis
4. Instance #2 receives from Redis
5. Instance #2 broadcasts to Tab 2
6. Both tabs see user joined!
```

## Security

### Production Checklist

- [ ] Use TLS for Redis connection (`rediss://`)
- [ ] Set strong Redis password
- [ ] Restrict Redis network access (firewall)
- [ ] Enable AUTH on Redis server
- [ ] Use environment variables (never hardcode URLs)
- [ ] Rotate Redis password periodically

### Railway Security

Railway Redis addon:
- ✅ Automatic AUTH password
- ✅ Private network (not public internet)
- ✅ Encrypted in transit (TLS)
- ✅ Managed backups

## Performance Tuning

### Redis Configuration

For production, consider:

```redis
# In redis.conf
maxmemory 256mb
maxmemory-policy allkeys-lru  # Evict least recently used keys
appendonly no  # Pub/sub doesn't need persistence
save ""  # Disable RDB snapshots (presence is ephemeral)
```

### Application Optimization

```typescript
// apps/api/src/services/redis-service.ts

// Connection pooling (for very high traffic)
const publisher = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableOfflineQueue: false  // Fail fast if Redis down
});
```

## Backup and Recovery

### Presence Data

Presence is **ephemeral** - no backups needed. Users rejoin on reconnect.

### Redis Failure Handling

If Redis goes down:
- Application continues running (degrades to single-instance mode)
- Each instance serves its own connected clients
- State not shared across instances until Redis recovers

**Auto-recovery:**
```
[ERROR] Redis subscriber error
[INFO] Retrying connection... (attempt 1)
[INFO] Redis publisher connected
[INFO] Redis subscriptions active
```

## FAQ

**Q: Do I need Redis for development?**
A: No, standalone mode works fine.

**Q: Will my app break without Redis?**
A: No, it gracefully falls back to single-instance mode.

**Q: Can I switch from standalone to Redis later?**
A: Yes! Just set `REDIS_URL` and redeploy.

**Q: How much memory does Redis need?**
A: Very little. Presence stores only user IDs (few KB per room).

**Q: What happens if Redis is down?**
A: App continues working, but multi-instance sync is disabled.

**Q: Can I use Redis for other features?**
A: Yes! The `redisService` is reusable for caching, sessions, etc.

---

**Date Created:** 2026-02-04
**Related:** [SPLIT_BRAIN_TEST.md](SPLIT_BRAIN_TEST.md), [ARCHITECTURE.md](ARCHITECTURE.md)
