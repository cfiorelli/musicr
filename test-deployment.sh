#!/bin/bash

# Simple deployment test script
# Tests basic functionality of the deployed Musicr application

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "🎵 Testing Musicr Deployment 🎵"
echo "================================"

# Test API health endpoint
echo -n "Testing API health endpoint... "
if health_response=$(curl -s -f http://localhost:4000/health); then
    if echo "$health_response" | grep -q '"status":"healthy"'; then
        echo -e "${GREEN}✓ PASS${NC}"
    else
        echo -e "${YELLOW}⚠ API running but not healthy${NC}"
        echo "Response: $health_response"
    fi
else
    echo -e "${RED}✗ FAIL - API health check failed${NC}"
    exit 1
fi

# Test web frontend
echo -n "Testing web frontend... "
if curl -s -f http://localhost:5173/ > /dev/null; then
    echo -e "${GREEN}✓ PASS${NC}"
else
    echo -e "${RED}✗ FAIL - Web frontend not responding${NC}"
    exit 1
fi

# Test API mapping endpoint
echo -n "Testing song mapping endpoint... "
if map_response=$(curl -s -f -X POST http://localhost:4000/api/map \
    -H "Content-Type: application/json" \
    -d '{"text": "hey jude"}'); then
    
    if echo "$map_response" | grep -q '"primary"'; then
        echo -e "${GREEN}✓ PASS${NC}"
        echo "  Found song: $(echo "$map_response" | jq -r '.primary.title + " by " + .primary.artist' 2>/dev/null || echo 'Unknown')"
    else
        echo -e "${YELLOW}⚠ API responding but no song found${NC}"
        echo "Response: $map_response"
    fi
else
    echo -e "${RED}✗ FAIL - Song mapping endpoint failed${NC}"
    exit 1
fi

# Test WebSocket endpoint
echo -n "Testing WebSocket endpoint... "
if command -v websocat &> /dev/null; then
    if timeout 5 websocat ws://localhost:4000/ws <<< '{"type":"test"}' | grep -q "echo" 2>/dev/null; then
        echo -e "${GREEN}✓ PASS${NC}"
    else
        echo -e "${YELLOW}⚠ WebSocket endpoint responding but echo failed${NC}"
    fi
else
    # Fallback test - just check if WebSocket endpoint exists
    if curl -s -I "http://localhost:4000/ws" | grep -q "Connection: Upgrade"; then
        echo -e "${GREEN}✓ PASS (endpoint exists)${NC}"
    else
        echo -e "${YELLOW}⚠ WebSocket test skipped (websocat not installed)${NC}"
    fi
fi

# Show service status
echo
echo "Service Status:"
echo "==============="
docker-compose ps

echo
echo -e "${GREEN}🎉 Deployment test completed successfully!${NC}"
echo
echo "Access your application:"
echo "  • Web Frontend: http://localhost:5173"
echo "  • API Backend:  http://localhost:4000"
echo "  • API Health:   http://localhost:4000/health"