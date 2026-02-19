#!/usr/bin/env bash
# Pre-commit secret check — blocks obvious secret patterns from being committed.
# Install: cp scripts/check-secrets.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -euo pipefail

# Patterns that should never appear in staged content
PATTERNS=(
  'sk-[A-Za-z0-9_-]{20,}'           # OpenAI API keys (real ones are 20+ chars)
  'postgresql://[^@]+:[^@]+@[^/]*\.rlwy\.net'  # Railway DB URLs with passwords
  'postgres://[^@]+:[^@]+@[^/]*\.rlwy\.net'    # Railway DB URLs (alt scheme)
)

FOUND=0
for pattern in "${PATTERNS[@]}"; do
  if git diff --cached -U0 | grep -qE "$pattern"; then
    echo "BLOCKED: staged changes match secret pattern: $pattern"
    echo "  If this is a false positive (placeholder/docs), use: git commit --no-verify"
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  exit 1
fi
