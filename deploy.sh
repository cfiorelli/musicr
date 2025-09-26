#!/bin/bash

# Musicr One-Command Deployment Script
# This script handles complete deployment with health checks and database migration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"
MAX_RETRIES=30
RETRY_INTERVAL=10

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed or not in PATH"
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        error "Docker daemon is not running"
        exit 1
    fi
    
    log "Prerequisites check passed"
}

# Setup environment
setup_environment() {
    log "Setting up environment..."
    
    # Create .env file if it doesn't exist
    if [[ ! -f "$ENV_FILE" ]]; then
        info "Creating default .env file..."
        cat > "$ENV_FILE" << EOF
# Database
POSTGRES_PASSWORD=musicr-secure-password-$(date +%s)

# API Configuration
OPENAI_API_KEY=
COOKIE_SECRET=musicr-cookie-secret-$(openssl rand -hex 32 2>/dev/null || echo "fallback-secret-$(date +%s)")

# Environment
NODE_ENV=production
LOG_LEVEL=info

# Frontend
VITE_API_URL=http://localhost:4000
EOF
        warn "Created default .env file. Please review and update with your API keys."
        warn "OpenAI API key is required for embedding functionality."
    else
        log ".env file already exists"
    fi
    
    # Load environment variables
    if [[ -f "$ENV_FILE" ]]; then
        export $(grep -v '^#' "$ENV_FILE" | xargs)
        log "Environment variables loaded"
    fi
}

# Health check function
wait_for_service() {
    local service_name=$1
    local health_url=$2
    local retries=0
    
    info "Waiting for $service_name to be healthy..."
    
    while [ $retries -lt $MAX_RETRIES ]; do
        if curl -f -s "$health_url" > /dev/null 2>&1; then
            log "$service_name is healthy"
            return 0
        fi
        
        retries=$((retries + 1))
        info "Attempt $retries/$MAX_RETRIES: $service_name not ready, waiting ${RETRY_INTERVAL}s..."
        sleep $RETRY_INTERVAL
    done
    
    error "$service_name failed to become healthy after $MAX_RETRIES attempts"
    return 1
}

# Database migration
run_migrations() {
    log "Running database migrations..."
    
    # Wait a bit more for database to fully initialize
    sleep 5
    
    # Run Prisma migrations in the API container
    if docker-compose exec -T api sh -c "cd apps/api && pnpm prisma migrate deploy" 2>/dev/null; then
        log "Database migrations completed successfully"
    else
        warn "Migration command failed, attempting to generate and push schema..."
        if docker-compose exec -T api sh -c "cd apps/api && pnpm prisma generate && pnpm prisma db push" 2>/dev/null; then
            log "Database schema pushed successfully"
        else
            error "Database setup failed"
            return 1
        fi
    fi
}

# Seed database
seed_database() {
    log "Checking if database seeding is needed..."
    
    # Check if songs table has data
    local song_count
    song_count=$(docker-compose exec -T database psql -U musicr -d musicr -t -c "SELECT COUNT(*) FROM songs;" 2>/dev/null | xargs || echo "0")
    
    if [[ "$song_count" == "0" ]]; then
        log "Database is empty, running seed script..."
        if docker-compose exec -T api sh -c "cd apps/api && pnpm tsx scripts/seed.ts" 2>/dev/null; then
            log "Database seeded successfully"
        else
            warn "Database seeding failed, but continuing deployment"
        fi
    else
        info "Database already contains $song_count songs, skipping seeding"
    fi
}

# Build and start services
deploy_services() {
    log "Building and starting services..."
    
    # Clean up any existing containers
    info "Cleaning up existing containers..."
    docker-compose down --remove-orphans 2>/dev/null || true
    
    # Build images
    log "Building Docker images..."
    if ! docker-compose build --parallel; then
        error "Failed to build Docker images"
        exit 1
    fi
    
    # Start services
    log "Starting services..."
    if ! docker-compose up -d; then
        error "Failed to start services"
        exit 1
    fi
    
    log "Services started successfully"
}

# Verify deployment
verify_deployment() {
    log "Verifying deployment..."
    
    # Wait for database
    if ! wait_for_service "Database" "http://localhost:5432" 2>/dev/null; then
        # Database doesn't have HTTP endpoint, check with docker-compose
        local retries=0
        while [ $retries -lt $MAX_RETRIES ]; do
            if docker-compose exec -T database pg_isready -U musicr -d musicr > /dev/null 2>&1; then
                log "Database is healthy"
                break
            fi
            retries=$((retries + 1))
            info "Attempt $retries/$MAX_RETRIES: Database not ready, waiting ${RETRY_INTERVAL}s..."
            sleep $RETRY_INTERVAL
        done
        
        if [ $retries -eq $MAX_RETRIES ]; then
            error "Database failed to become healthy"
            return 1
        fi
    fi
    
    # Wait for API
    if ! wait_for_service "API" "http://localhost:4000/health"; then
        return 1
    fi
    
    # Wait for Web
    if ! wait_for_service "Web" "http://localhost:5173"; then
        return 1
    fi
    
    log "All services are healthy"
}

# Test basic functionality
test_functionality() {
    log "Testing basic functionality..."
    
    # Test API health endpoint
    local health_response
    health_response=$(curl -s http://localhost:4000/health || echo '{"status":"error"}')
    
    if echo "$health_response" | grep -q '"status":"healthy"'; then
        log "API health check passed"
    else
        warn "API health check returned: $health_response"
    fi
    
    # Test a simple API request
    local map_response
    map_response=$(curl -s -X POST http://localhost:4000/api/map \
        -H "Content-Type: application/json" \
        -d '{"text": "test song"}' 2>/dev/null || echo '{"error":"failed"}')
    
    if echo "$map_response" | grep -q '"primary"'; then
        log "API mapping functionality test passed"
    else
        info "API mapping test response: $map_response"
    fi
    
    log "Basic functionality tests completed"
}

# Show deployment status
show_status() {
    log "Deployment Status"
    echo "=================="
    
    # Show running containers
    info "Running containers:"
    docker-compose ps
    
    echo
    info "Service URLs:"
    echo "  • API: http://localhost:4000"
    echo "  • API Health: http://localhost:4000/health"
    echo "  • Web Frontend: http://localhost:5173"
    echo "  • Database: localhost:5432"
    
    echo
    info "Useful commands:"
    echo "  • View logs: docker-compose logs -f [service]"
    echo "  • Stop services: docker-compose down"
    echo "  • Restart: docker-compose restart [service]"
    echo "  • Update: ./deploy.sh"
    
    echo
    log "Deployment completed successfully! 🎵"
}

# Cleanup function
cleanup() {
    if [[ $? -ne 0 ]]; then
        error "Deployment failed!"
        echo
        info "Troubleshooting:"
        echo "  • Check logs: docker-compose logs"
        echo "  • Check status: docker-compose ps"
        echo "  • Clean slate: docker-compose down --volumes --remove-orphans"
        
        # Show recent logs on failure
        echo
        warn "Recent logs from failed deployment:"
        docker-compose logs --tail=20 2>/dev/null || true
    fi
}

# Main deployment flow
main() {
    info "🎵 Starting Musicr Deployment 🎵"
    echo "=================================="
    
    trap cleanup EXIT
    
    check_prerequisites
    setup_environment
    deploy_services
    verify_deployment
    run_migrations
    seed_database
    test_functionality
    show_status
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy"|"")
        main
        ;;
    "down")
        log "Stopping all services..."
        docker-compose down --remove-orphans
        log "Services stopped"
        ;;
    "logs")
        docker-compose logs -f "${2:-}"
        ;;
    "status")
        docker-compose ps
        ;;
    "clean")
        warn "This will remove all containers, networks, and volumes!"
        read -p "Are you sure? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            docker-compose down --volumes --remove-orphans
            docker system prune -f
            log "Cleanup completed"
        else
            info "Cleanup cancelled"
        fi
        ;;
    "help"|"-h"|"--help")
        echo "Musicr Deployment Script"
        echo
        echo "Usage: $0 [command]"
        echo
        echo "Commands:"
        echo "  deploy (default) - Deploy all services"
        echo "  down            - Stop all services"
        echo "  logs [service]  - Show logs"
        echo "  status          - Show service status"
        echo "  clean           - Remove all containers and volumes"
        echo "  help            - Show this help"
        ;;
    *)
        error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac