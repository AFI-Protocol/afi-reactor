# afi-reactor — Agent Instructions

**afi-reactor** is the canonical DAG orchestrator for AFI Protocol. It implements the 15-node signal processing pipeline following the AFI Orchestrator Doctrine. This is the **ONLY orchestrator** in the AFI ecosystem—agents are nodes, not orchestrators.

**Naming Note**: This repo was renamed from `afi-engine` to `afi-reactor` (2025-11-14). Do not use "afi-engine" naming anywhere.

**Global Authority**: All agents operating in AFI Protocol repos must follow `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md`. If this AGENTS.md conflicts with the Charter, **the Charter wins**.

For global droid behavior and terminology, see:
- `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md`
- `afi-config/codex/governance/droids/AFI_DROID_PLAYBOOK.v0.1.md`
- `afi-config/codex/governance/droids/AFI_DROID_GLOSSARY.md`

**⚠️ CRITICAL**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` (10 Commandments) before touching DAG logic.

---

## Build & Test

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (Jest)
npm test

# Check ESM invariants (lint for cross-repo imports, missing .js extensions, etc.)
npm run esm:check

# Validate all DAG configs and Codex metadata
npm run validate-all

# Simulate signal processing
npm run simulate-signal

# Replay from vault
npm run replay-vault
```

**Expected outcomes**: All tests pass, DAG configs validate, signal simulation succeeds.

---

## Run Locally / Dev Workflow

```bash
# Simulate a signal through the DAG
npm run simulate-signal

# Simulate from vault
npm run simulate-from-vault

# Replay vault for determinism testing
npm run replay-vault

# Lint Codex metadata
npm run codex-lint

# Run mentor evaluations
npm run mentor-eval
```

---

## Architecture Overview

**Purpose**: Orchestrate signal pipelines via DAG. **Not** for business logic, token economics, or agent personas.

**Key directories**:
- `src/cli/` — CLI entrypoints (run-dag.ts, replay-signals.ts)
- `src/dags/` — 15-node DAG implementations
- `codex/` — Codex configuration and replay logic
- `config/` — DAG configuration files
- `plugins/` — Plugin implementations
- `test/` — Jest tests

**Depends on**: afi-core (runtime, validators)
**Consumed by**: afi-ops (deployment), afi-infra (templates), Eliza gateways (via HTTP/WS APIs)

**Boundary with afi-core**:
- `afi-reactor` = orchestration (DAG wiring, pipeline execution)
- `afi-core` = runtime behavior (validators, scoring)

**Eliza integration**:
- `afi-reactor` exposes HTTP/WS APIs for signal scoring, replay, and DAG introspection.
- Eliza-based gateways and plugins may call these APIs as external clients.
- `afi-reactor` MUST NOT import ElizaOS code, SDKs, or character definitions.
- **Dependency direction**: Eliza gateways depend on afi-reactor; afi-reactor never depends on Eliza.

---

## Security

- **DAG changes affect all signals**: Incorrect orchestration can corrupt signal processing.
- **Codex replay must be deterministic**: Changes that break replay break auditability.
- **No secrets in DAG configs**: Use environment variables.
- **Plugin validation**: Plugins must follow plugin contract and security review.

---

## Git Workflows

- **Base branch**: `main` or `migration/multi-repo-reorg`
- **Branch naming**: `feat/`, `fix/`, `refactor/`
- **Commit messages**: Conventional commits (e.g., `feat(dag): add sentiment analysis node`)
- **Before committing**: Run `npm test && npm run validate-all`

---

## Conventions & Patterns

- **Language**: TypeScript (ESM)
- **DAG nodes**: Stateless, composable, follow Doctrine
- **Naming**: No "afi-engine" references; use "afi-reactor"
- **Tests**: Jest, located in `test/`
- **Codex**: All DAG runs must be Codex-replayable

---

## ESM Invariants

**afi-reactor is pure ESM** and depends on **afi-core** as an ESM package. All code must follow strict ESM conventions to ensure runtime compatibility.

**Required practices**:
- All imports from **afi-core** must use the package name, never relative paths across repos:
  ```typescript
  // ✅ CORRECT
  import { scoreFroggyTrendPullbackFromEnriched } from "afi-core/analysts/froggy.trend_pullback_v1.js";
  import type { ValidatorDecisionBase } from "afi-core/validators/ValidatorDecision.js";

  // ❌ WRONG - Never use cross-repo relative paths
  import { scoreFroggyTrendPullbackFromEnriched } from "../../afi-core/analysts/froggy.trend_pullback_v1.js";
  import type { ValidatorDecisionBase } from "../../afi-core/validators/ValidatorDecision.js";
  ```
- All relative imports within afi-reactor (e.g., from `src/` to `plugins/`) **must** include `.js` extensions:
  ```typescript
  // ✅ CORRECT
  import froggyAnalyst from "../../plugins/froggy.trend_pullback_v1.plugin.js";

  // ❌ WRONG
  import froggyAnalyst from "../../plugins/froggy.trend_pullback_v1.plugin";
  ```
- External package imports (e.g., `from "express"`) do **not** need `.js` extensions.
- No imports may reference `.ts` files at runtime.
- New plugins and services must follow the same ESM pattern—no CommonJS.

**Why these rules matter**:
- afi-reactor uses plain `tsc` compilation (no bundler).
- Node.js ESM requires explicit file extensions for relative imports.
- Cross-repo relative paths break at runtime because `afi-core` is a separate npm package.
- afi-core is linked via npm (`node_modules/afi-core -> ../../afi-core`), so imports must use the package name.

**Validation**:
- Run `npm run build` to verify TypeScript compiles without errors.
- Run `npm run start:demo` to ensure the server starts without ESM module resolution errors.
- Test endpoints (e.g., `/demo/prize-froggy`) to verify runtime imports work correctly.

**For new contributors**: When adding new plugins or services, always use `afi-core/...` for cross-repo imports and include `.js` extensions for relative paths. This is non-negotiable for ESM compatibility.

---

## Scope & Boundaries for Agents

**Allowed**:
- Add new DAG nodes to `src/dags/` (following Doctrine)
- Improve orchestration logic in `src/cli/`
- Add tests, update Codex configs, add plugins
- Update `.afi-codex.json` if capabilities change

**Forbidden**:
- Violate AFI Orchestrator Doctrine (10 Commandments)
- Make agents into orchestrators (agents are nodes only)
- Change 15-node DAG structure without explicit approval
- Modify Codex replay logic without understanding impact
- Add orchestration logic to other repos (afi-reactor is ONLY orchestrator)
- Use "afi-engine" naming anywhere

**When unsure**: Read `AFI_ORCHESTRATOR_DOCTRINE.md` first. Ask for explicit spec on DAG changes. Prefer no-op over breaking orchestration.

---

**Last Updated**: 2025-11-26 | **Maintainers**: AFI Reactor Team | **Charter**: `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md` | **Doctrine**: `AFI_ORCHESTRATOR_DOCTRINE.md`
