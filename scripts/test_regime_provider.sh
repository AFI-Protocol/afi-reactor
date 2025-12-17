#!/bin/bash
# Test Pattern Regime Provider
# 
# This script tests the Pattern Regime provider configuration by sending
# TradingView webhook payloads and verifying that CoinGecko is NOT called
# when using Blofin or Coinbase providers.

set -e

BASE_URL="${1:-http://localhost:8080}"

echo "🧪 Testing Pattern Regime Provider"
echo "   Base URL: $BASE_URL"
echo ""

# Test payload (TradingView webhook format)
PAYLOAD='{
  "symbol": "BTCUSDT.P",
  "timeframe": "1h",
  "close": 95000,
  "volume": 1000,
  "timestamp": "2024-12-17T00:00:00Z",
  "alert_message": "Test regime provider"
}'

echo "📋 Test Payload:"
echo "$PAYLOAD" | jq .
echo ""

# Test 1: Blofin Provider (should NOT call CoinGecko)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Blofin Provider (PATTERN_REGIME_PROVIDER=blofin)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Expected: Logs should show 'Fetching from blofin', NOT 'CoinGecko'"
echo ""
echo "Sending request..."
curl -X POST "$BASE_URL/api/webhooks/tradingview" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -s -o /dev/null -w "HTTP Status: %{http_code}\n"
echo ""
echo "✅ Check server logs for:"
echo "   - '🔍 Regime Candles: Fetching from blofin'"
echo "   - '✅ Regime Candles: Fetched X candles from blofin'"
echo "   - NO 'CoinGecko' mentions"
echo ""
sleep 2

# Test 2: Provider = off (should skip regime fetch)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Provider = off (PATTERN_REGIME_PROVIDER=off)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Expected: Logs should show 'Provider is off, skipping fetch'"
echo ""
echo "⚠️  To test this, restart server with PATTERN_REGIME_PROVIDER=off"
echo "   Then run this script again"
echo ""

# Test 3: Cache verification (second request should hit cache)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Cache Verification (second request)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Expected: Second request should show 'Cache hit'"
echo ""
echo "Sending second request..."
curl -X POST "$BASE_URL/api/webhooks/tradingview" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -s -o /dev/null -w "HTTP Status: %{http_code}\n"
echo ""
echo "✅ Check server logs for:"
echo "   - '✅ Regime Candles: Cache hit for BTCUSDT.P:4h:90:blofin'"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Tests Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Summary:"
echo "  1. First request should fetch from Blofin (not CoinGecko)"
echo "  2. Second request should hit cache (no API call)"
echo "  3. No CoinGecko rate limit errors (429)"
echo ""
echo "To test different providers, set environment variables:"
echo "  PATTERN_REGIME_PROVIDER=coinbase  # Use Coinbase"
echo "  PATTERN_REGIME_PROVIDER=off       # Disable regime"
echo "  PATTERN_REGIME_PROVIDER=coingecko # Legacy (has rate limits)"
echo ""

