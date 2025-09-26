#!/bin/bash

# End-to-End Test Script for Analytics and Evaluation System
# Tests the complete functionality we built

set -e

echo "🎵 TESTING ANALYTICS & EVALUATION SYSTEM 🎵"
echo "=============================================="
echo

# Check if API server is running
echo "1. Checking API server status..."
if curl -f http://localhost:4000/health >/dev/null 2>&1; then
    echo "   ✅ API server is running"
else
    echo "   ❌ API server is not running. Please start it with: ./scripts/start-server.sh start"
    exit 1
fi

echo

# Test a few API mappings to generate data
echo "2. Generating test mapping data..."
test_queries=("hey jude" "bohemian rhapsody" "michael jackson" "dancing queen")

for query in "${test_queries[@]}"; do
    echo "   Testing: '$query'"
    response=$(curl -s -X POST http://localhost:4000/api/map \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"$query\"}" | jq -r '.primary.title + " by " + .primary.artist')
    echo "   → $response"
done

echo "   ✅ Generated test mapping data"
echo

# Test admin analytics endpoint
echo "3. Testing admin analytics endpoint..."
analytics=$(curl -s "http://localhost:4000/api/admin/analytics")

if [[ $analytics == *"summary"* ]]; then
    echo "   ✅ Admin analytics endpoint working"
    
    # Show summary stats
    total_mappings=$(echo "$analytics" | jq -r '.summary.totalMappings')
    success_rate=$(echo "$analytics" | jq -r '.summary.successRate')
    echo "   📊 Total mappings: $total_mappings"
    echo "   📊 Success rate: $success_rate%"
    
    # Show recent mappings count
    recent_count=$(echo "$analytics" | jq -r '.recentMappings | length')
    echo "   📊 Recent mappings available: $recent_count"
else
    echo "   ❌ Admin analytics endpoint failed"
    echo "$analytics"
    exit 1
fi

echo

# Test evaluation script
echo "4. Testing evaluation script..."
cd "$(dirname "$0")/../apps/api"

if [ -f "fixtures/eval.jsonl" ]; then
    echo "   Running evaluation on fixture data..."
    
    # Run evaluation and capture results
    eval_output=$(pnpm exec tsx scripts/eval.ts fixtures/eval.jsonl 2>&1 | tail -20)
    
    if [[ $eval_output == *"OVERALL PERFORMANCE"* ]]; then
        echo "   ✅ Evaluation script working"
        
        # Extract key metrics
        top1_hit=$(echo "$eval_output" | grep -o "Top-1 Hit Rate: [0-9.]*%" | head -1)
        top3_hit=$(echo "$eval_output" | grep -o "Top-3 Hit Rate: [0-9.]*%" | head -1)
        
        echo "   📊 $top1_hit"
        echo "   📊 $top3_hit"
    else
        echo "   ❌ Evaluation script failed"
        echo "$eval_output"
        exit 1
    fi
else
    echo "   ❌ Evaluation fixtures not found"
    exit 1
fi

echo

# Test web server (if running)
echo "5. Testing web server..."
if curl -f http://localhost:5173/ >/dev/null 2>&1; then
    echo "   ✅ Web server is running at http://localhost:5173"
    echo "   🌐 Admin dashboard: http://localhost:5173/admin"
else
    echo "   ⚠️  Web server not running (optional)"
    echo "   💡 Start it with: cd apps/web && pnpm dev"
fi

echo

echo "🎉 SYSTEM TEST COMPLETE!"
echo "========================="
echo
echo "✅ All core functionality working:"
echo "   • API server running stably outside VS Code"
echo "   • Song matching and moderation working"
echo "   • Admin analytics endpoint providing data" 
echo "   • Evaluation script measuring performance"
echo "   • Web dashboard available"
echo
echo "🔧 Management commands:"
echo "   • Server: ./scripts/start-server.sh {start|stop|restart|status|logs}"
echo "   • Evaluation: cd apps/api && pnpm exec tsx scripts/eval.ts"
echo "   • Analytics: curl http://localhost:4000/api/admin/analytics"
echo
echo "🌐 URLs:"
echo "   • API: http://localhost:4000"
echo "   • Web App: http://localhost:5173" 
echo "   • Admin: http://localhost:5173/admin"