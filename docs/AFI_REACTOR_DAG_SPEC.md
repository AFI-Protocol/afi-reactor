# AFI Reactor DAG Spec (Orchestrator Contract)

## Overview

**AFI-Reactor is the canonical orchestrator for Agentic Financial Intelligence (AFI).**

This document defines the **intended pipeline architecture** and **orchestration contract** that all agents, modules, and external systems must follow when interacting with AFI Protocol.

AFI-Reactor defines:
- **How** agents and modules interact (not their internal intelligence)
- **When** nodes are invoked and in what order
- **Where** outputs are routed within the DAG
- **What** message shapes flow through the pipeline

AFI-Reactor is **NOT** responsible for:
- Token minting or emissions logic (see `afi-token` repo)
- Individual agent intelligence or ML models
- Infrastructure deployment (see `afi-infra` and `afi-ops`)

---

## Node Categories

The AFI-Reactor DAG is organized into **5 primary categories** with **15 total nodes** in the current target design:

### **Generators** (Signal Sources)

Generators produce candidate signals from various data sources. They are the entry points to the DAG.

1. **market-data-streamer** - Pulls real-time market price and volume feeds from exchanges
2. **onchain-feed-ingestor** - Collects blockchain events, token metrics, and liquidity data
3. **social-signal-crawler** - Gathers social and community sentiment signals from Twitter, Discord, etc.
4. **news-feed-parser** - Monitors and parses financial and economic news headlines
5. **ai-strategy-generator** - Synthesizes trading strategies based on live market opportunities

### **Analyzers** (Deep Analysis & Insight)

Analyzers enrich signals with technical, sentiment, and ML-based analysis.

6. **technical-analysis-node** - Runs TA indicators, patterns, and multi-timeframe evaluations
7. **pattern-recognition-node** - Detects unique structures like harmonics, fractals, and breakout signals
8. **sentiment-analysis-node** - Evaluates market sentiment from social and onchain data
9. **news-event-analysis-node** - Measures the impact of breaking news and macroeconomic events
10. **ai-ml-ensemble-node** - Aggregates AI/ML scoring and probabilistic outcomes for decisioning

### **Validators** (Proof-of-Intelligence Layer)

Validators score, accept, or reject signals based on defined quality criteria.

11. **signal-validator** - Performs Proof-of-Insight (PoI) and Proof-of-Intelligence checks
12. **mentorchain-orchestrator** - Coordinates mentor-agent review for pipeline integrity and governance

### **Executors** (Output Actions)

Executors send validated signals to downstream systems for execution.

13. **exchange-execution-node** - Routes signals to live trade execution or on-chain actions

### **Observers** (Telemetry & Monitoring)

Observers log, audit, and monitor all pipeline activity.

14. **telemetry-log-node** - Logs all signals, scores, and actions into the T.S.S.D. Vault
15. *(Reserved for future observer nodes)*

---

## Message Shape / Signal Envelope

**DRAFT:** The following interface represents the conceptual shape of a signal as it moves through the DAG. This is based on existing types in the codebase and may evolve.

```typescript
interface DAGSignal {
  signalId: string;           // Unique identifier for this signal
  source?: string;            // Origin node or agent
  timestamp: string;          // ISO 8601 timestamp
  score?: number;             // Quality/confidence score (0.0 - 1.0)
  confidence?: number;        // Confidence level (0.0 - 1.0)
  meta?: Record<string, any>; // Arbitrary metadata
  payload?: any;              // Signal-specific data
  processed?: boolean;        // Whether signal has been processed
  processedAt?: string;       // When signal was processed
  dagType?: string;           // Which DAG pipeline processed this signal
}
```

**Key Fields:**
- `signalId` - Unique identifier for tracking and replay
- `score` - Quality metric assigned by validators
- `confidence` - Confidence level in the signal
- `meta` - Extensible metadata for routing, tagging, and context
- `dagType` - Identifies which pipeline (e.g., `signal-to-vault`, `signal-to-vault-cognition`)

---

## Execution Rules

AFI-Reactor enforces the following orchestration rules:

1. **Node Invocation Control** - Reactor determines which nodes can call which other nodes. Agents do not arbitrarily call each other outside the DAG.

2. **Ordering & Dependencies** - Reactor defines the execution order. For example:
   - Generators → Analyzers → Validators → Executors → Observers
   - Parallel execution is allowed within categories when dependencies permit

3. **Retry & Failure Modes** - Reactor can enforce retry policies and failure handling at the orchestration level

4. **State Management** - Pipeline state, Codex replay, and audit logs are owned by Reactor

5. **Agent Authority** - Individual agents (validators, mentors, tools) are **pluggable nodes** that the DAG calls. They never control global orchestration.

---

## Integration with AFI-Core & Tokens

### AFI-Core Integration

- **AFI-Reactor calls into AFI-Core** for reusable validators, helpers, and shared logic
- AFI-Core provides the **runtime library** (validators, utilities, types)
- AFI-Core does **NOT** define orchestration or pipeline flow

### Token Integration

- **Token minting and AFI token emissions logic live in the `afi-token` repo**
- Reactor does **NOT** mint tokens directly
- Reactor produces **validated outcomes** (signals, scores, proofs) that other components can use to trigger minting

### ElizaOS / AOS Integration

- ElizaOS and AOS agents are **workers** that plug into the DAG
- Reactor defines **when** agents are invoked, **which** inputs they receive, and **where** outputs are routed
- Eliza's native orchestrator is an **implementation detail** - it may be wrapped or reused as a node/operator under Reactor's authority

---

## Pipeline Types

The current target design includes **2 primary pipelines**:

1. **signal-to-vault** - Full pipeline from generation through validation to vault storage
2. **signal-to-vault-cognition** - Extended pipeline with additional cognition/ML analysis

Additional pipelines may be added as the system evolves.

---

## Status & Roadmap

**Current Implementation Status:**
- 15-node DAG architecture defined
- Codex metadata and agent registry in place
- Test infrastructure present but requires configuration updates
- Core DAG engine (`core/dag-engine.ts`) implements basic orchestration

**Known TODOs:**
- Finalize signal schema and validation rules
- Complete test suite configuration (Jest/Vitest alignment)
- Document retry and failure handling policies
- Add observability and metrics collection

---

## For Droid Developers

When extending AFI-Reactor:

1. **Add new nodes by following this DAG spec** - Identify the category (generator, analyzer, validator, executor, observer)
2. **Do not change orchestrator rules without updating this spec** - All changes to execution order, dependencies, or routing must be documented here
3. **Keep all external I/O behind clear interfaces** - Tests should remain deterministic and not depend on live networks
4. **Update Codex metadata** when adding nodes - See `codex/.afi-codex.json` and related files

---

**Last Updated:** 2025-11-16  
**Maintained By:** AFI Protocol Core Team

