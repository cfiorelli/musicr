#!/bin/bash

# Comprehensive API Test Script for Moderation Integration
# Tests the complete end-to-end pipeline with real API calls

API_BASE="http://localhost:4000"

echo "🧪 Testing Complete Moderation & Confidence API Integration"
echo "==========================================================="

echo ""
echo "Checking if API server is running..."
if ! curl -s "$API_BASE/api/health" > /dev/null 2>&1; then
    echo "❌ API server not running on $API_BASE"
    echo "Please start with: cd apps/api && pnpm dev"
    exit 1
fi

echo "✅ API server is running"
echo ""

# Function to test an API call
test_api_call() {
    local test_name="$1"
    local input_text="$2"
    local expected_behavior="$3"
    
    echo "📝 Testing: \"$input_text\""
    echo "Expected: $expected_behavior"
    
    response=$(curl -s -X POST "$API_BASE/api/map" \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"$input_text\"}")
    
    # Check if response is valid JSON
    if echo "$response" | jq . > /dev/null 2>&1; then
        echo "✅ Valid JSON response received"
        
        # Extract key information
        primary_title=$(echo "$response" | jq -r '.primary?.title // "null"')
        confidence=$(echo "$response" | jq -r '.scores?.confidence // "null"')
        strategy=$(echo "$response" | jq -r '.scores?.strategy // "null"')
        alternates_count=$(echo "$response" | jq '.alternates | length' 2>/dev/null || echo "0")
        
        echo "   Primary: $primary_title"
        echo "   Confidence: $confidence"
        echo "   Strategy: $strategy"
        echo "   Alternates: $alternates_count"
        
        # Check for neutral mappings (moderation replacements)
        if [[ "$primary_title" == "Bad" || "$primary_title" == "Smooth Criminal" || "$primary_title" == "Beat It" ]]; then
            echo "   🎵 NEUTRAL MAPPING DETECTED - Content was moderated"
        fi
        
    else
        # Check if it's an error response
        if echo "$response" | grep -q "error\|message"; then
            echo "🚫 Error response (possibly moderated):"
            echo "$response"
        else
            echo "❌ Invalid response:"
            echo "$response"
        fi
    fi
    
    echo "---------------------------------------------------"
    echo ""
}

# Test Cases
echo "🎯 Running Test Cases:"
echo ""

# Clean content - should work normally
test_api_call "Clean Content" "hey jude" "Normal song matching with high confidence"

test_api_call "Clean Content 2" "bohemian rhapsody" "Normal song matching"

# NSFW content - should get neutral mapping
test_api_call "NSFW Content" "sexy time music" "Should be replaced with neutral mapping like Smooth Criminal"

test_api_call "Profanity" "fuck yeah rock music" "Should be replaced with neutral mapping"

# Harassment - should get neutral mapping  
test_api_call "Harassment" "kill yourself loser" "Should be replaced with Bad by Michael Jackson"

test_api_call "Harassment 2" "you are worthless" "Should be replaced with neutral mapping"

# Slurs - should be completely blocked
test_api_call "Slur Content" "play some nazi music" "Should be completely blocked with error message"

# Spam - should be blocked
test_api_call "Spam Content" "test test test test test test test" "Should be flagged as spam and blocked"

# Edge case - ambiguous content that should trigger alternates
test_api_call "Ambiguous Content" "sad song about life" "Should have low confidence and trigger alternates"

echo "🎉 API Integration Test Completed!"
echo ""
echo "Summary of Expected Behaviors:"
echo "✅ Clean content → Normal song matches with confidence scores"
echo "🎵 NSFW/Harassment → Neutral song mappings (Bad, Smooth Criminal, Beat It)"  
echo "🚫 Slurs → Complete blocking with error messages"
echo "⚠️  Spam → Flagged and blocked"
echo "🔄 Ambiguous → Low confidence triggers alternates"