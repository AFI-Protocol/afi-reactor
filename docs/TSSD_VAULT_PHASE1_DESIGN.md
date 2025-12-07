# T.S.S.D. Vault Phase 1 — Design Specification

**Date**: 2025-12-07  
**Engineer**: AFI Vault Integration Engineer  
**Status**: Phase 1 — Basic Persistence Only

---

## 1. Goal

Persist final scored + validated signal runs from the **AFI Eliza Demo pipeline** into a MongoDB collection called `tssd_signals` in database `afi`.

**Scope**:
- ✅ Store final pipeline results (signal ID, UWR score, validator decision, execution status, stage summaries)
- ✅ Time-series optimized document structure
- ✅ Graceful degradation (if MongoDB unavailable, log error but don't crash)
- ✅ Add `vaultWrite` status to endpoint response
- ❌ NO replay logic (Phase 2+)
- ❌ NO complex querying (Phase 2+)
- ❌ NO real-time analytics (Phase 2+)

---

## 2. MongoDB Document Schema

### TypeScript Interface: `TssdSignalDocument`

```typescript
/**
 * T.S.S.D. (Time-Series Signal Data) Vault Document
 * 
 * This document represents a single scored + validated signal run
 * stored in MongoDB for audit, replay, and analytics.
 * 
 * Collection: tssd_signals
 * Database: afi
 * Indexes: createdAt (time-series), signalId (unique)
 */
export interface TssdSignalDocument {
  /** Unique signal identifier (from pipeline) */
  signalId: string;

  /** Timestamp when signal was created (for time-series indexing) */
  createdAt: Date;

  /** Source of the signal (e.g., "afi-eliza-demo", "tradingview-webhook") */
  source: "afi-eliza-demo" | "tradingview-webhook" | string;

  /** Market metadata */
  market: {
    symbol: string;        // e.g., "BTC/USDT"
    timeframe: string;     // e.g., "1h", "15m", "4h"
    market?: string;       // e.g., "spot", "perp", "futures"
  };

  /** Pipeline execution results */
  pipeline: {
    /** UWR (Universal Weighting Rule) score from Froggy analyst */
    uwrScore: number;

    /** Validator decision from Val Dook */
    validatorDecision: {
      decision: "approve" | "reject" | "flag" | "abstain";
      uwrConfidence: number;
      reasonCodes?: string[];
    };

    /** Execution result (simulated) */
    execution: {
      status: "simulated" | "skipped";
      type?: "buy" | "sell" | "hold";
      asset?: string;
      amount?: number;
      simulatedPrice?: number;
      timestamp: string;
      notes?: string;
    };

    /** Stage summaries (DEMO-ONLY: for AFI Eliza Demo narration) */
    stageSummaries?: Array<{
      stage: string;
      persona: string;
      status: string;
      summary: string;
      uwrScore?: number;
      decision?: string;
      enrichmentCategories?: string[];
    }>;
  };

  /** Strategy metadata */
  strategy: {
    name: string;          // e.g., "froggy_trend_pullback_v1"
    direction: string;     // e.g., "long", "short", "neutral"
  };

  /** Original inbound payload (for replay/audit) */
  rawPayload?: unknown;

  /** Schema version (for forward compatibility) */
  version: "v0.1";
}
```

### MongoDB Collection Configuration

**Collection Name**: `tssd_signals`  
**Database Name**: `afi`

**Indexes** (to be created manually or via migration):
- `createdAt` (ascending) — for time-series queries
- `signalId` (unique) — for deduplication and lookups
- `source` (ascending) — for filtering by source
- `market.symbol` (ascending) — for symbol-based queries
- `pipeline.validatorDecision.decision` (ascending) — for decision-based queries

---

## 3. Environment Variables & Configuration

### Required Environment Variables

```bash
# MongoDB connection URI (Atlas or local)
AFI_MONGO_URI="mongodb+srv://afi_app:<password>@cluster0.abc123.mongodb.net/?retryWrites=true&w=majority&appName=AFI"

# Database name
AFI_MONGO_DB_NAME="afi"

# Collection name for TSSD signals
AFI_MONGO_COLLECTION_TSSD="tssd_signals"
```

### Configuration Behavior

**If `AFI_MONGO_URI` is NOT set**:
- Vault service is **disabled**
- Log info-level message: `"TSSD vault disabled: AFI_MONGO_URI not set"`
- Set `vaultWrite: "skipped"` in endpoint response
- **Do NOT throw or crash**

**If `AFI_MONGO_URI` is set but connection fails**:
- Log error-level message: `"TSSD vault connection failed: <error message>"`
- Set `vaultWrite: "failed"` in endpoint response
- **Do NOT throw or crash** (graceful degradation)

**If insert succeeds**:
- Log info-level message: `"TSSD vault insert successful: signalId=<signalId>"`
- Set `vaultWrite: "success"` in endpoint response

---

## 4. Error Handling & Graceful Degradation

### Phase 1 DEMO Mode

For Phase 1, the AFI Eliza Demo endpoint **MUST NOT crash** if MongoDB is unavailable.

**Error Handling Strategy**:
1. Wrap all MongoDB operations in `try/catch`
2. Log errors clearly (with structured logging)
3. Return `vaultWrite: "failed"` or `vaultWrite: "skipped"` in response
4. Continue normal pipeline execution (vault is optional for demo)

### Example Error Scenarios

| Scenario | Behavior | `vaultWrite` Status |
|----------|----------|---------------------|
| `AFI_MONGO_URI` not set | Skip vault, log info | `"skipped"` |
| MongoDB connection fails | Log error, continue | `"failed"` |
| Insert fails (duplicate key) | Log error, continue | `"failed"` |
| Insert succeeds | Log success | `"success"` |

---

## 5. API Response Changes

### Updated `FroggyPipelineResult` Type

Add a new optional field to the existing `FroggyPipelineResult` interface:

```typescript
export interface FroggyPipelineResult {
  signalId: string;
  validatorDecision: { ... };
  execution: { ... };
  meta: { ... };
  uwrScore: number;
  stageSummaries?: PipelineStageSummary[];
  isDemo?: boolean;
  
  /** NEW: Vault write status (Phase 1) */
  vaultWrite?: "success" | "failed" | "skipped";
}
```

### Example Response (Success)

```json
{
  "signalId": "alpha-1733515200000",
  "validatorDecision": {
    "decision": "approve",
    "uwrConfidence": 0.78,
    "reasonCodes": ["score-high"]
  },
  "execution": { ... },
  "meta": { ... },
  "uwrScore": 0.75,
  "stageSummaries": [ ... ],
  "isDemo": true,
  "vaultWrite": "success"
}
```

---

## 6. Implementation Checklist

- [ ] Create `src/services/tssdVaultService.ts` (MongoDB client + insert logic)
- [ ] Create `src/types/TssdSignalDocument.ts` (TypeScript interface)
- [ ] Update `src/services/froggyDemoService.ts` (add vault integration)
- [ ] Update `src/server.ts` (pass vault status to response)
- [ ] Create `.env.example` (with MongoDB env vars)
- [ ] Create `test/tssdVaultService.test.ts` (mocked tests)
- [ ] Create `docs/TSSD_VAULT_MONGO_PHASE1_NOTES.md` (setup guide)
- [ ] Update `package.json` (add `mongodb` dependency if not present)

---

**End of Design Specification**

