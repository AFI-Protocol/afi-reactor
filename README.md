# AFI-Reactor ⚡

[![AFI-Reactor Validation](https://github.com/AFI-Protocol/afi-reactor/actions/workflows/validate-all.yml/badge.svg)](https://github.com/AFI-Protocol/afi-reactor/actions/workflows/validate-all.yml)

**AFI-Reactor is the canonical orchestrator for Agentic Financial Intelligence (AFI).**

It orchestrates a multi-agent DAG-based pipeline capable of generating, analyzing, validating, executing, and observing financial signals at scale.

> **Note:** This repository was renamed from `afi-engine` to `afi-reactor` on 2025-11-14 as part of the multi-repo reorganization to establish clear orchestration boundaries.
> **Canonical config:** DAG/Codex definitions live under `config/*.codex.json`. The `codex/` directory is reserved for runtime logs (e.g., replay outputs) and is not a source of truth.

## 🤖 Droid Instructions

**For AI agents and automated contributors**: See [AGENTS.md](./AGENTS.md) for canonical repo constraints, allowed tasks, and safe patch patterns.

> **Note**: If AGENTS.md conflicts with this README, AGENTS.md wins.
> **Critical**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` before modifying DAG logic.

## 🔒 Security

**IMPORTANT**: This repository uses environment variables for sensitive configuration.

**Quick setup**:
```bash
cp .env.example .env
# Edit .env with your credentials (NEVER commit this file)
```

---

## 🚀 Flexible DAG Architecture

AFI-Reactor implements a **flexible, plugin-based DAG pipeline** that can be customized with as many nodes as needed while adhering to AFI standards. The system supports dynamic pipeline construction through a composable plugin architecture.

### Core Node Types

AFI-Reactor uses two categories of nodes: **core nodes** and **plugin nodes**.

#### Core Nodes (Required)

Core nodes are always present in the DAG and handle fundamental pipeline operations:

- **AnalystNode** — Loads analyst configuration, initializes enrichment pipeline, aggregates enrichment results (including AI/ML predictions), scores signals using ensemble ML models, and generates narratives
- **ExecutionNode** — Aggregates enrichment results, validates enrichment results, generates final scored signal, and prepares signal for observer
- **ObserverNode** — Observes the final scored signal, logs execution metrics, publishes signal to downstream consumers, and adds trace entries for execution tracking

#### Plugin Nodes (Optional & Composable)

Plugin nodes provide specific functionality and can be enabled/disabled as needed:

- **ScoutNode** — Scouts for new signals from external sources or AFI-native models, discovers trading opportunities, submits signals to enrichment pipeline, and tracks signal submissions for reward attribution
- **NewsNode** — Fetches news data from news providers, extracts news features, and stores news enrichment results
- **SentimentNode** — Fetches sentiment data from sentiment providers, calculates sentiment scores, and stores sentiment enrichment results
- **PatternRecognitionNode** — Detects chart patterns, calculates pattern metrics, and stores pattern recognition enrichment results
- **SignalIngressNode** — Ingests external signals, normalizes signal format, and stores signal ingress results
- **TechnicalIndicatorsNode** — Calculates technical indicators and stores technical indicator enrichment results
- **AiMlNode** — Calls AI/ML providers for predictions and stores AI/ML enrichment results (conviction scores, direction, regime, risk flags)

### Pipeline Flow

1. **Scout nodes** execute first (independent signal sources, no dependencies)
2. **Signal Ingress nodes** execute second (may depend on Scout)
3. **Enrichment nodes** execute in parallel where possible (based on dependencies)
4. **Required nodes** execute last (analyst → execution → observer)

**Note:** This flexible architecture allows analysts to configure custom pipelines by selecting and ordering plugins as needed, as long as they follow the AFI Orchestrator Doctrine.

✅ **Codex Health:** 100%
✅ **DAG Success Rate:** 100%
✅ **Agent Readiness:** 100%

---

## 🧠 Node Architecture

### Core vs Plugin Nodes

**Core nodes**:
- Always present in the DAG
- Handle fundamental pipeline operations
- Cannot be disabled or removed
- Execute in fixed order (analyst → execution → observer)

**Plugin nodes**:
- Optional and composable
- Can be enabled/disabled
- Can be ordered as needed
- Execute based on DAG configuration and dependencies

### Signal Providers (Scouts)

Scouts are signal providers that bring strategies producing buy/sell signals or trade setups:

- **ScoutNode** — Discovers signals from external sources or AFI-native models
- Does NOT perform scoring (that's Analyst's responsibility)
- Does NOT enrich signals (that's Enrichers' responsibility)
- Tracks submissions for reward attribution (important for third-party Scouts)

### Enrichment Layers

The pipeline supports multiple enrichment layers that can be configured:

- **Technical**: Technical indicators (RSI, MACD, EMA, etc.)
- **Pattern**: Chart pattern recognition (head and shoulders, triangles, etc.)
- **Sentiment**: Market sentiment analysis (social media, news sentiment)
- **News**: News analysis and feature extraction
- **AI/ML**: AI/ML predictions (conviction scores, direction, regime, risk flags)

---

## ⚡ Quick Start

Run the full validation pipeline:

```bash
npm run validate-all
```

---

## 📊 CI & Codex

Artifacts from CI include:
- `config/dag.codex.json` / `config/ops.codex.json` / `config/schema.codex.json` → canonical orchestrator config  
- `codex/codex.replay.log.json` → generated replay log (runtime output; gitignored)  
- `tmp/dag-simulation.log.json` → Simulation telemetry  
- `tmp/mentor-evaluation.json` → MentorChain readiness scores

All commits to `main` trigger a full CI run with:
- **DAG Replay Validation**
- **Signal Simulation**
- **MentorChain Evaluation**
- **Artifact Upload for 30 Days**

---

## 📜 AFI Orchestrator Doctrine

**afi-reactor is the ONLY orchestrator in AFI Protocol.** All canonical pipelines, DAGs, and routing logic live here.

### The 10 Commandments

1. **afi-reactor is the orchestrator of AFI** - All canonical pipelines, DAGs, and routing logic live here—not in afi-core, not in random helpers.

2. **afi-core is our runtime library, not our boss** - ElizaOS and AFI agents run inside pipelines defined by afi-reactor.

3. **The DAG is law** - Every signal path (ingest → enrich → score → mint/review) must be expressible as a Reactor DAG; ad-hoc flows are anti-patterns.

4. **Agents are nodes, not gods** - Individual agents (validators, mentors, tools) are pluggable nodes the DAG calls; they never control global orchestration.

5. **Eliza's native orchestrator is an implementation detail** - We may wrap or reuse it, but only as a node/operator under afi-reactor's authority.

6. **State & replay belong here** - Pipeline state, Codex replay, audits, and deterministic re-runs are owned by afi-reactor, even if storage is elsewhere.

7. **Configuration is externalized** - Reactor reads network, persona, and pipeline configs from afi-config and related registries; no hard-coded magic.

8. **No token/econ logic in afi-reactor** - Emissions, rewards, and AFI token rules live in afi-token; Reactor just emits events/hooks.

9. **No infra glue in afi-reactor** - Deployment, Terraform, K8s, etc. live in afi-infra / afi-ops. Reactor exposes clean interfaces they can target.

10. **If orchestration logic doesn't fit this doctrine, it's in the wrong repo** - Move it or refactor it until afi-reactor remains the single, boringly-obvious brain.

**Full doctrine:** See [AFI_ORCHESTRATOR_DOCTRINE.md](../AFI_ORCHESTRATOR_DOCTRINE.md) in the workspace root.

---

## 🌌 AFI-Reactor Vision

AFI-Reactor is **agent-first**, **modular**, and **framework-agnostic**, powering use cases for:
- Retail traders and institutions
- Agent developers and ML researchers
- Real-time financial signal generation and execution
- Experimentation, stress testing, and open innovation

We embrace **stress-tested resilience**, inviting contributors to push the boundaries and make AFI stronger with every iteration.
