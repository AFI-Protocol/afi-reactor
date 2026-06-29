#!/usr/bin/env bash
# Scoped ESM Invariants Check for the AFI pipehead mission.
#
# Mirrors scripts/esm-check.sh (same three invariants) but limited to the
# mission write-footprint only:
#   - src/pipeheads
#   - src/cli/run-pipehead-demo.ts
#   - test/pipeheads
#
# This avoids the pre-existing, out-of-scope ESM violations in other test files
# that make the full `npm run esm:check` red. It exits 0 cleanly when none of
# the scoped paths exist yet (e.g. before later features land).

set -e

echo "🔍 Checking ESM invariants (scoped: pipeheads)..."

ERRORS=0

# Collect only the mission-footprint TypeScript files that actually exist.
SCOPED_PATHS=(src/pipeheads src/cli/run-pipehead-demo.ts test/pipeheads)
SOURCE_FILES=""
for path in "${SCOPED_PATHS[@]}"; do
  if [ -e "$path" ]; then
    FOUND=$(find "$path" -name "*.ts" -type f 2>/dev/null || true)
    if [ -n "$FOUND" ]; then
      SOURCE_FILES="${SOURCE_FILES}${FOUND}"$'\n'
    fi
  fi
done

# Drop blank lines.
SOURCE_FILES=$(printf '%s' "$SOURCE_FILES" | sed '/^[[:space:]]*$/d')

if [ -z "$SOURCE_FILES" ]; then
  echo "✅ No pipehead source files present yet — scoped ESM check is a no-op."
  exit 0
fi

# 1. Cross-repo relative imports to afi-core (should use the package name).
echo ""
echo "Checking for cross-repo relative imports to afi-core..."
CROSS_REPO=$(echo "$SOURCE_FILES" | xargs grep -n "from ['\"]\.\..*afi-core" 2>/dev/null || true)
if [ -n "$CROSS_REPO" ]; then
  echo "❌ Found cross-repo relative imports (should use package name):"
  echo "$CROSS_REPO"
  echo ""
  echo "Fix by using the package name instead:"
  echo "  from \"../../afi-core/analysts/...\" → from \"afi-core/analysts/...\""
  ERRORS=$((ERRORS + 1))
else
  echo "✅ No cross-repo relative imports found"
fi

# 2. Relative imports without .js extensions.
echo ""
echo "Checking for missing .js extensions in relative imports..."
MISSING_JS=$(echo "$SOURCE_FILES" | xargs grep -n "from ['\"]\.\.*/[^'\"]*['\"]" 2>/dev/null | grep -v "\.js['\"]" | grep -v "afi-core" | grep -v "\.json['\"]" || true)
if [ -n "$MISSING_JS" ]; then
  echo "❌ Found relative imports without .js extensions:"
  echo "$MISSING_JS"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ All relative imports have .js extensions"
fi

# 3. .ts extensions in imports (should be .js).
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

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ Scoped ESM invariants check passed!"
  exit 0
else
  echo "❌ Scoped ESM invariants check failed with $ERRORS error(s)"
  echo ""
  echo "Common fixes:"
  echo "  1. Use package name for afi-core imports: from \"afi-core/...\""
  echo "  2. Add .js to relative imports: from \"./Something.js\""
  echo "  3. Never use .ts extensions in imports"
  exit 1
fi
