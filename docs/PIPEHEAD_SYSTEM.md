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
| `validation` | `schemaValidationPipehead` | Canonical USS v1.1 validation (DR-001 resolved) |
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
  `emaDistancePct`, computed by the **canonical AFI indicator kernel**
  (`computeTechnicalEnrichment` → `src/indicator/*` → `trading-signals` v7;
  DR-002 resolved).
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

## Decision Records DR-001 / DR-002 — both RESOLVED

The original offline mission could not reuse two trust-relevant afi-reactor
modules, so self-contained equivalents were used **behind clean seams** with
canonical restoration recorded as Decision Records DR-001 and DR-002.
**District One Hardening (Mission 1.5-B) has since resolved both** at exactly
those seams. The system remains a **non-production POC**; the five-lane
architecture is unchanged.

### DR-001 — RESOLVED: schema validation is canonical `validateUsignalV11`

- **Original limitation.** The canonical USS validator
  (`src/uss/ussValidator.ts#validateUsignalV11`) was unusable offline: its
  module-level `import { Ajv } from "ajv"` threw because `ajv` / `ajv-formats`
  were not installed, and the afi-config schemas were absent from
  `node_modules`. A self-contained STRUCTURAL validator stood in behind a clean
  seam.
- **Resolution.** `ajv@^8.17.1`, `ajv-formats@^3.0.1`, and `afi-config`
  (`file:../afi-config`) are now installed, and
  `src/pipeheads/schemaValidationPipehead.ts` delegates to **canonical
  `validateUsignalV11`** (ajv compiled over the canonical afi-config
  `usignal/v1_1` core+index schemas) at the reserved seam — no caller changed.
  The public contract is preserved: `{ ok, errors: [{ field, message }] }` with
  `errors` always an array; required-property ajv errors map `field` to the
  missing key (e.g. `provenance.signalId`). Canonical-only constraints (e.g.
  `format: date-time` on `provenance.ingestedAt`, `providerType` /
  `facts.direction` enums) are now enforced; tests prove payloads the old
  structural validator accepted are rejected canonically.

### DR-002 — RESOLVED: the technical lane uses the canonical indicator kernel

- **Original limitation.** The canonical indicator chain
  (`src/enrichment/technicalIndicators.ts` → `src/indicator/*`) hard-imports
  `trading-signals`, which was uninstallable offline. A self-contained offline
  EMA/RSI/ATR helper stood in as the lane's engine behind the injectable
  engine seam.
- **Resolution.** `trading-signals@^7.4.3` is now installed, and the WIRED
  `technical-indicators` lane defaults to `canonicalIndicatorEngine`
  (`src/pipeheads/lanes/technicalLane.ts`), which wraps **canonical
  `computeTechnicalEnrichment`** (→ `froggyProfile` → `indicatorKernel` →
  `trading-signals` v7) through the existing `runTechnicalLane(candles, engine)`
  seam. The lane contract, payload field names/types, and >=50-candle semantics
  are unchanged; the payload now self-labels honestly
  (`canonicalIndicatorKernel: true`,
  `indicatorSource: "canonical-kernel-trading-signals"`). The offline helper
  (`src/pipeheads/lanes/technicalIndicators.ts`) is retained only as a
  non-default injectable engine proving the seam still works. **Scoring remains
  100% afi-core**, unchanged.

### Why `bundleHash` was re-pinned for DR-002 (and nothing else changed)

The canonical kernel computes a **streaming EMA** (seeded per
`trading-signals`) and **Wilder-smoothed RSI-14/ATR-14**, which differ
numerically from the offline helper's batch-seeded EMA, simple-averaged RSI,
and SMA ATR. The technical lane's payload numbers therefore changed (canonical
fixture values: `ema20 ≈ 157.8544`, `ema50 ≈ 143.9512`, `rsi14 ≈ 74.6908`,
`atr14 ≈ 3.4792`, `emaDistancePct ≈ 4.3113`, `trendBias: bullish`), which
changes the canonical hash of the normalized `AnalysisBundle` — so the
committed golden **`bundleHash` was re-pinned** (DR-002 only):

- `bundleHash` (old): `c75a1860df037619f257af024f8b0a3fc3ef057950bf9e36477c3c6a1d1add31`
- `bundleHash` (new): `6e2c91560da14bfca98bb49d83581db9519bd15962b80cf7142b65d1255da948`

**Unchanged invariants:** `inputHash`
(`92258c5bea8c613238c1f2f7f746c99084251510195682cbaf4cf39884e2422d`) hashes the
raw USS fixture, which did not change; `outputHash`
(`4b6dd610cba2b64831b0aa2a9e27707908affdf8134ca77d1083535de78ad8dc`) hashes the
deterministic scoring projection, and the afi-core scorer produces the **same
score over the canonical indicators** — `uwrScore 0.1875` with axes
`structure 0.15 / execution 0 / risk 0.2 / insight 0.4` — so `outputHash`,
`uwrScore`, and the UWR axes are all byte-identical to the pre-DR-002 goldens.

## Remaining limitations

DR-001 and DR-002 are resolved, but this remains a **non-production POC**:

- All scored output, receipts, and audit records are still **demo-only /
  provisional**; nothing here is canonical protocol truth.
- The `news`, `social`, and `ai-ml` lanes remain **provisional committed
  fixtures** (no live providers); only `technical-indicators` and
  `pattern-recognition` are wired.
- The demo runs over committed fixtures with a frozen injected clock; there is
  no persistence, no DB/vault writes, and no network I/O.
- Validator certification, minting, settlement, rewards, and reputation
  mutation remain out of scope and downstream of the reactor.

---

## Future missions / next steps

This POC is a starting point. Concrete follow-on work for future missions:

1. ~~**Restore canonical USS validation (DR-001).**~~ **DONE** — canonical
   `validateUsignalV11` (ajv + afi-config schemas) is live at the clean seam
   (District One Hardening, Mission 1.5-B).
2. ~~**Restore the canonical indicator kernel (DR-002).**~~ **DONE** — the
   technical lane defaults to `canonicalIndicatorEngine` wrapping canonical
   `computeTechnicalEnrichment` / `trading-signals` v7 at the engine seam
   (District One Hardening, Mission 1.5-B); scoring stays in afi-core.
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
provisional fixtures while `technical-indicators` and `pattern-recognition` are
wired. Schema validation is the canonical `validateUsignalV11` (DR-001 resolved)
and the technical lane runs the canonical `computeTechnicalEnrichment` /
`trading-signals` v7 indicator kernel (DR-002 resolved), both swapped in at the
clean seams the original mission reserved; the golden `bundleHash` was re-pinned
for DR-002 only, while `inputHash` / `outputHash` / `uwrScore` are unchanged. No
part of this system is presented as canonical protocol truth.
