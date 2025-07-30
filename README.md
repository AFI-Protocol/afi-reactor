# AFI-Engine ⚡

[![AFI-Engine Validation](https://github.com/AFI-Protocol/afi-engine/actions/workflows/validate-all.yml/badge.svg)](https://github.com/AFI-Protocol/afi-engine/actions/workflows/validate-all.yml)

**Agent Readiness ✅**

AFI-Engine is the core DAG-based signal processing system for Agentic Financial Intelligence (AFI).  
It provides:

- **Signal scoring** via PoI/PoInsight ensemble validation  
- **DAO checkpointing** with Factory Droids  
- **T.S.S.D. Vault persistence** managed by Scarlet  

## Quick Start

Run the full validation pipeline:

```bash
npm run validate-all
```

## CI Artifacts

- [Codex Replay Log](codex/codex.replay.log.json) - Codex health and node validation results
- [DAG Simulation Telemetry](tmp/dag-simulation.log.json) - DAG execution simulation telemetry  
- [Mentor Evaluation](tmp/mentor-evaluation.json) - MentorChain agent readiness scores

## Architecture

AFI-Engine processes signals through a 3-stage DAG:

1. **afi-ensemble-score** (AugmentCode) → Ensemble scoring with PoI/PoInsight balancing
2. **dao-mint-checkpoint** (Factory Droids) → DAO consensus and checkpoint validation
3. **tssd-vault-persist** (Scarlet) → T.S.S.D. Vault persistence and archival

Each stage maintains strong type contracts via JSON schemas and produces structured telemetry for downstream agent evaluation.

## Development

The validation pipeline includes:
- **Codex Replay** - Validates DAG integrity, agent assignments, and schema links
- **DAG Simulation** - Tests signal flow through all processing stages  
- **MentorChain Evaluation** - Assesses agent readiness and system health

All validation steps must pass for CI to succeed. Artifacts are retained for 30 days for debugging and analysis.

