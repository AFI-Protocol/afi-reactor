# AFI-Reactor ⚡

**AFI-Reactor is AFI Protocol's scored-signal evaluation runtime (District One).**

It ingests signals, runs a single manifest-driven graph executor over five
vendor-neutral, provider-backed enrichment lanes, produces a UWR score via the
Froggy analyst, and hands the scored signal to District Two evidence/provenance.
**The reactor stops at scored** — validator certification and trade execution are
downstream / external concerns.

## 🤖 Droid Instructions

**For AI agents and automated contributors**: see [AGENTS.md](./AGENTS.md) for
canonical repo constraints, the current architecture, build/test commands, and
safe patch patterns.

> If AGENTS.md conflicts with this README, **AGENTS.md wins**. If AGENTS.md
> conflicts with `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md`,
> **the Charter wins**.

## 🔒 Security

This repository uses environment variables for sensitive configuration, and
secrets reach adapters only through the injected `SecretResolver` (never a key
in a URL).

```bash
cp .env.example .env
# Edit .env with your credentials (NEVER commit this file)
```

## 🏗️ How It Works

1. **HTTP ingress** — Universal Signal Schema v1.1 via the Gateway signals path
   (reactor `POST /api/webhooks/tradingview`), plus the internal CPJ adapter
   (`POST /api/ingest/cpj`).
2. **AJV validation** — USS (`src/uss`) and CPJ (`src/cpj`).
3. **One GraphExecutor** — `src/pipeline/executor.ts`, constructed once in
   `src/config/runtimeComposition.ts`, running the registered graph
   **`froggy-trend-pullback` v1.1.0**. Composition is data (boot-validated
   governed registries), not hardcoded pipeline code.
4. **Five enrichment lanes** — technical, pattern, sentiment, news, aiMl. Each
   lane selects an explicit **ProviderInstance** from the governed afi-config
   registries; the adapter registry in `src/providers/` is the sole enrichment
   execution seam.
5. **Join → Froggy analyst → UWR score** — scores `trend_pullback_v1` from
   afi-core (UWR axes: structure, execution, risk, insight).
6. **District Two evidence** — the governed `afi.scored-signal-evidence.v3`
   record is persisted through **afi-infra** (the sole evidence writer) into
   MongoDB collection `scored_signal_evidence`.

Scoring, UWR, decay, and evidence are byte-stable (oracle goldens).

## ⚡ Quick Start

```bash
npm install
npm run build        # tsc → dist
npm test             # jest: unit + guardrails + oracle goldens
npm run start:demo   # node dist/src/server.js (port 8080)
```

Smoke-test the server:

```bash
curl -s localhost:8080/health
curl -s -X POST localhost:8080/api/webhooks/tradingview -H 'Content-Type: application/json' \
  -d '{"symbol":"BTC/USDT","timeframe":"1h","strategy":"trend_pullback_v1","direction":"long"}'
```

See [docs/HTTP_WEBHOOK_SERVER.md](docs/HTTP_WEBHOOK_SERVER.md) for the full HTTP
API.

## 🔏 District 2 Evidence & Provenance (live law)

The District-2 provenance law — CanonicalHash v1 (`afi.hash.v1`, sha256-only,
domain-tagged preimages, volatile-timestamp exclusion, decimal hash projection),
the ScoredSignal v1 projection builder, and the D2 schema validators — lives
under [`src/evidence/provenance/`](src/evidence/provenance) and is a REQUIRED
step of every live scoring run (`src/evidence/` builds and validates the governed
`afi.scored-signal-evidence.v3` record before submission to the afi-infra store).
Canonical status belongs only to the merged afi-config schemas, validation rules,
and hash doctrine — never to a specific pipeline topology or strategy.

The historical District-1 pipehead POC (a fenced, offline five-lane reference
path) was retired under DSC-GOV
(`afi-governance/decisions/district-surface-consolidation-v0.1.md`); its useful
invariants were transferred to the live runtime and `test/evidence/provenance/`,
and git history preserves the former implementation. Pipehead-style stage
discipline survives as an architectural principle implemented by the current
pipeline (one lane → one validated category result → merge → one scorer seam →
the D2 evidence boundary).

## 🧭 Repo Boundaries

- **afi-reactor** — scored-signal evaluation runtime (this repo). Stops at scored.
- **afi-core** — scoring / UWR math (runtime library).
- **afi-config** — governed registries and canonical USS schema.
- **afi-infra** — canonical evidence store (sole writer).
- **afi-mint** — downstream mint orchestration (not a reactor responsibility).
