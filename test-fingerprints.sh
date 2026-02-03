#!/bin/bash

# Test /api/map endpoint 10 times and collect fingerprint data
# Usage: ./test-fingerprints.sh

API_URL="https://musicrapi-production.up.railway.app"
OUTPUT_FILE="fingerprint-results.json"

echo "Testing /api/map endpoint for split-brain diagnosis..."
echo "Collecting 10 samples..."
echo ""

# Clear previous results
echo "[]" > "$OUTPUT_FILE"

for i in {1..10}; do
  echo "Request $i/10..."

  # Rotate between different test messages
  case $((i % 5)) in
    0) TEXT="happy birthday party celebration" ;;
    1) TEXT="feeling sad and lonely tonight" ;;
    2) TEXT="lets dance all night long baby" ;;
    3) TEXT="rock and roll forever" ;;
    4) TEXT="classical music piano symphony" ;;
  esac

  # Make request and capture response
  RESPONSE=$(curl -s -X POST "$API_URL/api/map" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"$TEXT\"}")

  # Extract fingerprint if present
  INSTANCE_ID=$(echo "$RESPONSE" | grep -o '"instanceId":"[^"]*"' | cut -d'"' -f4)
  BUILD_ID=$(echo "$RESPONSE" | grep -o '"buildId":"[^"]*"' | cut -d'"' -f4)
  HAS_KEY=$(echo "$RESPONSE" | grep -o '"hasOpenAIKey":[^,}]*' | cut -d':' -f2)
  PRIMARY_SONG=$(echo "$RESPONSE" | grep -o '"artist":"[^"]*","title":"[^"]*"' | head -1)

  echo "  InstanceID: ${INSTANCE_ID:-N/A}"
  echo "  BuildID: ${BUILD_ID:-N/A}"
  echo "  HasOpenAIKey: ${HAS_KEY:-N/A}"
  echo "  PrimarySong: ${PRIMARY_SONG:-N/A}"
  echo ""

  # Save full response
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null >> "$OUTPUT_FILE" || echo "$RESPONSE" >> "$OUTPUT_FILE"

  # Small delay between requests
  sleep 0.5
done

echo "Results saved to $OUTPUT_FILE"
echo ""
echo "=== Summary ==="
echo "Unique instance IDs:"
grep -o '"instanceId":"[^"]*"' "$OUTPUT_FILE" | sort | uniq -c

echo ""
echo "Unique build IDs:"
grep -o '"buildId":"[^"]*"' "$OUTPUT_FILE" | sort | uniq -c

echo ""
echo "OpenAI key status:"
grep -o '"hasOpenAIKey":[^,}]*' "$OUTPUT_FILE" | sort | uniq -c
