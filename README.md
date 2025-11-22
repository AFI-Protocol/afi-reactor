# AFI-Reactor ⚡

[![AFI-Reactor Validation](https://github.com/AFI-Protocol/afi-reactor/actions/workflows/validate-all.yml/badge.svg)](https://github.com/AFI-Protocol/afi-reactor/actions/workflows/validate-all.yml)

**AFI-Reactor is the canonical orchestrator for Agentic Financial Intelligence (AFI).**

It orchestrates a multi-agent DAG-based pipeline capable of generating, analyzing, validating, executing, and observing financial signals at scale.

> **Note:** This repository was renamed from `afi-engine` to `afi-reactor` on 2025-11-14 as part of the multi-repo reorganization to establish clear orchestration boundaries.

## 🤖 Droid Instructions

**For AI agents and automated contributors**: See [AGENTS.md](./AGENTS.md) for canonical repo constraints, allowed tasks, and safe patch patterns.

> **Note**: If AGENTS.md conflicts with this README, AGENTS.md wins.
> **Critical**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` before modifying DAG logic.

---

## 🚀 The 15-Node DAG

AFI-Engine now runs a **full 15-node Codex pipeline**, delivering a complete cycle of agentic financial intelligence:

```
[Generators]
  market-data-streamer
  onchain-feed-ingestor
  social-signal-crawler
  news-feed-parser
  ai-strategy-generator

[Analyzers]
  technical-analysis-node
  pattern-recognition-node
  sentiment-analysis-node
  news-event-analysis-node
  ai-ml-ensemble-node

[Validators]
  signal-validator
  mentorchain-orchestrator

[Executors]
  exchange-execution-node

[Observers]
  telemetry-log-node
```

✅ **Codex Health:** 100%  
✅ **DAG Success Rate:** 100%  
✅ **Agent Readiness:** 100%

---

## 🧠 Agent Roles

Each node has a designated role in the pipeline:

### **Generators** *(Signal Sources)*
- **market-data-streamer** → Pulls real-time market price and volume feeds  
- **onchain-feed-ingestor** → Collects blockchain events, token metrics, and liquidity data  
- **social-signal-crawler** → Gathers social and community sentiment signals  
- **news-feed-parser** → Monitors and parses financial and economic news headlines  
- **ai-strategy-generator** → Synthesizes strategies based on live opportunities  

### **Analyzers** *(Deep Analysis & Insight)*
- **technical-analysis-node** → Runs TA indicators, patterns, and multi-timeframe evaluations  
- **pattern-recognition-node** → Detects unique structures like harmonics, fractals, and breakout signals  
- **sentiment-analysis-node** → Evaluates market sentiment from social and onchain data  
- **news-event-analysis-node** → Measures the impact of breaking news and macroeconomic events  
- **ai-ml-ensemble-node** → Aggregates AI/ML scoring and probabilistic outcomes for decisioning  

### **Validators** *(Proof-of-Intelligence Layer)*
- **signal-validator** → Performs Proof-of-Insight & Proof-of-Intelligence checks  
- **mentorchain-orchestrator** → Coordinates mentor-agent review for pipeline integrity and governance  

### **Executors** *(Output Actions)*
- **exchange-execution-node** → Routes signals to live trade execution or on-chain actions  

### **Observers** *(Telemetry & Monitoring)*
- **telemetry-log-node** → Logs all signals, scores, and actions into the T.S.S.D. Vault  

---

## ⚡ Quick Start

Run the full validation pipeline:

```bash
npm run validate-all
```

---

## 📊 CI & Codex

Artifacts from CI include:
- `codex/codex.replay.log.json` → DAG node health and validation results  
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

AFI-Reactor is **agent-first**, **modular**, and **ElizaOS compatible**, powering use cases for:
- Retail traders and institutions
- Agent developers and ML researchers
- Real-time financial signal generation and execution
- Experimentation, stress testing, and open innovation

We embrace **stress-tested resilience**, inviting contributors to push the boundaries and make AFI stronger with every iteration.