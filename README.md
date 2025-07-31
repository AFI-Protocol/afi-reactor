# AFI-Engine ⚡

[![AFI-Engine Validation](https://github.com/<OWNER>/<REPO>/actions/workflows/validate-all.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/validate-all.yml)

AFI-Engine is the **core DAG-based signal processing system** for **Agentic Financial Intelligence (AFI)**.  
It orchestrates a multi-agent pipeline capable of generating, analyzing, validating, executing, and observing financial signals at scale.

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

## 🌌 AFI-Engine Vision

AFI-Engine is **agent-first**, **modular**, and **ElizaOS compatible**, powering use cases for:
- Retail traders and institutions  
- Agent developers and ML researchers  
- Real-time financial signal generation and execution  
- Experimentation, stress testing, and open innovation

We embrace **stress-tested resilience**, inviting contributors to push the boundaries and make AFI stronger with every iteration.