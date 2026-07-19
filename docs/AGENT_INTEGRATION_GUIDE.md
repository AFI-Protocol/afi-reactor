# Integration Guide

## Overview

This guide explains the two ways other systems integrate with **afi-reactor**,
AFI Protocol's scored-signal evaluation runtime (District One):

1. **External clients** (gateways, agents, TradingView) call the reactor over
   **HTTP** and consume its scored output.
2. **Enrichment data sources** plug in behind the reactor's **provider-adapter
   framework** (`src/providers/`), selected through the governed afi-config
   registries.

> The old model — registering external "agents" as DAG nodes via
> `config/*.registry.json` and codex metadata — has been **removed**. Those
> registries, the DAG-node framing, and the `.afi-codex.json` files no longer
> exist. Do not reintroduce them.

---

## 1. External Clients (HTTP)

External systems are **clients**, not orchestrators. They submit a signal and
receive a scored-only result; they do not run inside the reactor and the reactor
never imports their code (no ElizaOS/SDK imports; the dependency direction is
one-way — clients depend on the reactor).

**Ingress endpoints** (see [`HTTP_WEBHOOK_SERVER.md`](HTTP_WEBHOOK_SERVER.md)):

- `GET  /health` — health / composition readiness.
- `POST /api/webhooks/tradingview` — the dev/demo signal webhook. In a governed
  topology the afi-gateway `POST /api/v1/signals` path is the structured-ingress
  front for it.
- `POST /api/ingest/cpj` — the internal CPJ (Community Provider Journal) adapter.
  This is an **internal trusted service boundary**, not a public API.

**Response**: a scored-only signal carrying `analystScore.uwrScore` and
`uwrAxes` (structure, execution, risk, insight). There is **no** validator
decision and **no** execution block — validator certification and trade
execution are downstream / external (mint orchestration lives in `afi-mint`).

---

## 2. Enrichment Providers (Provider-Adapter Framework)

Enrichment data sources integrate through the adapter registry in
`src/providers/`, which is the **sole enrichment execution seam**. The pipeline
has five vendor-neutral lanes — **technical, pattern, sentiment, news, aiMl** —
and each lane executes an explicit **ProviderInstance** resolved from the
governed afi-config registries
(`registries/{providers,provider-instances,provider-bindings,pipelines,analysis-plugins,analyst-strategies}`).

To add an enrichment source:

1. **Implement the adapter** under `src/providers/adapters/` following an
   existing adapter (e.g. `technicalLocalAdapter.ts`, `httpNewsAdapter.ts`).
2. **Register it once** via `builtinProviderAdapters()` in
   `src/providers/index.ts`.
3. **Handle secrets** only through the injected `SecretResolver` — never a key
   in a URL, never a secret in a registry or manifest.
4. **Validate output** against the governed category contract (the adapter's
   result must conform before it reaches the merge/scorer stage).
5. **Bind it to a lane** by adding a `ProviderInstance` to the governed
   registries and referencing it from the registered pipeline manifest.
6. **Test it** against fixed inputs and run the gates (`npm run build && npm test`).

---

## Boundary Rules

- The reactor is the **execution engine**, not a public trust gateway. Ingress
  posture and trust boundaries are defined in
  [`HTTP_WEBHOOK_SERVER.md`](HTTP_WEBHOOK_SERVER.md).
- Composition is **data** (governed registries + registered manifests), not
  code; there is no hardcoded pipeline.
- The reactor **stops at scored**. Evidence is written only by afi-infra.

---

**Maintained By**: AFI Protocol Core Team
