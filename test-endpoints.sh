#!/bin/bash

echo "🚀 Testing HTTP API Endpoints"
echo "📍 Base URL: http://localhost:4000"

# Test 1: GET /api/songs/search
echo ""
echo "🔍 Testing GET /api/songs/search..."
SEARCH_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X GET "http://localhost:4000/api/songs/search?q=love&strategy=exact&limit=2" 2>/dev/null)
SEARCH_HTTP_CODE=$(echo "$SEARCH_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
SEARCH_BODY=$(echo "$SEARCH_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

if [ "$SEARCH_HTTP_CODE" = "200" ]; then
  echo "✅ Search endpoint: HTTP $SEARCH_HTTP_CODE"
  RESULT_COUNT=$(echo "$SEARCH_BODY" | jq -r '.results | length' 2>/dev/null || echo "0")
  echo "✅ Results count: $RESULT_COUNT"
else
  echo "❌ Search endpoint failed: HTTP $SEARCH_HTTP_CODE"
fi

# Test 2: POST /api/map
echo ""
echo "🎵 Testing POST /api/map..."
MAP_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" -X POST "http://localhost:4000/api/map" \
  -H "Content-Type: application/json" \
  -d '{"text":"I love you so much","allowExplicit":false}' 2>/dev/null)
MAP_HTTP_CODE=$(echo "$MAP_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
MAP_BODY=$(echo "$MAP_RESPONSE" | sed 's/HTTP_CODE:[0-9]*$//')

if [ "$MAP_HTTP_CODE" = "200" ]; then
  echo "✅ Map endpoint: HTTP $MAP_HTTP_CODE"
  PRIMARY_SONG=$(echo "$MAP_BODY" | jq -r '.primary.title + " - " + .primary.artist' 2>/dev/null || echo "Unknown")
  echo "✅ Primary match: $PRIMARY_SONG"
else
  echo "❌ Map endpoint failed: HTTP $MAP_HTTP_CODE"
fi

echo ""
echo "📊 Test Summary:"
if [ "$SEARCH_HTTP_CODE" = "200" ] && [ "$MAP_HTTP_CODE" = "200" ]; then
  echo "🎉 All endpoints working!"
else
  echo "⚠️  Some endpoints failed"
fi