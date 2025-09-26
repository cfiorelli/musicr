#!/bin/bash

echo "🧪 Testing Phrase Lexicon API Integration"
echo "========================================"

# Start server in background
echo "📡 Starting API server..."
cd /Users/lolmach/musicr/apps/api
npm run dev > server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to initialize..."
sleep 8

echo ""
echo "🔍 Testing phrase-based queries:"
echo "--------------------------------"

# Test exact phrase matches
echo ""
echo "Testing 'hey jude' (should be exact match):"
curl -s -X POST http://localhost:4000/api/map \
  -H "Content-Type: application/json" \
  -d '{"text": "hey jude"}' | jq -r '.primary.title + " — " + .primary.artist + " (" + (.scores.strategy // "unknown") + ", confidence: " + (.scores.confidence | tostring) + ")"'

echo ""
echo "Testing \"can't stop\" (should be exact match):"
curl -s -X POST http://localhost:4000/api/map \
  -H "Content-Type: application/json" \
  -d '{"text": "cant stop"}' | jq -r '.primary.title + " — " + .primary.artist + " (" + (.scores.strategy // "unknown") + ", confidence: " + (.scores.confidence | tostring) + ")"'

echo ""
echo "Testing 'bohemian rhapsody' (should be exact match):"
curl -s -X POST http://localhost:4000/api/map \
  -H "Content-Type: application/json" \
  -d '{"text": "bohemian rhapsody"}' | jq -r '.primary.title + " — " + .primary.artist + " (" + (.scores.strategy // "unknown") + ", confidence: " + (.scores.confidence | tostring) + ")"'

echo ""
echo "Testing 'stairway to heaven' (should be partial/fuzzy match):"
curl -s -X POST http://localhost:4000/api/map \
  -H "Content-Type: application/json" \
  -d '{"text": "stairway to heaven"}' | jq -r '.primary.title + " — " + .primary.artist + " (" + (.scores.strategy // "unknown") + ", confidence: " + (.scores.confidence | tostring) + ")"'

echo ""
echo "Testing 'love you' (should be exact match):"
curl -s -X POST http://localhost:4000/api/map \
  -H "Content-Type: application/json" \
  -d '{"text": "love you"}' | jq -r '.primary.title + " — " + .primary.artist + " (" + (.scores.strategy // "unknown") + ", confidence: " + (.scores.confidence | tostring) + ")"'

echo ""
echo "Testing random text (should fall back to embeddings):"
curl -s -X POST http://localhost:4000/api/map \
  -H "Content-Type: application/json" \
  -d '{"text": "random words that definitely are not in our phrase lexicon"}' | jq -r '.primary.title + " — " + .primary.artist + " (" + (.scores.strategy // "unknown") + ", confidence: " + (.scores.confidence | tostring) + ")"'

echo ""
echo "🎉 Testing completed!"
echo ""

# Clean up
echo "🧹 Stopping server..."
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null

echo "✅ Done!"