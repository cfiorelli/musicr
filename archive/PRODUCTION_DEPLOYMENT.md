# 🚀 Musicr Production Deployment Guide

Complete guide for deploying Musicr to production for global access.

## ⚡️ Quick Deploy Options

### Option 1: Railway (Recommended - Fastest)

**Railway provides:**
- Automatic SSL certificates
- Global CDN
- PostgreSQL with pgvector
- Environment variable management
- GitHub integration

**Deploy Steps:**
```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login to Railway
railway login

# 3. Create new project
railway create musicr

# 4. Deploy from GitHub
railway connect <your-github-repo>

# 5. Set environment variables
railway variables set NODE_ENV=production
railway variables set POSTGRES_PASSWORD=$(openssl rand -base64 32)
railway variables set COOKIE_SECRET=$(openssl rand -base64 32)
railway variables set OPENAI_API_KEY=your_openai_key
railway variables set FRONTEND_ORIGIN=https://your-domain.railway.app

# 6. Deploy
railway up
```

**Railway Config Files:**
Create `railway.json`:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/api/Dockerfile"
  },
  "deploy": {
    "startCommand": "pnpm start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Option 2: Heroku + Heroku Postgres

**Deploy Steps:**
```bash
# 1. Install Heroku CLI
brew install heroku/brew/heroku

# 2. Login
heroku login

# 3. Create apps
heroku create musicr-api
heroku create musicr-web

# 4. Add PostgreSQL addon
heroku addons:create heroku-postgresql:essential-0 --app musicr-api

# 5. Set environment variables
heroku config:set NODE_ENV=production --app musicr-api
heroku config:set COOKIE_SECRET=$(openssl rand -base64 32) --app musicr-api
heroku config:set OPENAI_API_KEY=your_key --app musicr-api

# 6. Deploy
git push heroku main
```

### Option 3: DigitalOcean App Platform

**Deploy Steps:**
1. Go to DigitalOcean App Platform
2. Connect your GitHub repository
3. Configure the following:

**API Service:**
- **Name:** musicr-api  
- **Source:** `/apps/api`
- **Build Command:** `pnpm build`
- **Run Command:** `pnpm start`
- **Port:** 4000

**Web Service:**
- **Name:** musicr-web
- **Source:** `/apps/web`  
- **Build Command:** `pnpm build`
- **Run Command:** `pnpm preview --host 0.0.0.0`
- **Port:** 5173

**Database:**
- PostgreSQL 14 with pgvector extension

### Option 4: Docker Self-Hosted

**Requirements:**
- Ubuntu 22.04+ server
- 2GB+ RAM
- Docker & Docker Compose
- Domain name with DNS pointing to server

**Deploy Steps:**
```bash
# 1. Clone repository
git clone <your-repo-url>
cd musicr

# 2. Create production environment file
cp apps/api/.env.example .env.production

# 3. Edit environment variables
nano .env.production
# Set:
# NODE_ENV=production
# DATABASE_URL=postgresql://musicr:secure_password@database:5432/musicr
# POSTGRES_PASSWORD=secure_password
# COOKIE_SECRET=very-long-random-string-32-chars-min
# OPENAI_API_KEY=your_openai_key
# FRONTEND_ORIGIN=https://your-domain.com

# 4. Run deployment script
./deploy.sh
```

## 🔧 Environment Configuration

### Required Environment Variables

```bash
# Core Application
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:port/database
POSTGRES_PASSWORD=your_secure_db_password

# Security
COOKIE_SECRET=your-very-long-random-secret-minimum-32-characters
FRONTEND_ORIGIN=https://your-domain.com,https://www.your-domain.com

# External Services
OPENAI_API_KEY=your_openai_api_key

# Server Configuration  
HOST=0.0.0.0
PORT=4000

# Performance
NODE_OPTIONS=--max-old-space-size=1024
```

### Optional Environment Variables

```bash
# Logging
LOG_LEVEL=info

# WebSocket Configuration
WS_PING_INTERVAL=30000
WS_CONNECTION_TIMEOUT=60000

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000
```

## 🌍 Domain & SSL Setup

### Cloudflare (Recommended)

1. **Add Domain to Cloudflare**
2. **Update DNS Records:**
   ```
   Type: A
   Name: @
   Content: your-server-ip
   Proxy: Enabled
   
   Type: CNAME  
   Name: www
   Content: your-domain.com
   Proxy: Enabled
   ```
3. **SSL/TLS Settings:**
   - Mode: Full (Strict)
   - Always Use HTTPS: On
   - HSTS: Enabled

### Let's Encrypt (Self-Hosted)

```bash
# Install certbot
sudo apt install certbot nginx

# Get certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## 📊 Performance Optimization

### Database Optimization

```sql
-- Connection pooling
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';

-- pgvector optimization
ALTER SYSTEM SET shared_preload_libraries = 'vector';
SELECT pg_reload_conf();
```

### Application Optimization

```bash
# PM2 for process management (if not using Docker)
npm install -g pm2

# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'musicr-api',
    script: './apps/api/dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    }
  }]
};

# Start with PM2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

## 🔍 Monitoring & Health Checks

### Health Endpoints

- **API Health:** `GET /health`
- **WebSocket Health:** Automatic ping/pong with 30s interval
- **Database Health:** Included in API health check

### Monitoring Setup

**Railway/Heroku:** Built-in monitoring
**Self-hosted:** Use these tools:

```bash
# Install monitoring stack
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  prom/prometheus

docker run -d \
  --name grafana \
  -p 3000:3000 \
  grafana/grafana
```

### Log Management

```bash
# Centralized logging with Docker
docker run -d \
  --name musicr-logs \
  -v /var/log/musicr:/logs \
  fluent/fluentd
```

## 🛡️ Security Checklist

### Application Security
- ✅ Environment variables secured
- ✅ CORS properly configured
- ✅ HTTPOnly cookies with secure flags
- ✅ Rate limiting enabled
- ✅ Input validation and sanitization
- ✅ SQL injection protection (Prisma)

### Infrastructure Security
```bash
# Firewall setup
sudo ufw enable
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw deny 4000   # Block direct API access
sudo ufw deny 5173   # Block direct web access
sudo ufw deny 5432   # Block direct database access
```

### Database Security
```sql
-- Create limited user
CREATE USER musicr_app WITH ENCRYPTED PASSWORD 'secure_password';
GRANT CONNECT ON DATABASE musicr TO musicr_app;
GRANT USAGE ON SCHEMA public TO musicr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO musicr_app;
```

## 🚦 Deployment Pipeline

### GitHub Actions

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: |
          corepack enable pnpm
          pnpm install
          
      - name: Run tests
        run: pnpm test
        
      - name: Build application
        run: pnpm build
        
      - name: Deploy to Railway
        run: railway deploy
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

## 📈 Scaling Considerations

### Horizontal Scaling
- **API:** Multiple container instances behind load balancer
- **WebSocket:** Sticky sessions or Redis for session storage
- **Database:** Read replicas for better performance

### Vertical Scaling
- **Memory:** 1GB minimum for API, 2GB recommended
- **CPU:** 1 core minimum, 2 cores for high traffic
- **Storage:** SSD recommended, 20GB minimum

## 🆘 Troubleshooting

### Common Issues

**WebSocket Connection Failed:**
```bash
# Check CORS settings
curl -H "Origin: https://your-domain.com" -v http://your-api/health

# Check WebSocket endpoint
wscat -c ws://your-api/ws
```

**Database Connection Issues:**
```bash
# Test database connection
psql postgresql://user:password@host:port/database

# Check pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';
```

**High Memory Usage:**
```bash
# Monitor memory usage
docker stats musicr-api

# Adjust NODE_OPTIONS
NODE_OPTIONS=--max-old-space-size=512
```

## 🎯 Production Checklist

### Pre-Deploy
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] SSL certificates configured
- [ ] Domain DNS configured
- [ ] Firewall rules configured
- [ ] Monitoring setup

### Post-Deploy
- [ ] Health checks passing
- [ ] WebSocket connections working
- [ ] Chat functionality tested
- [ ] Performance benchmarks run
- [ ] Backup strategy implemented
- [ ] Monitoring alerts configured

## 📞 Support

For deployment issues:
1. Check application logs: `docker logs musicr-api`
2. Verify environment variables are set
3. Test database connectivity
4. Check WebSocket connection in browser dev tools
5. Review CORS configuration for cross-origin requests

Your Musicr application is now production-ready! 🎵✨