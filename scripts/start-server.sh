#!/bin/bash

# Musicr API Server Startup Script
# This script manages the API server outside of VS Code to avoid start/stop loops

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$PROJECT_ROOT/apps/api"
PID_FILE="$PROJECT_ROOT/.api-server.pid"
LOG_FILE="$PROJECT_ROOT/logs/api-server.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Function to check if server is already running
check_server_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            return 0  # Server is running
        else
            warn "Stale PID file found. Cleaning up..."
            rm -f "$PID_FILE"
            return 1  # Server not running
        fi
    fi
    return 1  # Server not running
}

# Function to stop the server
stop_server() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        log "Stopping API server (PID: $pid)..."
        
        if ps -p $pid > /dev/null 2>&1; then
            # Try graceful shutdown first
            kill -TERM $pid 2>/dev/null || true
            sleep 2
            
            # Force kill if still running
            if ps -p $pid > /dev/null 2>&1; then
                kill -KILL $pid 2>/dev/null || true
                sleep 1
            fi
        fi
        
        rm -f "$PID_FILE"
        success "API server stopped"
    else
        warn "No PID file found. Server may not be running."
    fi
}

# Function to start the server
start_server() {
    if check_server_running; then
        local pid=$(cat "$PID_FILE")
        error "API server is already running (PID: $pid)"
        exit 1
    fi
    
    log "Starting Musicr API server..."
    
    # Check if required dependencies are installed
    cd "$API_DIR"
    if [ ! -d "node_modules" ]; then
        log "Installing dependencies..."
        pnpm install
    fi
    
    # Build the project
    log "Building API server..."
    pnpm run build
    
    # Check if port 4000 is available
    if lsof -Pi :4000 -sTCP:LISTEN -t >/dev/null ; then
        error "Port 4000 is already in use. Please stop the existing process."
        exit 1
    fi
    
    # Start the server in background
    log "Launching API server..."
    nohup pnpm exec tsx src/index.ts > "$LOG_FILE" 2>&1 &
    local server_pid=$!
    
    # Save PID
    echo $server_pid > "$PID_FILE"
    
    # Wait a moment and check if it started successfully
    sleep 3
    if ps -p $server_pid > /dev/null 2>&1; then
        # Test if server is responding
        local max_attempts=10
        local attempt=1
        
        while [ $attempt -le $max_attempts ]; do
            if curl -f http://localhost:4000/health >/dev/null 2>&1; then
                success "API server started successfully (PID: $server_pid)"
                log "Server is running at: http://localhost:4000"
                log "Logs are written to: $LOG_FILE"
                log "Use 'tail -f $LOG_FILE' to follow logs"
                return 0
            fi
            
            log "Waiting for server to be ready... (attempt $attempt/$max_attempts)"
            sleep 2
            attempt=$((attempt + 1))
        done
        
        error "Server started but is not responding to health checks"
        stop_server
        exit 1
    else
        error "Failed to start API server"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# Function to restart the server
restart_server() {
    log "Restarting API server..."
    stop_server
    sleep 2
    start_server
}

# Function to show server status
status_server() {
    if check_server_running; then
        local pid=$(cat "$PID_FILE")
        success "API server is running (PID: $pid)"
        
        # Test if server is responding
        if curl -f http://localhost:4000/health >/dev/null 2>&1; then
            log "Server is responding to requests"
        else
            warn "Server is running but not responding to requests"
        fi
        
        log "Server URL: http://localhost:4000"
        log "Log file: $LOG_FILE"
    else
        warn "API server is not running"
    fi
}

# Function to follow server logs
logs_server() {
    if [ -f "$LOG_FILE" ]; then
        log "Following server logs (Ctrl+C to exit):"
        tail -f "$LOG_FILE"
    else
        warn "Log file not found: $LOG_FILE"
    fi
}

# Main script logic
case "${1:-start}" in
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        restart_server
        ;;
    status)
        status_server
        ;;
    logs)
        logs_server
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start    - Start the API server"
        echo "  stop     - Stop the API server"
        echo "  restart  - Restart the API server"
        echo "  status   - Show server status"
        echo "  logs     - Follow server logs"
        exit 1
        ;;
esac