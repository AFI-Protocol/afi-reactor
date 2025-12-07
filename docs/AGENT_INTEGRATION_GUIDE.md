# Agent Integration Guide

## Overview

This guide explains how agents (ElizaOS, AOS, custom agents) integrate with AFI-Reactor's DAG orchestration system.

**Key Principle:** AFI-Reactor is the **source of truth** for orchestration. Agents are **workers** that plug into the DAG and obey the rules defined by Reactor.

---

## Agent Registration (Conceptual)

Agents are registered into the DAG through configuration files and metadata:

1. **Agent Registry** - See `config/agent.registry.json` and `config/execution-agent.registry.json`
2. **Codex Metadata** - See `.afi-codex.json` (repo root) and `config/agents.codex.json` for agent mappings; `codex/` is runtime-log-only.
3. **DAG Configuration** - Canonical DAG definitions live in `config/dag.codex.json`

**Note:** The exact registration API is still evolving. Current implementation uses configuration-based registration rather than programmatic APIs.

**Simulated agent markers:** Some registry entries may include `mode: "simulated"` and `environment: "dev"` to flag local/demo helpers. These agents are safe for demos, local tests, and exploration; production-grade agents will either omit these fields or use a different `environment` value (e.g., `"prod"`) later. This is descriptive only—no runtime behavior is implied.

---

## Agent Roles & Responsibilities

Each agent is assigned to one or more **node categories** in the DAG. The category determines the agent's responsibilities and when it is invoked.

### **Generator Agents** (Signal Sources)

**Purpose:** Produce candidate signals from external data sources

**Responsibilities:**
- Monitor assigned data sources (market feeds, blockchain, social media, news)
- Generate signals when opportunities or events are detected
- Emit signals in the standard `DAGSignal` format
- Do NOT perform analysis or validation (that's for analyzers and validators)

**Examples:**
- `MarketDataAgentV1` - Streams price/volume data
- `OnchainFeedAgentV1` - Monitors blockchain events
- `SocialSignalAgentV1` - Crawls Twitter/Discord sentiment
- `NewsFeedAgentV1` - Parses financial news
- `AIStrategyAgentV1` - Generates trading strategies

**Key Rule:** Generators produce raw signals. They do not score, validate, or execute.

---

### **Analyzer Agents** (Deep Analysis & Insight)

**Purpose:** Enrich signals with technical, sentiment, and ML-based analysis

**Responsibilities:**
- Receive signals from generators or other analyzers
- Apply domain-specific analysis (TA, pattern recognition, sentiment, ML)
- Add enrichment data to signal metadata
- Pass enriched signals to validators or other analyzers
- Do NOT make final accept/reject decisions (that's for validators)

**Examples:**
- `TechnicalAnalysisAgentV1` - Runs TA indicators
- `PatternRecognitionAgentV1` - Detects chart patterns
- `SentimentAnalysisAgentV1` - Evaluates sentiment
- `NewsEventAgentV1` - Analyzes news impact
- `AIEnsembleAgentV1` - Aggregates ML predictions

**Key Rule:** Analyzers enrich signals. They do not generate new signals or execute actions.

---

### **Validator Agents** (Proof-of-Intelligence Layer)

**Purpose:** Score, accept, or reject signals based on defined quality criteria

**Responsibilities:**
- Receive enriched signals from analyzers
- Apply Proof-of-Insight (PoI) and Proof-of-Intelligence checks
- Assign quality scores and confidence levels
- Accept or reject signals based on thresholds
- Route accepted signals to executors or observers
- Route rejected signals to logging/audit

**Examples:**
- `augmentcode` - Automated validation agent
- `factory.droid` - Droid-based validation
- `SignalValidator` - Core validation logic
- `MentorChainOrchestrator` - Mentor-based governance

**Key Rule:** Validators make accept/reject decisions. They do not execute trades or actions.

---

### **Executor Agents** (Output Actions)

**Purpose:** Send validated signals to downstream systems for execution

**Responsibilities:**
- Receive validated signals from validators
- Route signals to appropriate execution systems (exchanges, on-chain contracts)
- Handle execution confirmation and error handling
- Report execution results back to observers
- Do NOT bypass validation (all signals must be validated first)

**Examples:**
- `ExchangeExecutionAgentV1` - Routes to exchange APIs
- *(Future: On-chain execution agents)*

**Key Rule:** Executors only act on validated signals. They do not generate, analyze, or validate.

---

### **Observer Agents** (Telemetry & Monitoring)

**Purpose:** Log, audit, and monitor all pipeline activity

**Responsibilities:**
- Receive signals at various pipeline stages
- Log signals, scores, and actions to persistent storage (T.S.S.D. Vault)
- Generate telemetry and metrics
- Support replay and audit capabilities
- Do NOT modify signals or affect pipeline flow

**Examples:**
- `TelemetryAgentV1` - Logs to T.S.S.D. Vault
- `scarlet` - Persistence agent

**Key Rule:** Observers are read-only. They log and monitor but do not modify pipeline behavior.

---

## Orchestration Authority

**Critical Rule:** Reactor tells the agents **how** and **when** to act. Agents do **NOT** arbitrarily call each other outside the DAG without going through Reactor.

### What This Means:

✅ **Allowed:**
- Agent receives signal from Reactor
- Agent processes signal according to its role
- Agent returns result to Reactor
- Reactor routes result to next node(s)

❌ **NOT Allowed:**
- Agent directly calls another agent
- Agent bypasses validation and sends signal to executor
- Agent modifies orchestration rules or pipeline flow
- Agent creates new DAG paths without Reactor approval

### Why This Matters:

- **Determinism** - Pipeline behavior is predictable and reproducible
- **Auditability** - All signal flows are logged and traceable
- **Safety** - No agent can bypass validation or governance
- **Testability** - Tests can mock individual nodes without affecting orchestration

---

## ElizaOS / AOS Integration

ElizaOS and AOS agents are treated as **pluggable workers** in the AFI-Reactor DAG:

1. **ElizaOS agents run inside pipelines defined by AFI-Reactor** - They do not define their own orchestration
2. **Eliza's native orchestrator is an implementation detail** - It may be wrapped or reused as a node/operator under Reactor's authority
3. **AOS hooks are supported** - See `codex/.afi-codex.json` for `aosHook: true`
4. **Compatibility is maintained** - See `elizaOSCompatible: true` in Codex metadata

---

## Adding a New Agent

To add a new agent to the AFI-Reactor DAG:

1. **Identify the agent's role** - Generator, Analyzer, Validator, Executor, or Observer
2. **Implement the agent** - Follow the signal interface and role responsibilities
3. **Register the agent** - Add to `config/agent.registry.json` or `config/execution-agent.registry.json`
4. **Update Codex metadata** - Add to `codex/.afi-codex.json` under the appropriate category
5. **Update DAG configuration** - Add to `config/dag.codex.json` if needed
6. **Test the agent** - Write tests that mock Reactor inputs/outputs
7. **Document the agent** - Update this guide and the DAG spec

---

## Best Practices

1. **Keep agents stateless when possible** - State should be managed by Reactor or external storage
2. **Use standard signal formats** - Follow the `DAGSignal` interface
3. **Handle errors gracefully** - Return error signals rather than throwing exceptions
4. **Log important events** - Use observers for telemetry
5. **Test in isolation** - Mock Reactor inputs/outputs for unit tests
6. **Respect role boundaries** - Don't mix generator/analyzer/validator logic in one agent

---

**Last Updated:** 2025-11-16  
**Maintained By:** AFI Protocol Core Team
