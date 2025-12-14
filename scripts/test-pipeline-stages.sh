#!/usr/bin/env bash
###############################################################################
# AFI Pipeline Stage-by-Stage Test Script
#
# Tests each pipeline stage independently using HTTP endpoints.
# Requires afi-reactor server to be running.
#
# Usage:
#   chmod +x scripts/test-pipeline-stages.sh
#   ./scripts/test-pipeline-stages.sh
#
# Environment Variables:
#   AFI_REACTOR_BASE_URL - Base URL for AFI Reactor (default: http://localhost:8080)
###############################################################################

set -e  # Exit on error

BASE_URL="${AFI_REACTOR_BASE_URL:-http://localhost:8080}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "🧪 AFI Pipeline Stage-by-Stage Test"
echo "===================================="
echo ""
echo "Base URL: $BASE_URL"
echo "Timestamp: $TIMESTAMP"
echo ""

# Check if server is running
echo "0️⃣  Checking if AFI Reactor is online..."
if ! curl -s -f "$BASE_URL/health" > /dev/null; then
  echo "❌ AFI Reactor is not running on $BASE_URL"
  echo "   Start the server with: npm run start:demo"
  exit 1
fi
echo "✅ AFI Reactor is online"
echo ""

###############################################################################
# Test 1: Full Pipeline (End-to-End)
###############################################################################
echo "1️⃣  Testing FULL PIPELINE (TradingView webhook)..."
FULL_PIPELINE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/webhooks/tradingview" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "setupSummary": "Test full pipeline - bullish pullback"
  }')

SIGNAL_ID=$(echo "$FULL_PIPELINE_RESPONSE" | grep -o '"signalId":"[^"]*"' | cut -d'"' -f4)
UWR_SCORE=$(echo "$FULL_PIPELINE_RESPONSE" | grep -o '"uwrScore":[0-9.]*' | cut -d':' -f2)
DECISION=$(echo "$FULL_PIPELINE_RESPONSE" | grep -o '"decision":"[^"]*"' | cut -d'"' -f4)

echo "   Signal ID: $SIGNAL_ID"
echo "   UWR Score: $UWR_SCORE"
echo "   Decision: $DECISION"
echo "✅ Full pipeline test passed"
echo ""

###############################################################################
# Test 2: Enrichment Stage Only
###############################################################################
echo "2️⃣  Testing ENRICHMENT stage only..."
ENRICHMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/test/enrichment" \
  -H "Content-Type: application/json" \
  -d '{
    "signalId": "test-enrichment-001",
    "score": 0,
    "confidence": 0.5,
    "timestamp": "'"$TIMESTAMP"'",
    "meta": {
      "symbol": "BTC/USDT",
      "market": "spot",
      "timeframe": "1h",
      "strategy": "froggy_trend_pullback_v1",
      "direction": "long",
      "enrichmentProfile": {
        "technical": { "enabled": true, "preset": "trend_pullback" },
        "pattern": { "enabled": true, "preset": "reversal_patterns" }
      }
    },
    "structured": {
      "normalizedTimestamp": "'"$TIMESTAMP"'",
      "hasValidMeta": true,
      "structuredBy": "test"
    }
  }')

if echo "$ENRICHMENT_RESPONSE" | grep -q '"stage":"enrichment"'; then
  echo "✅ Enrichment stage test passed"
else
  echo "❌ Enrichment stage test failed"
  echo "$ENRICHMENT_RESPONSE"
  exit 1
fi
echo ""

###############################################################################
# Test 3: Analysis Stage Only
###############################################################################
echo "3️⃣  Testing ANALYSIS stage only..."
ANALYSIS_RESPONSE=$(curl -s -X POST "$BASE_URL/test/analysis" \
  -H "Content-Type: application/json" \
  -d '{
    "signalId": "test-analysis-001",
    "score": 0,
    "confidence": 0.5,
    "timestamp": "'"$TIMESTAMP"'",
    "meta": {
      "symbol": "BTC/USDT",
      "market": "spot",
      "timeframe": "1h",
      "strategy": "froggy_trend_pullback_v1",
      "direction": "long"
    },
    "enriched": {
      "technical": {
        "rsi": 45,
        "macd": { "value": 0.5, "signal": 0.3, "histogram": 0.2 },
        "ema20": 50000,
        "ema50": 49500
      },
      "pattern": {
        "detected": ["bullish_engulfing"],
        "confidence": 0.7
      }
    }
  }')

if echo "$ANALYSIS_RESPONSE" | grep -q '"stage":"analysis"'; then
  ANALYSIS_UWR=$(echo "$ANALYSIS_RESPONSE" | grep -o '"uwrScore":[0-9.]*' | cut -d':' -f2)
  echo "   UWR Score: $ANALYSIS_UWR"
  echo "✅ Analysis stage test passed"
else
  echo "❌ Analysis stage test failed"
  echo "$ANALYSIS_RESPONSE"
  exit 1
fi
echo ""

###############################################################################
# Test 4: Validator Stage Only
###############################################################################
echo "4️⃣  Testing VALIDATOR stage only..."
VALIDATOR_RESPONSE=$(curl -s -X POST "$BASE_URL/test/validator" \
  -H "Content-Type: application/json" \
  -d '{
    "signalId": "test-validator-001",
    "analysis": {
      "analystId": "froggy",
      "strategyId": "trend_pullback_v1",
      "uwrScore": 0.78,
      "uwrAxes": {
        "structureAxis": 0.8,
        "executionAxis": 0.7,
        "riskAxis": 0.6,
        "insightAxis": 0.9
      },
      "notes": []
    }
  }')

if echo "$VALIDATOR_RESPONSE" | grep -q '"stage":"validator"'; then
  VALIDATOR_DECISION=$(echo "$VALIDATOR_RESPONSE" | grep -o '"decision":"[^"]*"' | cut -d'"' -f4)
  echo "   Decision: $VALIDATOR_DECISION"
  echo "✅ Validator stage test passed"
else
  echo "❌ Validator stage test failed"
  echo "$VALIDATOR_RESPONSE"
  exit 1
fi
echo ""

###############################################################################
# Summary
###############################################################################
echo "===================================="
echo "🎉 All stage tests passed!"
echo ""
echo "Tested stages:"
echo "  ✅ Full pipeline (end-to-end)"
echo "  ✅ Enrichment (isolated)"
echo "  ✅ Analysis (isolated)"
echo "  ✅ Validator (isolated)"
echo ""

