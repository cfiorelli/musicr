# Musicr Deployment Guide

Complete containerized deployment of the Musicr music mapping application with PostgreSQL + pgvector, API backend, and React frontend.

## 🚀 One-Command Deployment

```bash
# Clone the repository and navigate to project root
git clone <repository-url>
cd musicr

# Run the deployment script
./deploy.sh
```

That's it! The script will:
- ✅ Check prerequisites (Docker, Docker Compose)
- ✅ Set up environment configuration
- ✅ Build optimized Docker images
- ✅ Start PostgreSQL with pgvector extension
- ✅ Run database migrations
- ✅ Seed the database with sample songs
- ✅ Start API and web services with health checks
- ✅ Verify everything is working

## 📋 Prerequisites

- **Docker** 20.10+ and **Docker Compose** 2.0+
- **2GB+ RAM** available for containers
- **Ports 4000, 5173, 5432** available
- **OpenAI API key** (optional, for embedding functionality)

## 🌐 Service URLs

After deployment:

- **Web Frontend**: http://localhost:5173
- **API Backend**: http://localhost:4000
- **API Health Check**: http://localhost:4000/health
- **Database**: localhost:5432 (PostgreSQL + pgvector)

## 🔧 Configuration

### Environment Variables

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
# Edit .env with your values
```

**Required Settings:**
- `POSTGRES_PASSWORD` - Secure database password
- `OPENAI_API_KEY` - For embedding functionality (optional)
- `COOKIE_SECRET` - Secure session secret

**Optional Settings:**
- `NODE_ENV` - Environment (production/development)
- `LOG_LEVEL` - Logging verbosity (error/warn/info/debug)
- `VITE_API_URL` - Frontend API endpoint

### Docker Configuration

The deployment uses optimized multi-stage Docker builds:

**API Container:**
- Node.js 20 Alpine base
- Multi-stage build with dependency caching
- Non-root user for security
- Health checks every 30 seconds
- Resource limits: 1GB memory, 1 CPU

**Web Container:**
- Vite preview mode for production
- Optimized static asset serving
- Health checks and monitoring
- Resource limits: 256MB memory, 0.5 CPU

**Database Container:**
- PostgreSQL 14 with pgvector extension
- Persistent data volumes
- Connection pooling and optimization
- Automated backup capabilities

## 🛠 Management Commands

### Basic Operations
```bash
# Deploy/update services
./deploy.sh

# Stop all services
./deploy.sh down

# View service status
./deploy.sh status

# View logs (all services)
./deploy.sh logs

# View logs (specific service)
./deploy.sh logs api
./deploy.sh logs web
./deploy.sh logs database
```

### Development Mode
```bash
# Start with development configuration
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Hot reload enabled for both API and web
# Debug port 9229 available for API
```

### Manual Docker Commands
```bash
# Build images only
docker-compose build

# Start services
docker-compose up -d

# View running containers
docker-compose ps

# Execute commands in containers
docker-compose exec api pnpm tsx scripts/seed.ts
docker-compose exec database psql -U musicr -d musicr

# Stop and remove everything
docker-compose down --volumes --remove-orphans
```

## 📊 Health Monitoring

### API Health Endpoint
```bash
curl http://localhost:4000/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-09-26T12:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "environment": "production",
  "services": {
    "database": "healthy",
    "embedding": "healthy"
  },
  "performance": {
    "responseTime": "15ms",
    "memory": {
      "used": 128,
      "limit": 512
    }
  }
}
```

### Service Health Checks

All services include health checks:
- **Database**: `pg_isready` every 30s
- **API**: HTTP `/health` endpoint every 30s  
- **Web**: HTTP root endpoint every 30s

### WebSocket Monitoring

WebSocket connections include ping/pong heartbeat:
```javascript
// Client-side ping interval
setInterval(() => {
  if (websocket.readyState === WebSocket.OPEN) {
    websocket.ping();
  }
}, 30000); // 30 second ping interval
```

## 🗄 Database Management

### Migrations
```bash
# Run pending migrations
docker-compose exec api pnpm prisma migrate deploy

# Generate Prisma client
docker-compose exec api pnpm prisma generate

# Push schema changes (dev only)
docker-compose exec api pnpm prisma db push
```

### Seeding
```bash
# Seed database with sample songs
docker-compose exec api pnpm tsx scripts/seed.ts

# Check song count
docker-compose exec database psql -U musicr -d musicr -c "SELECT COUNT(*) FROM songs;"
```

### Backup & Restore
```bash
# Create backup
docker-compose exec database pg_dump -U musicr musicr > backup.sql

# Restore from backup
docker-compose exec -T database psql -U musicr -d musicr < backup.sql
```

## 🔒 Security Configuration

### Network Security
- Services communicate via internal Docker network
- Database not exposed externally in production
- Non-root container users
- Resource limits prevent DoS

### Application Security
- Content Security Policy headers
- CORS configuration
- Session cookie security
- Input validation and sanitization
- Profanity filtering and moderation

### Environment Security
```bash
# Generate secure passwords
openssl rand -hex 32  # For POSTGRES_PASSWORD
openssl rand -hex 64  # For COOKIE_SECRET
```

## 📈 Performance Tuning

### Resource Allocation
- **API**: 1GB memory, 1 CPU core
- **Web**: 256MB memory, 0.5 CPU core
- **Database**: Unlimited (adjust per host capacity)

### Database Optimization
```sql
-- View connection stats
SELECT * FROM pg_stat_activity WHERE datname = 'musicr';

-- Check vector index performance  
EXPLAIN ANALYZE SELECT * FROM songs ORDER BY embedding <-> '[0.1,0.2,0.3]' LIMIT 10;

-- Monitor query performance
SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

### Container Monitoring
```bash
# Monitor resource usage
docker stats

# View container logs
docker-compose logs -f --tail=100

# Check disk usage
docker system df
```

## 🐛 Troubleshooting

### Common Issues

**Service fails to start:**
```bash
# Check logs
docker-compose logs [service_name]

# Verify ports aren't in use
netstat -tulpn | grep -E ':(4000|5173|5432)'

# Restart specific service
docker-compose restart [service_name]
```

**Database connection errors:**
```bash
# Check database health
docker-compose exec database pg_isready -U musicr -d musicr

# Verify environment variables
docker-compose exec api env | grep DATABASE_URL

# Reset database
docker-compose down --volumes
docker-compose up database -d
```

**Frontend can't reach API:**
```bash
# Check API health
curl http://localhost:4000/health

# Verify CORS configuration
curl -H "Origin: http://localhost:5173" -I http://localhost:4000/health

# Check network connectivity
docker-compose exec web curl http://api:4000/health
```

### Clean Slate Reset
```bash
# Stop everything and clean up
./deploy.sh clean

# Remove all containers, networks, volumes
docker-compose down --volumes --remove-orphans
docker system prune -a -f

# Fresh deployment
./deploy.sh
```

### Debug Mode
```bash
# Start with debug logging
LOG_LEVEL=debug docker-compose up -d

# Connect to API container
docker-compose exec api bash

# Check application files
docker-compose exec api find /app -name "*.js" -o -name "*.json"
```

## 📚 API Documentation

### Core Endpoints

**Song Mapping:**
```bash
curl -X POST http://localhost:4000/api/map \
  -H "Content-Type: application/json" \
  -d '{"text": "play some Beatles"}'
```

**Song Search:**
```bash
curl "http://localhost:4000/api/songs/search?q=love&strategy=semantic&limit=5"
```

**Admin Analytics:**
```bash
curl http://localhost:4000/api/admin/analytics
```

### WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:4000');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

## 🏗 Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Web     │    │   Fastify API   │    │  PostgreSQL +   │
│   (Port 5173)   │◄──►│   (Port 4000)   │◄──►│     pgvector    │
│                 │    │                 │    │   (Port 5432)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
       │                        │                        │
       ├─ Vite Preview         ├─ Song Matching         ├─ Vector Search
       ├─ React Router         ├─ Semantic Search       ├─ ACID Transactions  
       ├─ WebSocket Client     ├─ Content Moderation    ├─ Connection Pooling
       └─ Health Checks        └─ Health Monitoring     └─ Backup/Recovery
```

## 🔄 CI/CD Integration

### GitHub Actions Example
```yaml
name: Deploy Musicr
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy
        run: |
          echo "${{ secrets.ENV_FILE }}" > .env
          ./deploy.sh
```

### Environment Secrets
- `OPENAI_API_KEY`
- `POSTGRES_PASSWORD` 
- `COOKIE_SECRET`

## 📝 License

This deployment configuration is part of the Musicr project. See the main project LICENSE file for details.