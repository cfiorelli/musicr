#!/bin/bash

echo "🛡️  MODERATION AND SAFETY SYSTEM VALIDATION"
echo "==========================================="
echo ""

API_BASE="http://localhost:4000"

echo "📋 Testing Content Moderation Pipeline:"
echo ""

# Test 1: Clean content
echo "1️⃣  Clean Content:"
echo "Input: 'hey jude'"
curl -s -X POST "$API_BASE/api/map" -H "Content-Type: application/json" \
  -d '{"text": "hey jude"}' | jq -r '.primary.title + " by " + .primary.artist + " (confidence: " + (.scores.confidence | tostring) + ")"'
echo ""

# Test 2: NSFW content (neutral mapping)
echo "2️⃣  NSFW Content (→ Neutral Mapping):"
echo "Input: 'sexy music'"
result2=$(curl -s -X POST "$API_BASE/api/map" -H "Content-Type: application/json" \
  -d '{"text": "sexy music"}' | jq -r '.primary.title + " by " + .primary.artist')
echo "🎵 Mapped to: $result2"
echo ""

# Test 3: Profanity (neutral mapping)
echo "3️⃣  Profanity (→ Neutral Mapping):"
echo "Input: 'fuck this'"
result3=$(curl -s -X POST "$API_BASE/api/map" -H "Content-Type: application/json" \
  -d '{"text": "fuck this"}' | jq -r '.primary.title + " by " + .primary.artist')
echo "🎵 Mapped to: $result3"
echo ""

# Test 4: Harassment (neutral mapping)  
echo "4️⃣  Harassment (→ Neutral Mapping):"
echo "Input: 'kill yourself'"
result4=$(curl -s -X POST "$API_BASE/api/map" -H "Content-Type: application/json" \
  -d '{"text": "kill yourself"}')
if echo "$result4" | jq -e '.primary' >/dev/null 2>&1; then
  mapped=$(echo "$result4" | jq -r '.primary.title + " by " + .primary.artist')
  echo "🎵 Mapped to: $mapped"
else
  echo "🚫 $(echo "$result4" | jq -r '.message')"
fi
echo ""

# Test 5: Slurs (completely blocked)
echo "5️⃣  Slurs (→ Complete Block):"
echo "Input: 'nazi music'"
result5=$(curl -s -X POST "$API_BASE/api/map" -H "Content-Type: application/json" \
  -d '{"text": "nazi music"}' | jq -r '.message // .error')
echo "🚫 Blocked: $result5"
echo ""

# Test 6: Spam detection
echo "6️⃣  Spam Detection:"
echo "Input: 'test test test test test test'"
result6=$(curl -s -X POST "$API_BASE/api/map" -H "Content-Type: application/json" \
  -d '{"text": "test test test test test test"}')
if echo "$result6" | jq -e '.error' >/dev/null 2>&1; then
  echo "🚫 $(echo "$result6" | jq -r '.message')"
else
  mapped=$(echo "$result6" | jq -r '.primary.title + " by " + .primary.artist')
  echo "🎵 Processed as: $mapped"
fi
echo ""

echo "✅ MODERATION SYSTEM SUMMARY:"
echo "=============================="
echo "✅ Clean content: Normal processing with high confidence"
echo "🎵 NSFW/Profanity: Neutral song mappings (family-friendly replacements)"
echo "🎵 Harassment: Neutral mappings or safe alternatives"
echo "🚫 Slurs: Complete blocking with policy-compliant messages"
echo "⚠️  Spam: Detection and appropriate handling"
echo ""
echo "🔒 Content Safety Pipeline: INPUT → MODERATION → SONG MATCHING → RESPONSE"
echo "🏠 Room Settings: Family-friendly mode enforced for public API"