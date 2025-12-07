# Prize Demo Endpoint — Technical Specification

**Endpoint**: `POST /demo/prize-froggy`  
**Purpose**: Run a pre-configured BTC trend-pullback signal through the Froggy pipeline with detailed stage summaries  
**Status**: DEMO-ONLY (no real trading, no emissions)

---

## Overview

This endpoint runs a fixed, deterministic demo payload through the complete Froggy trend-pullback pipeline and returns stage-by-stage summaries showing how Alpha → Pixel Rick → Froggy → Val Dook process the signal.

**Key Features**:
- ✅ Fixed demo payload (BTC/USDT 1h trend-pullback)
- ✅ Stage summaries with persona names
- ✅ Enrichment categories explicitly shown
- ✅ Deterministic results (no randomness in demo mode)
- ✅ Marked with `isDemo: true`

---

## Request

**Method**: `POST`  
**URL**: `http://localhost:8080/demo/prize-froggy`  
**Headers**: `Content-Type: application/json`  
**Body**: Empty (uses fixed demo payload)

```bash
curl -X POST http://localhost:8080/demo/prize-froggy \
  -H "Content-Type: application/json"
```

---

## Response

**Status**: `200 OK`  
**Content-Type**: `application/json`

### Response Schema

```typescript
{
  signalId: string;
  validatorDecision: {
    decision: "approve" | "reject" | "flag" | "abstain";
    uwrConfidence: number;
    reasonCodes?: string[];
  };
  execution: {
    status: "simulated" | "skipped";
    type?: "buy" | "sell" | "hold";
    asset?: string;
    amount?: number;
    simulatedPrice?: number;
    timestamp: string;
    notes?: string;
  };
  meta: {
    symbol: string;
    timeframe: string;
    strategy: string;
    direction: string;
    source: string;
  };
  uwrScore: number;
  stageSummaries: Array<{
    stage: "scout" | "structurer" | "enrichment" | "analyst" | "validator" | "execution";
    persona: "Alpha" | "Pixel Rick" | "Froggy" | "Val Dook" | "Execution Sim";
    status: "complete" | "skipped" | "error";
    summary: string;
    enrichmentCategories?: string[];  // Only for enrichment stage
    uwrScore?: number;                // Only for analyst stage
    decision?: string;                // Only for validator stage
  }>;
  isDemo: true;
}
```

### Example Response

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
    "source": "tradingview-webhook"
  },
  "uwrScore": 0.78,
  "stageSummaries": [
    {
      "stage": "scout",
      "persona": "Alpha",
      "status": "complete",
      "summary": "Ingested BTC/USDT long signal on 1h timeframe"
    },
    {
      "stage": "structurer",
      "persona": "Pixel Rick",
      "status": "complete",
      "summary": "Normalized signal to USS (Universal Signal Schema) format"
    },
    {
      "stage": "enrichment",
      "persona": "Pixel Rick",
      "status": "complete",
      "summary": "Applied enrichment legos: technical, pattern",
      "enrichmentCategories": ["technical", "pattern"]
    },
    {
      "stage": "analyst",
      "persona": "Froggy",
      "status": "complete",
      "summary": "Analyzed trend-pullback setup, UWR score: 0.78",
      "uwrScore": 0.78
    },
    {
      "stage": "validator",
      "persona": "Val Dook",
      "status": "complete",
      "summary": "Decision: approve, Confidence: 0.78",
      "decision": "approve"
    },
    {
      "stage": "execution",
      "persona": "Execution Sim",
      "status": "complete",
      "summary": "Simulated buy: simulated"
    }
  ],
  "isDemo": true
}
```

---

## Pipeline Flow

The Prize Demo endpoint runs the signal through 6 stages:

1. **Alpha Scout Ingest** (Persona: Alpha)
   - Converts TradingView-like payload to reactor signal envelope
   - Generates signal ID

2. **Signal Structurer** (Persona: Pixel Rick)
   - Normalizes signal to USS (Universal Signal Schema)
   - Validates required fields

3. **Froggy Enrichment Adapter** (Persona: Pixel Rick)
   - Applies enrichment "legos" (technical, pattern, sentiment, news, aiMl)
   - For Prize Demo: only technical + pattern enabled
   - Returns enrichment categories in stage summary

4. **Froggy Analyst** (Persona: Froggy)
   - Runs trend_pullback_v1 strategy from afi-core
   - Computes UWR (Universal Weighting Rule) score
   - Returns UWR score in stage summary

5. **Validator Decision Evaluator** (Persona: Val Dook)
   - Makes approve/reject/flag/abstain decision
   - Computes uwrConfidence (0.0-1.0)
   - Returns decision + confidence in stage summary

6. **Execution Agent Sim** (Persona: Execution Sim)
   - Simulates trade execution (no real trading)
   - Returns simulated buy/sell/hold action

---

## Usage in afi-eliza-gateway

The `RUN_PRIZE_DEMO` action in afi-eliza-gateway calls this endpoint and formats the response for Phoenix to present:

```typescript
const response = await fetch("http://localhost:8080/demo/prize-froggy", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
});

const result = await response.json();

// Format stage summaries for Phoenix
result.stageSummaries.forEach(stage => {
  console.log(`${stage.persona}: ${stage.summary}`);
});
```

---

## Safety & Disclaimers

- ⚠️ **DEMO-ONLY**: No real trading, no AFI minting, no emissions
- ⚠️ **Fixed payload**: Uses pre-configured BTC/USDT setup for deterministic results
- ⚠️ **Simulated execution**: No real exchange API calls
- ⚠️ **No tokenomics**: Does not interact with afi-token or afi-mint

---

## Troubleshooting

**Server won't start**:
- Ensure afi-core is built: `cd afi-core && npm run build`
- Ensure afi-reactor symlink exists: `cd afi-reactor && ln -s ../afi-core afi-core`
- Check for port conflicts: `lsof -i :8080`

**Endpoint returns 500**:
- Check server logs for plugin errors
- Verify all plugins are loaded correctly
- Ensure enrichment profile is valid

**Stage summaries missing**:
- Verify `includeStageSummaries: true` is passed to `runFroggyTrendPullbackFromTradingView`
- Check that all plugins return expected data shapes

---

**End of Prize Demo Endpoint Specification**

