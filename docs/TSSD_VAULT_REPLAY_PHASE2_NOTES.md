# T.S.S.D. Vault Replay — Phase 2 (Read-Only Auditors Mode)

**Date**: 2025-12-07  
**Phase**: 2 (Replay & Audit)  
**Status**: Complete  
**Scope**: Read-only replay for auditing and regression testing

---

## Overview

Phase 2 extends the T.S.S.D. Vault with **read-only replay functionality** that allows auditors, developers, and automated systems to:

- Fetch signals from the MongoDB vault
- Re-run them through the Froggy pipeline deterministically
- Compare stored vs recomputed values
- Identify regressions, math changes, or pipeline drift

**Key Deliverables**:
- ✅ Vault Replay Service (read-only, no DB writes)
- ✅ HTTP endpoint: `GET /replay/signal/:signalId`
- ✅ CLI tool: `npm run replay:signal -- --id=<signalId>`
- ✅ Comprehensive tests for replay logic
- ✅ Structured comparison output (stored vs recomputed)

---

## Design Principles

### 1. READ-ONLY, NO SIDE EFFECTS

Replay operations **never** modify MongoDB documents:
- ✅ No `updateOne`, `insertOne`, or deletes
- ✅ No vault writes during replay
- ✅ No on-chain calls or Web3 interactions
- ✅ Graceful degradation if MongoDB unavailable

### 2. DETERMINISTIC REPLAY

Replay aims to be as deterministic as possible:
- ✅ Uses stored `rawPayload` when available (most accurate)
- ✅ Falls back to reconstructed input from structured fields
- ⚠️ Some non-determinism may exist (e.g., timestamps, random enrichment data)
- ⚠️ External data sources (price feeds, news) may have changed since original run

### 3. AUDITOR-FRIENDLY OUTPUT

Replay results are structured for easy comparison:
- **Stored values**: Original values from TSSD vault document
- **Recomputed values**: Fresh values from pipeline replay
- **Comparison**: Delta calculations and change summaries
- **Replay metadata**: Timestamp, pipeline version, notes

---

## Replay Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Fetch TSSD Document from MongoDB                        │
│    - Query by signalId                                      │
│    - Return 404 if not found                                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Reconstruct Pipeline Input                               │
│    - Use rawPayload if available (most accurate)            │
│    - Otherwise reconstruct from structured fields           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Re-run Froggy Pipeline                                   │
│    - Alpha Scout Ingest                                     │
│    - Signal Structurer (Pixel Rick)                         │
│    - Froggy Enrichment Adapter                              │
│    - Froggy Analyst (UWR scoring)                           │
│    - Validator Decision Evaluator (Val Dook)                │
│    - Execution Agent Sim                                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Build Replay Result                                      │
│    - Extract stored values from TSSD doc                    │
│    - Extract recomputed values from pipeline result         │
│    - Calculate deltas and changes                           │
│    - Add replay metadata                                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Return Structured Comparison                             │
│    - HTTP: JSON response                                    │
│    - CLI: Pretty-printed summary                            │
└─────────────────────────────────────────────────────────────┘
```

---

## HTTP API Reference

### `GET /replay/signal/:signalId`

Replays a signal from the TSSD vault and returns stored vs recomputed comparison.

**Request**:
```bash
GET http://localhost:8080/replay/signal/alpha-1733515200000
```

**Response (200 OK)**:
```json
{
  "signalId": "alpha-1733515200000",
  "stored": {
    "uwrScore": 0.75,
    "validatorDecision": {
      "decision": "approve",
      "uwrConfidence": 0.78,
      "reasonCodes": ["score-high"]
    },
    "execution": {
      "status": "simulated",
      "type": "buy",
      "timestamp": "2025-12-07T10:00:00.000Z"
    },
    "meta": {
      "symbol": "BTC/USDT",
      "timeframe": "1h",
      "strategy": "froggy_trend_pullback_v1",
      "direction": "long",
      "source": "afi-eliza-demo",
      "createdAt": "2025-12-07T10:00:00.000Z"
    },
    "receiptProvenance": {
      "mintStatus": "minted",
      "epochId": 5,
      "receiptId": "42",
      "mintTxHash": "0xabc..."
    }
  },
  "recomputed": {
    "uwrScore": 0.7521,
    "validatorDecision": {
      "decision": "approve",
      "uwrConfidence": 0.78,
      "reasonCodes": ["score-high"]
    },
    "execution": {
      "status": "simulated",
      "type": "buy",
      "timestamp": "2025-12-07T12:00:00.000Z"
    }
  },
  "comparison": {
    "uwrScoreDelta": 0.0021,
    "decisionChanged": false,
    "changes": [
      "uwrScore changed by +0.0021 (0.7500 → 0.7521)",
      "validatorDecision unchanged: approve"
    ]
  },
  "replayMeta": {
    "ranAt": "2025-12-07T12:00:00.000Z",
    "pipelineVersion": "froggy_trend_pullback_v1",
    "notes": "Read-only replay; no DB writes performed"
  }
}
```

**Response (404 Not Found)**:
```json
{
  "error": "signal_not_found",
  "message": "Signal with ID 'alpha-1733515200000' not found in TSSD vault"
}
```

**Response (500 Internal Server Error)**:
```json
{
  "error": "internal_error",
  "message": "TSSD vault not configured (AFI_MONGO_URI not set)"
}
```

---

## CLI Usage

### Basic Replay

```bash
npm run replay:signal -- --id=alpha-1733515200000
```

### Example Output

```
🔄 AFI Vault Replay CLI (Phase 2)

🔍 Fetching signal from TSSD vault: alpha-1733515200000

═══════════════════════════════════════════════════════════════
  VAULT REPLAY RESULT
═══════════════════════════════════════════════════════════════

📊 SIGNAL METADATA
   Signal ID:    alpha-1733515200000
   Symbol:       BTC/USDT
   Timeframe:    1h
   Strategy:     froggy_trend_pullback_v1
   Direction:    long
   Source:       afi-eliza-demo
   Created At:   2025-12-07T10:00:00.000Z

📈 STORED VALUES (from TSSD vault)
   UWR Score:    0.7500
   Decision:     approve
   Confidence:   0.7800
   Reason Codes: [score-high]

🔄 RECOMPUTED VALUES (from pipeline replay)
   UWR Score:    0.7521
   Decision:     approve
   Confidence:   0.7800
   Reason Codes: [score-high]

🔍 COMPARISON (stored vs recomputed)
   UWR Score Δ:  +0.0021
   Decision Changed: NO ✅

   Changes:
     • uwrScore changed by +0.0021 (0.7500 → 0.7521)
     • validatorDecision unchanged: approve

🧾 RECEIPT PROVENANCE
   Mint Status:  minted
   Epoch ID:     5
   Receipt ID:   42
   Mint Tx Hash: 0xabcdef...

ℹ️  REPLAY METADATA
   Ran At:       2025-12-07T12:00:00.000Z
   Pipeline Ver: froggy_trend_pullback_v1
   Notes:        Read-only replay; no DB writes performed

═══════════════════════════════════════════════════════════════
```

---

## Replay Result Structure

### TypeScript Interface

```typescript
interface ReplayResult {
  signalId: string;

  stored: {
    uwrScore: number;
    validatorDecision: { ... };
    execution: { ... };
    meta: { ... };
    receiptProvenance?: { ... };
  };

  recomputed: {
    uwrScore: number;
    validatorDecision: { ... };
    execution: { ... };
  };

  comparison: {
    uwrScoreDelta: number;
    decisionChanged: boolean;
    changes: string[];
  };

  replayMeta: {
    ranAt: Date;
    pipelineVersion: string;
    notes: string;
  };
}
```

### Field Descriptions

#### `stored`
Original values from the TSSD vault document:
- `uwrScore` — UWR score from original pipeline run
- `validatorDecision` — Validator decision (approve/reject/flag/abstain)
- `execution` — Execution result (simulated/skipped)
- `meta` — Signal metadata (symbol, timeframe, strategy, etc.)
- `receiptProvenance` — Optional mint provenance (Phase 1.5)

#### `recomputed`
Fresh values from replaying the signal through the pipeline:
- `uwrScore` — UWR score from replay
- `validatorDecision` — Validator decision from replay
- `execution` — Execution result from replay

#### `comparison`
Comparison summary between stored and recomputed values:
- `uwrScoreDelta` — Difference between recomputed and stored UWR scores
- `decisionChanged` — Boolean indicating if validator decision changed
- `changes` — Array of human-readable change descriptions

#### `replayMeta`
Metadata about the replay operation:
- `ranAt` — Timestamp when replay was executed
- `pipelineVersion` — Pipeline/strategy version used for replay
- `notes` — Additional notes (e.g., "Read-only replay; no DB writes performed")

---

## Use Cases

### 1. Regression Testing

Detect unintended changes in pipeline behavior after code updates:

```bash
# Before code change
npm run replay:signal -- --id=test-signal-001
# Note: uwrScore = 0.7500, decision = approve

# After code change
npm run replay:signal -- --id=test-signal-001
# Note: uwrScore = 0.7521, decision = approve
# Delta: +0.0021 (acceptable drift)
```

### 2. Math Validation

Verify that UWR scoring and validator logic produce consistent results:

```bash
# Replay a known high-quality signal
npm run replay:signal -- --id=golden-signal-001
# Expected: uwrScore ≈ 0.92, decision = approve

# If results differ significantly, investigate:
# - Has the UWR formula changed?
# - Has enrichment data changed?
# - Has validator threshold changed?
```

### 3. Audit Trail

Provide auditors with reproducible evidence of signal processing:

```bash
# Auditor requests replay of a specific signal
curl http://localhost:8080/replay/signal/alpha-1733515200000

# Response includes:
# - Original stored values (immutable)
# - Recomputed values (current pipeline behavior)
# - Comparison summary (what changed and why)
```

### 4. Pipeline Drift Detection

Monitor for gradual drift in pipeline behavior over time:

```bash
# Replay a batch of signals from different epochs
for signalId in signal-001 signal-002 signal-003; do
  npm run replay:signal -- --id=$signalId
done

# Analyze deltas:
# - Small deltas (< 0.01) = acceptable noise
# - Large deltas (> 0.05) = investigate pipeline changes
# - Decision changes = critical, requires review
```

---

## Limitations & Caveats

### 1. Non-Determinism Sources

Replay may not be 100% deterministic due to:

- **Timestamps**: Execution timestamps will differ between original and replay
- **Enrichment Data**: External data sources (price feeds, news) may have changed
- **Random Seeds**: If pipeline uses randomization without fixed seeds
- **External APIs**: If pipeline calls external APIs (not applicable in Phase 2)

**Mitigation**: Use `rawPayload` when available for most accurate reconstruction.

### 2. Missing Data

Older TSSD documents may not have:
- `rawPayload` field (added in Phase 1)
- `receiptProvenance` block (added in Phase 1.5)
- Complete `stageSummaries` (only in demo mode)

**Mitigation**: Replay service falls back to reconstructing input from structured fields.

### 3. Pipeline Version Changes

If the pipeline has changed significantly since the original run:
- UWR formula updates
- Validator threshold changes
- Enrichment logic changes

**Mitigation**: Document pipeline version in `replayMeta.pipelineVersion` and track changes in git history.

### 4. MongoDB Dependency

Replay requires MongoDB to be configured and accessible:
- `AFI_MONGO_URI` must be set
- Network connectivity to MongoDB required
- Read permissions on `tssd_signals` collection required

**Mitigation**: Graceful error messages when MongoDB unavailable.

---

## Environment Variables

Replay uses the same MongoDB configuration as Phase 1:

```bash
# Required
AFI_MONGO_URI="mongodb://localhost:27017"

# Optional (defaults shown)
AFI_MONGO_DB_NAME="afi"
AFI_MONGO_COLLECTION_TSSD="tssd_signals"
```

---

## Testing

Run replay tests:

```bash
npm test -- vaultReplayService.test.ts
```

Test coverage includes:
- ✅ Type safety for `ReplayResult`
- ✅ Comparison logic (uwrScoreDelta, decisionChanged)
- ✅ Pipeline input reconstruction (with/without rawPayload)
- ✅ Error handling (signal not found, MongoDB unavailable)
- ✅ Receipt provenance support

---

## Future Extensions (Phase 3+)

Potential enhancements for future phases:

### 1. Batch Replay
```bash
npm run replay:batch -- --epochId=5
npm run replay:batch -- --mintStatus=eligible
```

### 2. Replay Diff Report
```bash
npm run replay:diff -- --before=commit-abc --after=commit-xyz
# Compare replay results across code versions
```

### 3. Automated Regression Suite
```bash
npm run replay:regression
# Replay golden signals and assert deltas within tolerance
```

### 4. Replay with Custom Pipeline Version
```bash
npm run replay:signal -- --id=test-001 --version=v0.2
# Replay with a specific pipeline version
```

### 5. Replay Event Streaming
```bash
# Stream replay results to analytics platform
npm run replay:stream -- --target=datadog
```

---

## Architecture Notes

### Service Layer

**`vaultReplayService.ts`**:
- `replaySignalById(signalId)` — Main replay function
- `reconstructPipelineInput(doc)` — Maps TSSD doc to pipeline input
- `buildReplayResult(stored, recomputed)` — Builds comparison result

### HTTP Layer

**`server.ts`**:
- `GET /replay/signal/:signalId` — HTTP endpoint for replay

### CLI Layer

**`cli/replaySignal.ts`**:
- Command-line tool for replay
- Pretty-prints comparison results
- Handles argument parsing and error messages

### Type Layer

**`types/TssdSignalDocument.ts`**:
- `ReplayResult` interface — Structured replay result
- `TssdSignalDocument` interface — Vault document schema

---

## Backward Compatibility

Phase 2 is **fully backward-compatible** with Phase 1 and Phase 1.5:

- ✅ No changes to TSSD document schema
- ✅ No changes to vault write operations
- ✅ No changes to existing endpoints
- ✅ Replay is additive (new endpoints and CLI only)
- ✅ Graceful degradation (replay fails gracefully if MongoDB unavailable)

---

## Security Considerations

### Read-Only Operations

Replay is **read-only** by design:
- ✅ No MongoDB writes during replay
- ✅ No state mutations
- ✅ No on-chain calls
- ✅ No external API calls (beyond MongoDB read)

### Access Control

Consider adding authentication for production deployments:
- HTTP endpoint currently has no auth (dev/demo only)
- For production, add API key or JWT authentication
- Restrict MongoDB read access to authorized users

---

**End of Phase 2 Documentation**

