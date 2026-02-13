#!/bin/bash
# QA Engine Pre-Deploy Hook
# Runs smoke tests before allowing git push.
# Install: cp scripts/pre-deploy.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push

set -e

echo "🔍 QA Engine: Running pre-deploy smoke tests..."
echo ""

# Run smoke tests via CLI
node cli/index.js test --app brainstormy --mode smoke --quiet

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ Smoke tests failed."
  echo "   Fix the issues and try again."
  echo "   Skip with: git push --no-verify"
  exit 1
fi

echo ""
echo "✅ Smoke tests passed. Proceeding with push."
exit 0
