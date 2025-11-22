# AGENTS.md — AFI Reactor Droid Instructions (v1)

This file is the canonical instruction set for Factory.ai droids and other agents working in this repository.
If AGENTS.md conflicts with README or docs, **AGENTS.md wins.**

---

## 0. Repo Purpose

**What this repo is for:**
Canonical DAG orchestrator for AFI Protocol. Implements the 15-node signal processing pipeline following the AFI Orchestrator Doctrine. This is the ONLY orchestrator in the AFI ecosystem—agents are nodes, not orchestrators.

> **Note**: This repository was renamed from `afi-engine` to `afi-reactor` on 2025-11-14 to establish clear orchestration boundaries. If you see references to "afi-engine" in older docs, they refer to this repo.

**What this repo is NOT for:**
- Agent persona logic (use afi-core)
- Smart contracts (use afi-token)
- Infrastructure deployment (use afi-ops)
- Making agents into orchestrators (violates Doctrine)

---

## 1. Prime Directives (Global AFI Rules)

- **Scaffold, wire, and align context only.** Do not expand full feature logic unless explicitly instructed.
- **Keep changes minimal and deterministic.**
- **Preserve modular boundaries.** No cross-repo code moves unless asked.
- **Codex + AOS are truth sources.** Whitepaper is narrative, not canonical.
- **Never delete or overwrite without a replacement plan.**
- **Prefer small patches over large refactors.**
- **READ AFI_ORCHESTRATOR_DOCTRINE.md BEFORE TOUCHING DAG LOGIC.**

---

## 2. Allowed Tasks

Droids MAY:
- Add new DAG nodes to `src/dags/` (following Doctrine)
- Improve orchestration logic in `src/cli/`
- Add tests in `test/`
- Update Codex configs in `codex/`
- Add plugins to `plugins/` (following plugin contract)
- Improve documentation in `docs/`
- Add type definitions in `types/`
- Update `.afi-codex.json` if capabilities change

---

## 3. Forbidden Tasks

Droids MUST NOT:
- Violate the AFI Orchestrator Doctrine (10 Commandments)
- Make agents into orchestrators (agents are nodes only)
- Change the 15-node DAG structure without understanding downstream impact
- Modify Codex replay logic without approval
- Rename core orchestration concepts
- Add orchestration logic to other repos (afi-reactor is the ONLY orchestrator)
- Break backward compatibility with existing DAG configs

---

## 4. Key Invariants

These must remain true after changes:
- afi-reactor is the ONLY orchestrator (Doctrine Commandment #1)
- 15-node DAG structure preserved (or explicitly extended with approval)
- Codex replay compatibility maintained
- Signal pipeline determinism preserved
- Plugin interface stability
- All DAG nodes are stateless and composable

---

## 5. Repo Layout Map

- `src/cli/` — CLI entrypoints (run-dag.ts, replay-signals.ts)
- `src/dags/` — DAG node implementations
- `codex/` — Codex configuration and replay logic
- `config/` — DAG configuration files
- `plugins/` — Plugin implementations
- `test/` — Unit and integration tests
- `docs/` — Architecture docs, DAG diagrams
- `types/` — TypeScript type definitions
- `.afi-codex.json` — Repo metadata

---

## 6. Codex / AOS Touchpoints

- `.afi-codex.json` location: Root of repo
- AOS streams / registries referenced:
  - `dag-orchestration` stream
  - `signal-pipeline` stream
  - `codex-replay` stream
  - `validator-coordination` stream
  - `mentor-coordination` stream
- Schema contracts this repo must obey:
  - Signal schema from afi-core
  - Plugin interface contract
  - DAG node interface

**CRITICAL**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` in repo root before making changes.

---

## 7. Safe Patch Patterns

When editing, prefer:
- Small diffs, one intent per commit/patch
- Additive changes over rewrites
- Clear comments stating why a stub exists
- DAG node additions follow existing patterns
- Test new nodes in isolation before integration

Example safe patch:
```typescript
// TODO(droid): Add DAG node for sentiment aggregation
// Expected behavior: Aggregate sentiment scores from multiple sources
// Test case: test/sentiment_aggregation.test.ts
// Follows Doctrine: Node is stateless, composable, single responsibility
export class SentimentAggregationNode implements DAGNode {
  async execute(input: Signal): Promise<Signal> {
    // Stub: Pass-through for now
    return input;
  }
}
```

---

## 8. How to Validate Locally

Run these before finalizing:
```bash
npm install
npm run build
npm test
npm run lint  # if available
```

Expected outcomes:
- Tests pass (Jest/Vitest)
- TypeScript compiles without errors
- DAG config validates
- No linter errors

---

## 9. CI / PR Expectations

- CI must stay green
- Any new DAG node must include unit tests
- Any DAG structure change must include updated diagram in docs/
- PR must reference AFI Orchestrator Doctrine if touching orchestration logic
- Documentation updates should reduce ambiguity for agents

---

## 10. Current Priorities

1. Stabilize 15-node DAG for production
2. Add comprehensive tests for each DAG node
3. Document plugin interface contract
4. Improve Codex replay performance
5. Add DAG visualization tooling

---

## 11. If You're Unsure

Default to:
1. Do nothing risky
2. Read AFI_ORCHESTRATOR_DOCTRINE.md
3. Add a stub + TODO comment
4. Document the uncertainty
5. Ask a human maintainer (tag @afi-reactor-team in PR)

---

**Last Updated**: 2025-11-22  
**Maintainers**: AFI Reactor Team  
**Version**: 1.0.0

