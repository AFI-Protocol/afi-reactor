# Simple Replay - TSSD Vault Read-Only View

## Overview

The **Simple Replay** endpoint provides a fast, read-only view of signals stored in the TSSD vault (MongoDB). This is distinct from the **Full Replay** mode, which re-runs the entire pipeline and compares stored vs recomputed values.

Use simple replay when you need to:
- Quickly inspect a signal's lifecycle
- Display signal data in UIs/dashboards
- Audit signal provenance and metadata
- Debug without re-running the pipeline

---

## Endpoint

```
GET /replay/signal/:signalId
GET /replay/signal/:signalId?mode=simple
```

**Default mode**: `simple` (read-only view)

---

## Response Format

### Success (200 OK)

```json
{
  "replay": {
    "signalId": "alpha-74ef5d02-c5b3-4127-bd73-de27aeaa75e1",
    "createdAt": "2025-12-10T19:26:20.683Z",
    "source": "afi-eliza-demo",
    "market": {
      "symbol": "DOGE/USDT",
      "timeframe": "4h",
      "marketType": "perp",
      "priceSource": "blofin",
      "venueType": "crypto_perps"
    },
    "strategy": {
      "name": "froggy_trend_pullback_v1",
      "direction": "short"
    },
    "pipeline": {
      "uwrScore": 0.3416666666666667,
      "decision": "flag",
      "confidence": 0.3416666666666667,
      "validatorDecision": {
        "decision": "flag",
        "uwrConfidence": 0.3416666666666667,
        "reasonCodes": [
          "score-medium",
          "needs-review",
          "froggy-demo",
          "weak-structure",
          "weak-risk-profile"
        ]
      },
      "execution": {
        "status": "skipped",
        "type": "hold",
        "timestamp": "2025-12-10T19:26:20.682Z",
        "notes": "Execution skipped due to validator flag/abstain (needs review)"
      },
      "stageSummaries": [
        {
          "stage": "scout",
          "persona": "Alpha",
          "status": "complete",
          "summary": "Ingested DOGE/USDT short signal on 4h timeframe"
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
          "summary": "Analyzed trend-pullback setup, UWR score: 0.34",
          "uwrScore": 0.3416666666666667
        },
        {
          "stage": "validator",
          "persona": "Val Dook",
          "status": "complete",
          "summary": "Decision: flag, Confidence: 0.34",
          "decision": "flag"
        }
      ]
    },
    "raw": { /* Full TSSD document for debugging */ }
  }
}
```

### Signal Not Found (404)

```json
{
  "error": "signal_not_found",
  "message": "Signal with ID 'fake-signal-id-12345' not found in TSSD vault",
  "signalId": "fake-signal-id-12345"
}
```

### Vault Unavailable (503)

```json
{
  "error": "vault_unavailable",
  "message": "TSSD replay unavailable",
  "reason": "MongoDB not configured (AFI_MONGO_URI not set)"
}
```

### Invalid Mode (400)

```json
{
  "error": "bad_request",
  "message": "Invalid mode: 'invalid'. Must be 'simple' or 'full'"
}
```

---

## Usage Examples

### 1. Simple Replay (Default)

```bash
curl "http://localhost:8080/replay/signal/alpha-74ef5d02-c5b3-4127-bd73-de27aeaa75e1"
```

### 2. Explicit Simple Mode

```bash
curl "http://localhost:8080/replay/signal/alpha-74ef5d02-c5b3-4127-bd73-de27aeaa75e1?mode=simple"
```

### 3. Full Replay Mode (Re-run Pipeline)

```bash
curl "http://localhost:8080/replay/signal/alpha-74ef5d02-c5b3-4127-bd73-de27aeaa75e1?mode=full"
```

---

## Environment Setup

To enable TSSD replay, set the MongoDB connection string:

```bash
export AFI_MONGO_URI="mongodb+srv://..."
npm run start:demo
```

Or use the provided script:

```bash
./start-server-with-mongo.sh
```

---

## Implementation Details

- **Service**: `src/services/tssdSimpleReplayService.ts`
- **Types**: `src/types/SimpleReplayView.ts`
- **Route**: `src/server.ts` (GET `/replay/signal/:signalId`)

---

## Next Steps / TODOs

For future "full replay" enhancements:

1. **Deterministic Re-run with Stored Inputs**
   - Store enrichment inputs (OHLCV data, indicators) in TSSD vault
   - Replay using exact same inputs (no fresh API calls)
   - Bit-for-bit reproducibility

2. **Replay Across Pipeline Versions**
   - Track pipeline version in TSSD documents
   - Support replaying old signals with new pipeline versions
   - Compare behavior across versions

3. **Batch Replay**
   - Replay multiple signals in parallel
   - Aggregate comparison metrics
   - Regression testing suite

4. **Replay with Overrides**
   - Allow overriding specific inputs (e.g., different timeframe)
   - "What-if" analysis for strategy tuning

5. **Replay Audit Trail**
   - Log all replay requests
   - Track who replayed what and when
   - Compliance and debugging

