# AFI Reactor - Droid Repo Orientation

**Quick Start**: You're in `afi-reactor`, AFI Protocol's **scored-signal
evaluation runtime (District One)**.

---

## What This Repo Does

Runs **one** manifest-driven GraphExecutor over a registered pipeline
(`froggy-trend-pullback` v1.1.0): HTTP ingress → AJV validation → five
provider-backed enrichment lanes (technical, pattern, sentiment, news, aiMl) →
join → Froggy analyst UWR score → District Two evidence/provenance. Composition
is **data** (governed registries), not hardcoded pipeline code. The reactor
**stops at scored**.

**Key Capabilities**:
- Manifest-driven graph execution (one GraphExecutor)
- Provider-backed enrichment via the `src/providers/` adapter registry
- UWR scoring via the Froggy analyst (afi-core)
- Canonical evidence construction (District-2 provenance law)

---

## Repo Boundaries

**This repo handles**:
- ✅ Signal ingress + validation (USS / CPJ)
- ✅ Manifest-driven graph execution
- ✅ Provider-backed enrichment lanes
- ✅ UWR scoring + District-2 evidence construction

**This repo does NOT handle** (stops at scored):
- ❌ Scoring/UWR math (that's afi-core)
- ❌ Validator certification and trade execution (downstream / external)
- ❌ Evidence persistence — afi-infra is the sole writer
- ❌ Mint orchestration (that's afi-mint)
- ❌ Deployment (that's afi-infra)

---

## Key Files to Know

```
src/server.ts             # boot + the HTTP ingresses (/health, /api/webhooks/tradingview, /api/ingest/cpj)
src/pipeline/             # GraphExecutor (executor.ts), registryLoader, pluginRegistry, nodes/
src/providers/            # provider-adapter framework (adapterRegistry.ts + adapters/) — sole enrichment seam
src/config/               # runtimeComposition (the ONE executor), strategyResolution, UWR pins
src/evidence/             # evidence record + District-2 provenance law
src/uss/  src/cpj/        # AJV validators for the two ingresses
```

---

## Quick Commands

```bash
npm install            # deps (siblings afi-core/afi-math/afi-config via file:../)
npm run build          # tsc → dist
npm test               # jest: unit + guardrails + oracle goldens
npm run start:demo     # node dist/src/server.js (port 8080)
```

---

## Common Droid Tasks

See `10_common_tasks.md` for detailed workflows.

**Most frequent**:
1. Add a new pipeline node (`src/pipeline/nodes/`)
2. Add a provider adapter (`src/providers/adapters/`)
3. Change a pipeline composition (edit the registered manifest — it's data)
4. Add tests

---

## Safety Notes

**Before making changes**:
1. Read `AGENTS.md` for the current architecture and constraints.
2. Follow `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md` (the Charter wins on any conflict).
3. Run tests locally.

**Red flags** (ask a human):
- Changing the registered composition model / manifests
- Touching scoring, UWR, decay, or the evidence boundary
- Regenerating oracle goldens to force a pass (byte drift = behavior changed)

---

## Getting Help

- **AGENTS.md**: canonical constraints + current architecture
- **README.md**: high-level overview
- **docs/**: HTTP API, branch doctrine, provenance/hashing specs
- **Human maintainers**: tag @afi-reactor-team in PR

---

**Last Updated**: 2026-07-18
