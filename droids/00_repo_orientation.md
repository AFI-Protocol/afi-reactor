# AFI Reactor - Droid Repo Orientation

**Quick Start**: You're in `afi-reactor`, the canonical DAG orchestrator for AFI Protocol.

---

## What This Repo Does

DAG orchestrator implementing the 15-node signal processing pipeline. This is the ONLY orchestrator in AFI—agents are nodes, not orchestrators.

**Key Capabilities**:
- DAG orchestration (15-node pipeline)
- Signal pipeline management
- Codex replay
- Validator coordination
- Mentor coordination

---

## Repo Boundaries

**This repo handles**:
- ✅ DAG orchestration logic
- ✅ Signal pipeline
- ✅ Node coordination
- ✅ Codex replay

**This repo does NOT handle**:
- ❌ Signal validation (that's afi-core)
- ❌ Agent personas (that's afi-core)
- ❌ Deployment (that's afi-ops)
- ❌ Smart contracts (that's afi-token)

---

## Critical Document

**⚠️ READ BEFORE MAKING CHANGES**: `AFI_ORCHESTRATOR_DOCTRINE.md` in repo root

This document contains the 10 Commandments of AFI orchestration. Violating these breaks the entire system.

---

## Key Files to Know

```
src/cli/
  run-dag.ts              # DAG execution entrypoint
  replay-signals.ts       # Codex replay
  
src/dags/
  [DAG node implementations]
  
codex/
  [Codex configuration]
  
config/
  [DAG configuration files]
  
plugins/
  [Plugin implementations]
```

---

## Quick Commands

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run DAG (dev)
npm run dag:dev
```

---

## Common Droid Tasks

See `10_common_tasks.md` for detailed workflows.

**Most frequent**:
1. Add a new DAG node
2. Update DAG configuration
3. Add plugin
4. Add tests

---

## Safety Notes

**Before making changes**:
1. Read `AFI_ORCHESTRATOR_DOCTRINE.md`
2. Read `AGENTS.md` for constraints
3. Check `.afi-codex.json` for dependencies
4. Run tests locally

**Red flags** (ask a human):
- Changing DAG structure
- Making agents into orchestrators
- Breaking Codex replay
- Modifying orchestration logic

---

## Getting Help

- **AFI_ORCHESTRATOR_DOCTRINE.md**: Orchestration rules
- **AGENTS.md**: Canonical constraints
- **README.md**: High-level overview
- **docs/**: Architecture documentation
- **Human maintainers**: Tag @afi-reactor-team in PR

---

**Last Updated**: 2025-11-22

