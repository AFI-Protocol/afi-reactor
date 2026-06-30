# AFI Signal Evaluation Pipehead System (non-production POC)

> **Status: non-production proof-of-concept (POC) / demo.** Nothing in this
> system is intended for production use, and no output here is canonical protocol
> truth. All
> scored output, receipts, and audit records are explicitly **demo-only /
> provisional**. This document describes the system that actually ships under
> `afi-reactor/src/pipeheads/**`, `src/cli/run-pipehead-demo.ts`, and
> `test/pipeheads/**` — not an aspirational design.

This system makes AFI's signal-evaluation DAG **Droid-operable** without making
Droids the source of financial truth. Droids operate the machinery (ingestion,
schema validation, a five-lane analysis fan-out, normalization, scoring
invocation, receipt, audit, tests, docs). The **deterministic kernel** — the
afi-core Froggy trend-pullback UWR scorer — remains the source of truth and is
**invoked, never replaced**.

It is governed by `AFI_DROID_CHARTER.v0.1.md` and the
`AFI_DROID_PIPEHEAD_ADDENDUM.v0.1.md`; where this document and governance
conflict, governance wins.

---

## What is a pipehead?

A **pipehead** is a small, typed, single-purpose unit of pipeline machinery. It
exposes one entry point — `execute(input, ctx)` — that returns a structured
`PipeheadExecutionResult` derived **purely** from its inputs and an injected
context. A pipehead performs no hidden side effects: no network, no database, no
filesystem reads beyond committed fixtures, and no wall-clock reads (every
timestamp comes from the injected `ctx.clock()`). Given the same `(input, ctx)`,
a pipehead always returns a deeply-equal result.

The mission-local contracts live in `src/pipeheads/types.ts`. The pipehead kinds
in this POC are:

| Kind | Pipehead(s) | Role |
| --- | --- | --- |
| `validation` | `schemaValidationPipehead` | Structural USS v1.1 check (see DR-001) |
| `analysis-lane` | five lane pipeheads | Per-lane analysis fan-out |
| `normalize` | `normalizePipehead` | Fan-in to an `AnalysisBundle` + `FroggyEnrichedView` |
| `scoring` | `scoringPipehead` | **Invokes** the afi-core deterministic scorer |
| `reputation` | `reputationReceiptPipehead` | Demo-only, non-mutating receipt |
| `audit` | `auditPipehead` | Content-hashed `AuditRecord` (sha256) |

The `harness.ts` module composes these in a fixed order:

```
validate → fan-out (5 lanes) → normalize → score → receipt → audit
```

and returns one aggregate `{ validation, bundle, scored, receipt, audit }` from a
single pass over a fixture. A schema-validation failure is surfaced as a
**structured value** (no uncaught throw) and **short-circuits** the pipeline, so
no bundle, scored output, receipt, or audit record is produced for invalid input.

---

## How Droids operate it (operate, do not adjudicate)

Droids **operate** the pipeline machinery; they do **not adjudicate** outcomes.
Concretely, Droids:

- move state between pipeheads (validate → fan-out → normalize → score → receipt
  → audit),
- run the five analysis lanes and fan them in to the analysis bundle,
- **invoke** the deterministic afi-core scorer and carry its output through
  verbatim,
- emit a content-hashed, replayable audit record,
- write the tests, fixtures, CLI demo, and this documentation.

Droids never substitute LLM/subjective judgment for a score, a validation
decision, or any trust-critical output. No pipehead re-implements, re-weights, or
"adjusts" scoring/UWR/reputation math. The score is produced solely by the
deterministic kernel described next; the pipeheads only transport and bind it.

---

## Where the deterministic AFI logic is the source of truth

The **source of truth** is the deterministic afi-core kernel, invoked unchanged:

- **Scorer:** `scoreFroggyTrendPullbackFromEnriched(enriched)` from
  `afi-core/analysts/froggy.trend_pullback_v1.js`
  (`analystId = "froggy"`, `strategyId = "trend_pullback_v1"`).
- **Universal Weighting Rule (UWR):** `defaultUwrConfig` is used **unchanged**
  (four equal axis weights of `0.25`), so `uwrScore` equals the equal-weight mean
  of the four `uwrAxes` (`structure`, `execution`, `risk`, `insight`).

The scoring pipehead (`src/pipeheads/scoringPipehead.ts`) **only invokes** this
scorer and carries the afi-core `AnalystScoreTemplate` through verbatim under
`analystScore`, surfacing `uwrScore`/`uwrAxes` at the top level for convenience.
It never recomputes or re-weights anything. The mission introduces **no** changes
to `afi-core`, `afi-math`, or `afi-config`; the scorer and UWR config are
referenced read-only via the `afi-core/...` package name.

Determinism is mandatory: identical input ⇒ identical output ⇒ identical content
hash. Runtime timestamps (`scoredAt`, `issuedAt`, `startedAt`, `finishedAt`) come
from an injectable clock and are **excluded from every content hash**.

---

## What is demo-only / provisional

Every protocol-shaped output is explicitly labeled and is **not** canonical
protocol truth:

- `DemoScoredSignal` carries `demoOnly: true` and `provisional: true`.
- `DemoReputationReceipt` carries `receiptKind: "demo-only"` and
  `mutatesReputationState: false` (it reads/writes no reputation state, DB, or
  vault), plus a non-canonical `note`.
- `AuditRecord` carries `demoOnly: true` and `scoredAtExcluded: true`.

### The five lanes: two wired, three provisional

The analysis stage always exposes exactly **five lanes** in a stable order. It
never collapses into a single linear scoring step.

**Wired lanes** (real deterministic math over committed fixture OHLCV,
`provisional: false`):

- `technical-indicators` — EMA-20/50, RSI-14, ATR-14 + `trendBias` /
  `emaDistancePct` (see DR-002 below for how these are computed offline).
- `pattern-recognition` — deterministic pattern detection reusing
  `src/enrichment/patternRecognition.ts#detectPatterns` (pure, offline).

**Provisional lanes** (committed, clearly-labeled fixtures — no network, no
external adapter, no Tiny Brains, `provisional: true`):

- `news` — committed news fixture; self-labeled provisional.
- `social` — committed sentiment fixture (maps to `enrichedView.sentiment`);
  self-labeled provisional.
- `ai-ml` — committed AI/ML fixture; self-labeled provisional.

Each provisional lane self-identifies as provisional in its own payload (an
in-payload `provisional: true` flag plus a human-readable note), independent of
the bundle-level `provisionalLanes: ["news", "social", "ai-ml"]` list. Missing or
fixture intelligence is never hidden behind a vague explanation.

The CLI demo (`node --loader ts-node/esm src/cli/run-pipehead-demo.ts`) makes
this visible: it prints a five-lane summary labeling each lane `[WIRED]` or
`[PROVISIONAL]`, followed by four independently-parseable JSON blocks
(`AnalysisBundle`, `DemoScoredSignal`, `DemoReputationReceipt`, `AuditRecord`).
Running it twice yields an identical `outputHash`.

---

## Known limitations of this offline POC

This POC runs **fully offline** against committed fixtures. Two trust-relevant
afi-reactor modules could not be reused offline, so self-contained equivalents
were used **behind clean seams** so a future mission can swap in the canonical
implementations. These are recorded as Decision Records DR-001 and DR-002 in the
mission's `AGENTS.md`.

### DR-001 — Schema validation uses a self-contained OFFLINE structural validator (NOT canonical USS validation)

- **Limitation.** The canonical USS validator, `src/uss/ussValidator.ts`
  (`validateUsignalV11`), could **not** be reused offline. Its module-level
  `import { Ajv } from "ajv"` throws because `ajv` / `ajv-formats` are not
  installed/resolvable (absent from `package.json` and the lockfile, and not
  installable offline), and the afi-config schemas are absent from
  `node_modules`.
- **POC decision.** This POC therefore uses a **self-contained STRUCTURAL
  validator only** (`src/pipeheads/schemaValidationPipehead.ts`). It enforces the
  same minimum USS v1.1 rules (top-level `schema` and `provenance`;
  `schema === "afi.usignal.v1.1"`; `provenance.source` / `providerId` /
  `signalId` present and string-typed) and returns the same
  `{ ok, errors: [{ field, message }] }` contract. It self-labels as structural /
  POC / demo-only / non-canonical. It is **NOT** a replacement for canonical USS
  validation.
- **Future work.** Restore canonical USS validation by resolving the
  `ajv` / `ajv-formats` and afi-config schema dependency path, then swap
  `validateUssV11Structural` for canonical `validateUsignalV11` at the existing
  clean seam — no caller change required.

### DR-002 — WIRED technical lane uses a self-contained OFFLINE EMA/RSI/ATR helper (NOT the canonical indicator kernel)

- **Limitation.** The canonical technical-indicator kernel
  (`src/enrichment/technicalIndicators.ts` → `src/indicator/*`) could **not** be
  reused offline. That import chain hard-imports `trading-signals`
  (`import { EMA, RSI, ATR } from "trading-signals"`), which is not installed, not
  cached, not installable offline, and absent from `package.json` / the lockfile.
  (It is a runtime-only break: those files are `@ts-nocheck`, so a scoped
  typecheck does not catch it.)
- **POC decision.** The WIRED `technical-indicators` lane therefore computes its
  indicators with a **self-contained OFFLINE EMA/RSI/ATR helper**
  (`src/pipeheads/lanes/technicalIndicators.ts`), mirroring the repo's own
  deprecated pure EMA/RSI/ATR formulas, over committed fixture OHLCV. The lane
  stays genuinely **wired** (`provisional: false`, real deterministic math) and
  its result self-labels its indicators as a self-contained / non-canonical
  offline computation that is **NOT** the canonical AFI indicator kernel. Crucially,
  **scoring itself remains 100% afi-core** — only the lane's indicator inputs are
  computed by the offline helper; the deterministic scorer and UWR are reused
  offline, unchanged.
- **Future work.** Restore the canonical indicator kernel by resolving the
  `trading-signals` dependency, then swap the offline helper for
  `computeTechnicalEnrichment` / `src/indicator/*` at the existing clean seam — no
  lane-contract change required.

---

## Future missions / next steps

This POC is a starting point. Concrete follow-on work for future missions:

1. **Restore canonical USS validation (DR-001).** Resolve the
   `ajv` / `ajv-formats` and afi-config schema dependency path and swap the
   structural validator for canonical `validateUsignalV11` at the clean seam.
2. **Restore the canonical indicator kernel (DR-002).** Resolve the
   `trading-signals` dependency and swap the offline EMA/RSI/ATR helper for the
   canonical `computeTechnicalEnrichment` / `src/indicator/*` kernel at the clean
   seam (scoring already stays in afi-core).
3. **Wire the three provisional lanes.** Replace the committed `news`, `social`,
   and `ai-ml` fixtures with real, governed data sources behind the existing lane
   seams (still respecting governance boundaries).
4. **Provenance and persistence.** Extend the provenance binding and consider a
   governed, auditable persistence path for audit records (out of scope here,
   which avoids all DB/vault writes).
5. **Monitoring / replay tooling.** Build operator tooling around the
   content-hashed, replayable audit records for drift detection.

These are explicitly future work. Token/mint/treasury/vault/settlement logic,
emissions math, reward distribution, live trading, production deploys/keys, and
any change to core scoring/UWR/reputation math (or mutation of reputation state)
remain **out of scope** and are governed by the Charter and Pipehead Addendum.

---

## Summary

This is a non-production POC that demonstrates a Droid-operated, five-lane,
deterministic, replayable signal-evaluation pipeline. Droids operate the
machinery; the afi-core scorer + UWR (`defaultUwrConfig`, unchanged) is the
deterministic source of truth; all scored output, receipts, and audit records are
demo-only/provisional; and the `news`, `social`, and `ai-ml` lanes are
provisional fixtures. Schema validation (DR-001) and the technical lane's
indicators (DR-002) use self-contained offline equivalents behind clean seams,
with canonical restoration deferred to future missions. No part of this system is
presented as canonical protocol truth.
