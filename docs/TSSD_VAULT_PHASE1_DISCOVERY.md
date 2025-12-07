# T.S.S.D. Vault Phase 1 — Discovery Notes

**Date**: 2025-12-07  
**Engineer**: AFI Vault Integration Engineer  
**Mission**: Make the AFI `tssd-vault-service` REAL by wiring the AFI Eliza demo pipeline into MongoDB

---

## 1. Where the Final Pipeline Result is Generated

### AFI Eliza Demo Endpoint

**Location**: `afi-reactor/src/server.ts` (lines 170-213)

**Endpoint**: `POST /demo/afi-eliza-demo`

**Orchestrator**: `runFroggyTrendPullbackFromTradingView()` in `src/services/froggyDemoService.ts`

**Pipeline Flow** (6 stages):
1. **Alpha Scout Ingest** → `alphaScoutIngest.run()` → Converts TradingView payload to reactor signal envelope
2. **Signal Structurer** (Pixel Rick) → `signalStructurer.run()` → Normalizes to USS (Universal Signal Schema)
3. **Froggy Enrichment Adapter** → `froggyEnrichmentAdapter.run()` → Applies enrichment legos (technical, pattern, etc.)
4. **Froggy Analyst** → `froggyAnalyst.run()` → Runs `trend_pullback_v1` strategy, computes UWR score
5. **Validator Decision Evaluator** (Val Dook) → `validatorDecisionEvaluator.run()` → Makes approve/reject/flag/abstain decision
6. **Execution Agent Sim** → `executionAgentSim.run()` → Simulates trade execution (no real trading)

**Final Result Type**: `FroggyPipelineResult` (defined in `src/services/froggyDemoService.ts`, lines 89-122)

**Key Fields**:
- `signalId` (string)
- `validatorDecision` (object with `decision`, `uwrConfidence`, `reasonCodes`)
- `execution` (object with `status`, `type`, `asset`, `amount`, `simulatedPrice`, `timestamp`, `notes`)
- `meta` (object with `symbol`, `timeframe`, `strategy`, `direction`, `source`)
- `uwrScore` (number)
- `stageSummaries` (array of `PipelineStageSummary` objects) — DEMO-ONLY
- `isDemo` (boolean) — DEMO-ONLY marker

---

## 2. Which Type/Schema Best Represents the Persistable Signal

### Recommended Approach: Custom TSSD Document Schema

**Rationale**:
- The `FroggyPipelineResult` is demo-focused and includes UI-friendly fields like `stageSummaries`.
- For vault persistence, we need a **time-series optimized** document that:
  - Captures the **final scored + validated signal**
  - Includes **key metadata** for querying (symbol, timeframe, strategy, decision, UWR score)
  - Supports **time-series indexing** (createdAt, signalId)
  - Is **forward-compatible** with future replay/audit features

**Proposed Schema**: `TssdSignalDocument` (to be defined in Phase 1 Design)

**Core Fields** (derived from `FroggyPipelineResult`):
- `signalId` (string) — unique identifier
- `createdAt` (Date) — timestamp for time-series indexing
- `source` (string) — e.g., "afi-eliza-demo", "tradingview-webhook"
- `market` (object) — `{ symbol, timeframe, market }`
- `pipeline` (object) — `{ uwrScore, validatorDecision, execution, stageSummaries }`
- `rawPayload` (unknown) — original inbound payload (for replay/audit)
- `version` (string) — schema version (e.g., "v0.1")

---

## 3. Existing Vault-Related References

### Stub Implementations (NOT REAL)

1. **`src/core/VaultService.ts`** (43 lines)
   - Stub class with static methods
   - All methods throw "not implemented yet"
   - **Status**: Scaffold only, not functional

2. **`plugins/tssd-vault-service.ts`** (32 lines)
   - DAG plugin stub
   - Returns `{ ...signal, vaultStatus: "stored" }` without real persistence
   - **Status**: Stub, no real DB

3. **`test/vaultInsert.test.ts`** (17 lines)
   - Placeholder smoke test
   - No real vault insert coverage
   - **Status**: Placeholder only

### References in Documentation

1. **`docs/VALIDATOR_REPLAY_SPEC.v0.1.md`**
   - Defines replay lifecycle: `scored-signal` → `afi-ensemble-score` → `dao-mint-checkpoint` → `validated-signal` → `tssd-vault-persist` → `vaulted-signal`
   - Notes that canonical `vaulted-signal` schema is owned by **afi-infra**
   - **Status**: Spec only, not implemented

2. **`config/dag.codex.json`**
   - Defines `tssd-vault-persist` DAG node (lines 32-38)
   - Plugin: `tssd-vault-service`
   - Input: `approved-signal`
   - Output: `vaulted-signal`
   - **Status**: DAG config only, plugin is stub

3. **`tools/afi-technical-indicators.mcp.ts`**
   - Example MongoDB connection code (lines 1-19)
   - Uses `mongodb` driver to query `tssd_signals` collection
   - **Status**: Example/tool, not integrated into pipeline

### Key Findings

- **No real MongoDB persistence** exists in the AFI Eliza Demo pipeline
- **Stub implementations** are placeholders only
- **DAG config** references TSSD vault, but plugin is not functional
- **Example code** shows MongoDB connection pattern we can follow

---

## 4. Summary

**Current State**:
- ✅ AFI Eliza Demo pipeline is fully functional (6 stages, deterministic results)
- ✅ Final result type (`FroggyPipelineResult`) is well-defined
- ❌ No real MongoDB persistence (all vault code is stubs)
- ❌ No TSSD vault integration in the demo endpoint

**Next Steps** (Phase 1):
1. Design `TssdSignalDocument` schema (optimized for time-series storage)
2. Implement `TssdVaultService` class (MongoDB connection + insert)
3. Wire vault service into `runFroggyTrendPullbackFromTradingView()` orchestrator
4. Add `vaultWrite: "success" | "failed" | "skipped"` to endpoint response
5. Create tests (mocked or in-memory MongoDB)
6. Document env vars and setup

---

**End of Discovery Notes**

