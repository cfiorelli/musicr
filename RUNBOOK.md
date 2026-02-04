# Musicr Operations Runbook

Operational procedures for deploying, monitoring, and troubleshooting Musicr in production.

## Deployment

### Railway Deployment (Production)

Musicr auto-deploys to Railway on push to `main` branch.

**Services:**
- `@musicr/api` - Fastify backend (Dockerfile build)
- `@musicr/web` - React frontend (Nixpacks build)
- PostgreSQL - Railway addon with pgvector extension

**Deployment Process:**
1. Push to `main` branch
2. Railway triggers builds automatically
3. API: Docker multi-stage build (~3-5 min)
4. Web: Nixpacks build (~2-3 min)
5. Health checks pass, traffic switches to new version

**Monitoring Deployment:**
```bash
# View Railway logs
railway logs --service @musicr/api
railway logs --service @musicr/web

# Check deployment status
railway status
```

### Manual Deployment

If auto-deploy fails or manual deploy needed:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy specific service
railway up --service @musicr/api
railway up --service @musicr/web
```

### Rollback Procedure

1. Go to Railway dashboard
2. Select service (API or Web)
3. Click "Deployments" tab
4. Find previous successful deployment
5. Click "Redeploy"

OR via CLI:
```bash
railway rollback --service @musicr/api
```

## Environment Configuration

### Required Variables (Railway Dashboard)

**API Service:**
- `DATABASE_URL` - Auto-set by PostgreSQL addon
- `COOKIE_SECRET` - Generate: `openssl rand -hex 32`
- `FRONTEND_ORIGIN` - Set to web service URL
- `NODE_ENV=production`

**Web Service:**
- `VITE_API_URL` - Set to API service URL

**Database:**
- Managed by Railway, no manual config needed

### Updating Environment Variables

1. Railway Dashboard → Service → Variables tab
2. Add/update variable
3. Click "Deploy" to restart with new config

OR via CLI:
```bash
railway variables set COOKIE_SECRET=new_secret_here --service @musicr/api
```

## Database Operations

### Running Migrations

Migrations run automatically on API deployment via `pnpm prisma migrate deploy` in build process.

**Manual migration (if needed):**
```bash
# Connect to Railway project
railway link

# Run migrations
railway run pnpm --filter @musicr/api prisma migrate deploy
```

### Database Backup

```bash
# Connect to Railway database
railway connect postgres

# Create backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore from backup
psql $DATABASE_URL < backup_20260204.sql
```

### Seeding Production

**Never seed production database unless explicitly needed for initial setup.**

```bash
railway run pnpm --filter @musicr/api seed
```

### Database Maintenance

```bash
# View database stats
railway run psql -c "SELECT COUNT(*) FROM songs;"
railway run psql -c "SELECT COUNT(*) FROM users;"
railway run psql -c "SELECT COUNT(*) FROM messages;"

# Check embedding coverage
railway run psql -c "
  SELECT
    COUNT(*) as total,
    COUNT(embedding_vector) as with_embeddings,
    ROUND(COUNT(embedding_vector)::numeric / COUNT(*) * 100, 1) as coverage_pct
  FROM songs;
"

# Vacuum database (improves performance)
railway run psql -c "VACUUM ANALYZE;"
```

## Monitoring

### Health Checks

**API Health Endpoint:**
```bash
curl https://your-api-domain.railway.app/health
# Expected: {"status":"ok","timestamp":"2026-02-04T..."}
```

**Web Health:**
```bash
curl -I https://your-web-domain.railway.app/
# Expected: HTTP 200
```

### Logs

**View real-time logs:**
```bash
# API logs
railway logs --service @musicr/api --follow

# Web logs
railway logs --service @musicr/web --follow

# Filter for errors
railway logs --service @musicr/api | grep ERROR
```

**Common log patterns to watch:**
- `ERROR` - Application errors
- `WARN` - Warnings that may need attention
- `Database connection` - DB connectivity issues
- `WebSocket` - WS connection problems

### Metrics

**Railway Dashboard Metrics:**
- CPU usage (should stay <80%)
- Memory usage (API: <1GB, Web: <256MB)
- Response times (API: <500ms p95)
- Deployment frequency
- Error rates

**Application Metrics (via logs):**
```bash
# Count recent errors
railway logs --service @musicr/api | grep ERROR | wc -l

# Check WebSocket connections
curl https://your-api-domain.railway.app/debug/connections

# View active rooms and users
curl https://your-api-domain.railway.app/api/admin/analytics
```

## Troubleshooting

### API Not Starting

**Symptoms:** Deployment succeeds but health checks fail

**Diagnosis:**
```bash
# Check recent logs
railway logs --service @musicr/api --tail 100

# Common issues:
# 1. DATABASE_URL not set or invalid
# 2. Migrations failed
# 3. Missing COOKIE_SECRET in production
# 4. Port binding issue
```

**Solution:**
1. Verify `DATABASE_URL` in Railway dashboard
2. Check migrations: `railway run pnpm prisma migrate status`
3. Ensure `COOKIE_SECRET` is set
4. Check `PORT` env var (should be auto-set by Railway)

### WebSocket Connection Failures

**Symptoms:** Users can't connect to chat

**Diagnosis:**
```bash
# Test WebSocket endpoint
wscat -c wss://your-api-domain.railway.app/

# Check CORS configuration
curl -H "Origin: https://your-web-domain.railway.app" \
  -I https://your-api-domain.railway.app/health

# Verify FRONTEND_ORIGIN matches
railway variables --service @musicr/api | grep FRONTEND_ORIGIN
```

**Solution:**
1. Ensure `FRONTEND_ORIGIN` includes web domain
2. Check for CloudFlare/proxy WebSocket settings
3. Verify Railway service is running (not crashed)

### Database Connection Issues

**Symptoms:** `Prisma Client initialization error`, connection timeouts

**Diagnosis:**
```bash
# Test database connection
railway run psql -c "SELECT 1;"

# Check connection pool
railway run psql -c "SELECT count(*) FROM pg_stat_activity;"

# Verify DATABASE_URL format
railway variables --service @musicr/api | grep DATABASE_URL
```

**Solution:**
1. Restart database: Railway Dashboard → PostgreSQL → Restart
2. Check connection limits (default: 20)
3. Verify pgvector extension: `SELECT * FROM pg_extension WHERE extname='vector';`

### High Memory Usage

**Symptoms:** Service restarts frequently, OOM errors

**Diagnosis:**
```bash
# Check memory usage in Railway dashboard
railway status

# Review embeddings in memory
# Check for memory leaks in logs
railway logs --service @musicr/api | grep "memory\|heap"
```

**Solution:**
1. Scale up memory in Railway (Settings → Resources)
2. Check for embedding cache bloat
3. Review WebSocket connection cleanup
4. Add `NODE_OPTIONS=--max-old-space-size=1024` env var

### Slow Semantic Search

**Symptoms:** Song matching takes >2 seconds

**Diagnosis:**
```bash
# Enable debug matching
railway variables set DEBUG_MATCHING=1 --service @musicr/api

# Check HNSW index
railway run psql -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename='songs' AND indexname LIKE '%hnsw%';
"

# Verify embedding coverage
railway run pnpm --filter @musicr/api tsx scripts/verify-phase1.ts
```

**Solution:**
1. Rebuild HNSW index if missing
2. Increase `hnsw.ef_search` parameter
3. Check database CPU/memory in Railway dashboard
4. Consider upgrading PostgreSQL plan

### Deployment Failures

**Symptoms:** Build fails, deployment never completes

**Diagnosis:**
```bash
# View build logs
railway logs --service @musicr/api --deployment <deployment-id>

# Common build failures:
# 1. TypeScript compilation errors
# 2. Missing dependencies
# 3. Prisma generate failures
# 4. Docker build issues
```

**Solution:**
1. Test build locally: `pnpm build`
2. Verify lockfile committed: `pnpm-lock.yaml`
3. Check Dockerfile for syntax errors
4. Review migration files for SQL errors

## Performance Optimization

### Database Tuning

```sql
-- Check slow queries
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Analyze table stats
ANALYZE songs;
ANALYZE messages;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan;
```

### Caching Strategy

- Embeddings cached in memory during API lifetime
- Prisma query result cache (default)
- Consider Redis for WebSocket session state if scaling horizontally

### Connection Pooling

Default: 20 connections (set in `DATABASE_URL`)

Adjust for high traffic:
```
DATABASE_URL="postgresql://...?connection_limit=50&pool_timeout=30"
```

## Security

### API Key Rotation

**COOKIE_SECRET rotation:**
```bash
# Generate new secret
openssl rand -hex 32

# Update in Railway
railway variables set COOKIE_SECRET=<new_secret> --service @musicr/api

# Deploy to apply
railway up --service @musicr/api
```

**OPENAI_API_KEY rotation:**
```bash
# Update in Railway dashboard
# No restart needed if using Xenova local model
```

### Access Control

- Railway project access: Team Settings → Members
- Database access: Rotate PostgreSQL password via Railway dashboard
- API endpoints: No authentication currently (anonymous chat)

### Rate Limiting

Configured in code (`apps/api/src/utils/rate-limiter.ts`):
- Default: 100 requests per minute per IP
- Adjust via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW` env vars

## Incident Response

### P1: Service Down

1. Check Railway status page: status.railway.app
2. View recent deployments, rollback if needed
3. Check logs for crash loops
4. Scale resources if OOM
5. Contact Railway support if platform issue

### P2: Degraded Performance

1. Check metrics: CPU, memory, response times
2. Review recent code changes (git log)
3. Check database performance (slow queries)
4. Consider scaling resources
5. Deploy hotfix if needed

### P3: Feature Issues

1. Reproduce issue locally
2. Check logs for errors
3. Create bug report issue
4. Schedule fix in next release

## Maintenance Windows

**Planned Maintenance:**
1. Announce in chat UI (add banner)
2. Schedule during low traffic (nights/weekends)
3. Perform upgrades/migrations
4. Monitor post-deployment
5. Remove announcement

**Emergency Maintenance:**
1. Document issue
2. Implement fix
3. Deploy immediately
4. Post-mortem review

## Runbook Checklist

### Daily
- [ ] Check error logs
- [ ] Verify health endpoints
- [ ] Monitor Railway metrics

### Weekly
- [ ] Review deployment history
- [ ] Check database growth
- [ ] Analyze slow queries
- [ ] Review security advisories

### Monthly
- [ ] Database vacuum and analyze
- [ ] Review and rotate logs
- [ ] Dependency updates
- [ ] Performance review

## Contacts

- **Deployment Issues:** Railway support (support@railway.app)
- **Database Issues:** Check Railway status, then support
- **Code Issues:** GitHub Issues
- **Security Issues:** security@musicr.app

## Useful Links

- Railway Dashboard: https://railway.app/project/...
- GitHub Repository: https://github.com/your-org/musicr
- Prisma Studio: Run `railway run pnpm --filter @musicr/api db:studio`
