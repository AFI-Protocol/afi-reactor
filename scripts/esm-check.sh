#!/usr/bin/env bash
# ESM Invariants Check for afi-reactor
# Detects common ESM gotchas: cross-repo relative imports, missing .js extensions

set -e

echo "🔍 Checking ESM invariants in afi-reactor..."

ERRORS=0

# Check for cross-repo relative imports to afi-core
echo ""
echo "Checking for cross-repo relative imports to afi-core..."

SOURCE_FILES=$(find src plugins test -name "*.ts" -type f 2>/dev/null || true)

if [ -n "$SOURCE_FILES" ]; then
  CROSS_REPO=$(echo "$SOURCE_FILES" | xargs grep -n "from ['\"]\.\..*afi-core" 2>/dev/null || true)
  
  if [ -n "$CROSS_REPO" ]; then
    echo "❌ Found cross-repo relative imports (should use package name):"
    echo "$CROSS_REPO"
    echo ""
    echo "Fix by using package name instead:"
    echo "  from \"../../afi-core/analysts/...\" → from \"afi-core/analysts/...\""
    ERRORS=$((ERRORS + 1))
  else
    echo "✅ No cross-repo relative imports found"
  fi
fi

# Check for relative imports without .js extensions
echo ""
echo "Checking for missing .js extensions in relative imports..."

if [ -n "$SOURCE_FILES" ]; then
  # Look for imports like: from "./Something" or from "../Something" (without .js)
  # Exclude external packages (no ./ or ../) and afi-core package imports
  # Exclude JSON imports (they don't need .js)
  MISSING_JS=$(echo "$SOURCE_FILES" | xargs grep -n "from ['\"]\.\.*/[^'\"]*['\"]" 2>/dev/null | grep -v "\.js['\"]" | grep -v "afi-core" | grep -v "\.json['\"]" || true)
  
  if [ -n "$MISSING_JS" ]; then
    echo "❌ Found relative imports without .js extensions:"
    echo "$MISSING_JS"
    ERRORS=$((ERRORS + 1))
  else
    echo "✅ All relative imports have .js extensions"
  fi
fi

# Check for .ts extensions in imports
echo ""
echo "Checking for .ts extensions in imports..."
TS_IMPORTS=$(echo "$SOURCE_FILES" | xargs grep -n "from ['\"][^'\"]*\.ts['\"]" 2>/dev/null || true)

if [ -n "$TS_IMPORTS" ]; then
  echo "❌ Found .ts extensions in imports (should be .js):"
  echo "$TS_IMPORTS"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ No .ts extensions in imports"
fi

# Summary
echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ ESM invariants check passed!"
  exit 0
else
  echo "❌ ESM invariants check failed with $ERRORS error(s)"
  echo ""
  echo "Common fixes:"
  echo "  1. Use package name for afi-core imports: from \"afi-core/...\""
  echo "  2. Add .js to relative imports: from \"./Something.js\""
  echo "  3. Never use .ts extensions in imports"
  exit 1
fi

