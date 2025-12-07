# AFI Eliza Demo Backend — Technical Notes

**Service**: afi-reactor
**Purpose**: HTTP demo server for AFI Eliza Demo Pipeline
**Status**: DEV/DEMO ONLY (no real trading, no emissions)
**Date**: 2025-12-07

---

## Overview

This document describes the afi-reactor backend endpoints that power the AFI ElizaOS demo, specifically the AFI Eliza Demo pipeline that showcases how Phoenix, Alpha, Pixel Rick, Froggy, and Val Dook process signals.

**Key Points**:
- ✅ Fully functional HTTP server with 3 endpoints
- ✅ 6-stage Froggy trend-pullback pipeline
- ✅ Stage summaries with persona names for demo narration
- ✅ Simulated execution only (no real trading)
- ✅ No AFI token minting or emissions

---

## Endpoints

### 1. Health Check

**Endpoint**: `GET /health`  
**Purpose**: Verify that afi-reactor is online and ready

**Request**:
```bash
curl http://localhost:8080/health
```

**Response** (200 OK):
```json
{
  "status": "ok",
  "service": "afi-reactor",
  "froggyPipeline": "available"
}
```

**Use Case**: Phoenix's `CHECK_AFI_REACTOR_HEALTH` action calls this endpoint.

---

### 2. TradingView Webhook (General)

**Endpoint**: `POST /api/webhooks/tradingview`  
**Purpose**: Submit a custom signal to the Froggy pipeline

**Request**:
```bash
curl -X POST http://localhost:8080/api/webhooks/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "setupSummary": "Bullish pullback to 20 EMA",
    "notes": "Volume increasing on bounce",
    "enrichmentProfile": {
      "technical": { "enabled": true, "preset": "trend_pullback" },
      "pattern": { "enabled": true, "preset": "reversal_patterns" }
    }
  }'
```

**Required Fields**:
- `symbol` (string) - Trading pair (e.g., "BTC/USDT")
- `timeframe` (string) - Timeframe (e.g., "1h", "15m", "4h")
- `strategy` (string) - Strategy identifier (e.g., "froggy_trend_pullback_v1")
- `direction` (string) - Trade direction: "long", "short", or "neutral"

**Optional Fields**:
- `market` (string) - Market type (e.g., "spot", "perp", "futures")
- `setupSummary` (string) - Brief setup description
- `notes` (string) - Additional notes
- `enrichmentProfile` (object) - Enrichment configuration
- `signalId` (string) - External signal ID
- `secret` (string) - Shared secret for webhook auth (if `WEBHOOK_SHARED_SECRET` env var is set)

**Response** (200 OK):
```json
{
  "signalId": "alpha-1733515200000",
  "validatorDecision": {
    "decision": "approve",
    "uwrConfidence": 0.78,
    "reasonCodes": ["score-high"]
  },
  "execution": {
    "status": "simulated",
    "type": "buy",
    "asset": "BTC/USDT",
    "amount": 0.1,
    "simulatedPrice": 67500,
    "timestamp": "2025-12-06T20:00:00.000Z",
    "notes": "Simulated BUY based on validator approval"
  },
  "meta": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "source": "tradingview_webhook"
  },
  "uwrScore": 0.75
}
```

**Use Case**: Alpha's `SUBMIT_FROGGY_DRAFT` action calls this endpoint.

---

### 3. AFI Eliza Demo (Fixed Payload)

**Endpoint**: `POST /demo/afi-eliza-demo`
**Purpose**: Run a pre-configured BTC trend-pullback signal with stage summaries for demo narration

**Request**:
```bash
curl -X POST http://localhost:8080/demo/afi-eliza-demo \
  -H "Content-Type: application/json"
```

**Note**: This endpoint uses a **fixed demo payload** (no request body needed). The payload is:

```json
{
  "symbol": "BTC/USDT",
  "market": "spot",
  "timeframe": "1h",
  "strategy": "froggy_trend_pullback_v1",
  "direction": "long",
  "setupSummary": "Bullish pullback to 20 EMA after liquidity sweep below $67.2k. Volume increasing on bounce. Structure intact (higher highs).",
  "notes": "DEMO-ONLY: AFI Eliza Demo pipeline sample for ElizaOS demo",
  "enrichmentProfile": {
    "technical": { "enabled": true, "preset": "trend_pullback" },
    "pattern": { "enabled": true, "preset": "reversal_patterns" },
    "sentiment": { "enabled": false },
    "news": { "enabled": false },
    "aiMl": { "enabled": false }
  }
}
```

**Response** (200 OK):
```json
{
  "signalId": "alpha-1733515200000",
  "validatorDecision": {
    "decision": "approve",
    "uwrConfidence": 0.78,
    "reasonCodes": ["score-high", "froggy-demo"]
  },
  "execution": {
    "status": "simulated",
    "type": "buy",
    "asset": "BTC/USDT",
    "amount": 0.1,
    "simulatedPrice": 67500,
    "timestamp": "2025-12-06T20:00:00.000Z",
    "notes": "Simulated BUY based on validator approval (confidence: 0.78)"
  },
  "meta": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "source": "afi_eliza_demo"
  },
  "uwrScore": 0.75,
  "stageSummaries": [
    {
      "stage": "scout",
      "persona": "Alpha",
      "status": "complete",
      "summary": "Alpha Scout ingested TradingView-like signal: BTC/USDT 1h long. Converted to reactor envelope."
    },
    {
      "stage": "structurer",
      "persona": "Pixel Rick",
      "status": "complete",
      "summary": "Pixel Rick normalized signal to USS (Universal Signal Schema). Validated required fields."
    },
    {
      "stage": "enrichment",
      "persona": "Pixel Rick",
      "status": "complete",
      "summary": "Pixel Rick applied enrichment legos: technical (trend_pullback), pattern (reversal_patterns).",
      "enrichmentCategories": ["technical", "pattern"]
    },
    {
      "stage": "analyst",
      "persona": "Froggy",
      "status": "complete",
      "summary": "Froggy analyzed trend-pullback setup using afi-core strategy. UWR score: 0.75.",
      "uwrScore": 0.75
    },
    {
      "stage": "validator",
      "persona": "Val Dook",
      "status": "complete",
      "summary": "Val Dook approved signal with confidence 0.78. Reason: score-high, froggy-demo.",
      "decision": "approve"
    },
    {
      "stage": "execution",
      "persona": "Execution Sim",
      "status": "complete",
      "summary": "Execution Sim simulated BUY: 0.1 BTC/USDT at $67,500. No real trading."
    }
  ],
  "isDemo": true
}
```

**Key Difference from `/api/webhooks/tradingview`**:
- ✅ Fixed, deterministic payload (no user input)
- ✅ Includes `stageSummaries` array with persona names
- ✅ Marked with `isDemo: true`
- ✅ Designed for demo narration (Phoenix can read stage summaries)

**Use Case**: Phoenix's `RUN_AFI_ELIZA_DEMO` action calls this endpoint.

---

## Pipeline Stages (6 Stages)

The Froggy trend-pullback pipeline runs through 6 stages:

1. **Alpha Scout Ingest** (Persona: Alpha)
   - Converts TradingView-like payload to reactor signal envelope
   - Generates signal ID if not provided

2. **Signal Structurer** (Persona: Pixel Rick)
   - Normalizes signal to USS (Universal Signal Schema)
   - Validates required fields

3. **Froggy Enrichment Adapter** (Persona: Pixel Rick)
   - Applies enrichment legos (technical, pattern, sentiment, news, aiMl)
   - Uses enrichment profile from payload

4. **Froggy Analyst** (Persona: Froggy)
   - Runs trend_pullback_v1 strategy from afi-core
   - Computes UWR (Universal Weighting Rule) score

5. **Validator Decision Evaluator** (Persona: Val Dook)
   - Makes approve/reject/flag/abstain decision
   - Uses UWR score and confidence thresholds

6. **Execution Agent Sim** (Persona: Execution Sim)
   - Simulates trade execution (no real trading)
   - Returns simulated price and amount

---

## Environment Variables

**Required**:
- None (server runs with defaults)

**Optional**:
```bash
# Server port (default: 8080)
AFI_REACTOR_PORT=8080

# Webhook shared secret for authentication (optional)
WEBHOOK_SHARED_SECRET=demo-secret-123
```

**Note**: If `WEBHOOK_SHARED_SECRET` is set, the `/api/webhooks/tradingview` endpoint will require a matching `secret` field in the request payload.

---

## Startup Commands

### Development Mode (with hot-reload)
```bash
cd /Users/secretservice/AFI_Modular_Repos/afi-reactor
npm run dev
```

### Production Mode
```bash
npm run build
npm run start:demo
```

**Server Output**:
```
🚀 AFI-REACTOR HTTP DEMO SERVER
   Listening on http://localhost:8080
   Endpoints:
     GET  /health
     POST /api/webhooks/tradingview
     POST /demo/afi-eliza-demo (AFI Eliza Demo with stage summaries)

   ⚠️  DEV/DEMO ONLY - No real trading or emissions
```

---

## Limitations and Assumptions

### DEV/DEMO ONLY ⚠️

This server is **NOT** for production use. It is designed for development and demo purposes only.

**What This Server Does NOT Do**:
- ❌ No real trading or exchange API calls
- ❌ No AFI token minting or emissions
- ❌ No database persistence (signals are processed in-memory)
- ❌ No authentication (except optional shared secret)
- ❌ No rate limiting or production-grade error handling

**Assumptions**:
- All execution is simulated
- UWR scores are computed using real afi-core math, but no emissions occur
- Enrichment data is mocked (no real market data feeds)
- Validator decisions are deterministic (no randomness in demo mode)

---

## Integration with afi-eliza-gateway

**Call Chain**:
```
User (Discord/CLI/Web)
  → ElizaOS Client
  → AgentRuntime (Phoenix/Alpha character)
  → AFI Reactor Actions Plugin (SUBMIT_FROGGY_DRAFT action)
  → afiClient.runFroggyTrendPullback()
  → HTTP POST to afi-reactor:8080/api/webhooks/tradingview
  → 6-stage Froggy pipeline
  → Response back to user
```

**Environment Variable** (in afi-eliza-gateway):
```bash
AFI_REACTOR_BASE_URL=http://localhost:8080
```

**Client Functions** (in `afi-eliza-gateway/src/afiClient.ts`):
- `checkAfiReactorHealth()` → `GET /health`
- `runFroggyTrendPullback(draft)` → `POST /api/webhooks/tradingview`

---

## Testing

### Manual Testing

**Test Health Check**:
```bash
curl http://localhost:8080/health
```

**Test AFI Eliza Demo**:
```bash
curl -X POST http://localhost:8080/demo/afi-eliza-demo
```

**Test Custom Signal**:
```bash
curl -X POST http://localhost:8080/api/webhooks/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ETH/USDT",
    "timeframe": "4h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "short",
    "setupSummary": "Bearish rejection at resistance"
  }'
```

### Automated Testing

**Test File**: `afi-reactor/test/froggyPipeline.test.ts`

Run tests:
```bash
npm test
```

---

## Next Steps

See `afi-eliza-gateway/docs/ELIZA_DEMO_READINESS.md` for:
- ElizaOS client configuration
- Multi-agent runtime setup
- Demo script and interaction examples
- Environment setup guide

---

**End of Backend Notes**

