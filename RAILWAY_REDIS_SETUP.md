# Railway Redis Setup Guide

## Problem

Railway's native Redis addon may throw errors or not be available on certain plans. This guide shows how to use Upstash Redis (free tier) instead.

## Solution: Upstash Redis (Free Tier)

### Step 1: Create Upstash Account

1. Go to https://upstash.com
2. Sign up with GitHub (easiest)
3. Click "Create Database"

### Step 2: Configure Database

**Settings:**
- Name: `musicr-redis`
- Type: **Regional** (not Global - lower latency)
- Region: Choose closest to your Railway region
  - US East (Virginia) if Railway is in us-east
  - EU West (Ireland) if Railway is in eu-west
- TLS: **Enabled** (recommended)

Click "Create"

### Step 3: Get Connection URL

After creation, you'll see the database dashboard.

**Copy the connection string:**
```
# Look for "Redis URL" or "Connect with Redis client"
# Format: redis://default:XXXXXX@region.upstash.io:6379
```

Example:
```
redis://default:AbraxasXXXXXXXX@us1-caring-cod-12345.upstash.io:6379
```

### Step 4: Add to Railway

1. Go to Railway dashboard
2. Select your **API service**
3. Go to "Variables" tab
4. Click "New Variable"
5. Add:
   ```
   Variable: REDIS_URL
   Value: redis://default:XXXXXX@region.upstash.io:6379
   ```
6. Click "Add"

### Step 5: Redeploy

Railway should auto-redeploy. If not:
1. Go to "Deployments" tab
2. Click "Deploy" on latest commit
3. Or push a new commit to trigger deployment

### Step 6: Verify

Check Railway logs for:
```
✅ [INFO] Redis publisher connected
✅ [INFO] Redis presence subscriptions active
✅ [INFO] Redis reaction subscriptions active
✅ [INFO] Connection manager initialized { instanceId: '...', redisEnabled: true }
```

If you see:
```
❌ [WARN] Redis not configured - running in standalone mode
```

Then the `REDIS_URL` variable didn't save correctly. Double-check step 4.

## Upstash Free Tier Limits

✅ **What you get for free:**
- 10,000 commands per day
- 256 MB storage
- TLS/SSL encryption
- Global replication (if you choose Global type)

✅ **Is this enough for Musicr?**

**Yes!** Here's why:
- Presence uses Redis sets (very efficient)
- ~10 commands per user join/leave
- 10,000 commands = ~1,000 user sessions per day
- Perfect for small-medium apps

**When you'll exceed free tier:**
- >1,000 daily active users
- High-traffic production app
- Then upgrade to Upstash Pro (~$10/month for 100K commands/day)

## Alternative: Railway Redis Addon (If Available)

If Railway's Redis addon becomes available on your plan:

1. Go to Railway project
2. Click "New" → "Database" → "Add Redis"
3. Railway auto-sets `REDIS_URL`
4. Redeploy

**But this might not work if:**
- You're on the Hobby plan (Redis often requires Pro plan)
- Railway is experiencing service issues
- Your region doesn't support Redis addon

**That's why Upstash is recommended - it works everywhere.**

## Option 3: Run Without Redis (Also Fine!)

**Important:** Redis is **optional** for Musicr!

If you're running a **single Railway instance** (not auto-scaling), you don't need Redis at all.

**When you DON'T need Redis:**
- Single backend instance (default Railway deployment)
- Small-medium traffic
- Railway's default setup (1 instance)

**When you DO need Redis:**
- Auto-scaling enabled (multiple instances)
- Users report: "I don't see other users" across different tabs
- Split-brain issues detected (see SPLIT_BRAIN_TEST.md)

**Current status:** You're running in standalone mode, which works perfectly fine for most deployments!

## Troubleshooting

### "Redis connection timeout"

**Check Upstash region matches Railway:**
```
Railway region: us-east  → Upstash: US East (Virginia)
Railway region: eu-west  → Upstash: EU West (Ireland)
```

### "WRONGPASS invalid username-password pair"

**Upstash URL format changed:**

Old format (might not work):
```
redis://:password@host:port
```

New format (use this):
```
redis://default:password@host:port
```

Note the `default:` username!

### "Connection refused"

**Check TLS setting:**

Upstash requires TLS. If you get connection errors, try the **TLS URL**:

```
# Instead of: redis://...
# Use: rediss://... (note the extra 's')
```

Upstash dashboard shows both URLs - try the TLS one.

### Still not working?

**Test the connection URL locally:**

```bash
# Install redis-cli
brew install redis  # macOS
apt install redis-tools  # Linux

# Test connection
redis-cli -u "redis://default:XXXX@region.upstash.io:6379" ping

# Should return: PONG
```

If local test fails, the URL is wrong. Double-check it in Upstash dashboard.

## Cost Comparison

| Provider | Free Tier | When to Use |
|----------|-----------|-------------|
| **Upstash** | 10K cmds/day | ✅ Best for starting out |
| Railway Redis | None ($5/mo) | High traffic, same network |
| Redis Cloud | 30MB storage | Alternative to Upstash |
| Local Dev | Unlimited | Development only |

## Security Notes

✅ **Upstash handles:**
- TLS encryption in transit
- Password authentication
- Rate limiting
- DDoS protection

✅ **You should:**
- Never commit REDIS_URL to git
- Rotate password periodically (regenerate in Upstash)
- Use environment variables in Railway

## Next Steps After Setup

1. ✅ Add `REDIS_URL` to Railway
2. ✅ Redeploy and check logs
3. ✅ Test with `?debug=1` in browser
4. ✅ Open 4 tabs - verify they sync
5. ✅ Deploy and forget! Redis works in background

---

**Questions?** Check [REDIS_DEPLOYMENT.md](REDIS_DEPLOYMENT.md) for detailed Redis guide.
