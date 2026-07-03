# AFI Signal Evaluation Pipehead System (D2-native reference implementation)

> **Status: pre-live REFERENCE IMPLEMENTATION / implementation profile.**
> This system is one **example signal-evaluation path** demonstrating how a
> pipeline can emit **District 2 (D2)-compatible artifacts**. It is **not the
> canonical AFI pipeline** — no specific pipeline topology, analyst strategy,
> enrichment lane set, strategy view, DAG/pipehead composition, or
> ingestion/normalization parser holds canonical status. Canonical status
> belongs only to the approved schemas, validation rules, hash doctrine,
> provenance records, replay profiles, disclosure metadata, and protocol
> compatibility requirements (owned by afi-config). Analysts, validators,
> institutions, and future AFI-compatible agents are free to implement
> different pipelines as long as they emit valid AFI-compatible artifacts.
> This document describes the system that actually ships under
> `afi-reactor/src/pipeheads/**`, `src/cli/run-pipehead-demo.ts`, and
> `test/pipeheads/**` — not an aspirational design.

This system makes AFI's signal-evaluation DAG **Droid-operable** without making
Droids the source of financial truth. Droids operate the machinery (ingestion,
schema validation, a five-lane analysis fan-out, normalization, scoring
invocation, provenance emission, tests, docs). The **deterministic kernel** —
the afi-core Froggy trend-pullback UWR scorer — remains the source of truth and
is **invoked, never replaced**.

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

The contracts live in `src/pipeheads/types.ts` (pipeline machinery) and
`src/pipeheads/provenance/types.ts` (D2 artifact shapes). The pipehead kinds in
this reference implementation are:

| Kind | Pipehead(s) | Role |
| --- | --- | --- |
| `validation` | `schemaValidationPipehead` | Canonical USS v1.1 validation (DR-001 resolved) |
| `analysis-lane` | five lane pipeheads | Per-lane analysis fan-out |
| `normalize` | `normalizePipehead` | Reference adapter: fan-in to an internal `AnalysisBundle` + strategy-local enriched view |
| `envelope` | `envelopePipehead` | **AnalystInputEnvelope v1** (opaque, declared, hash-pinned strategy view + evidence/disclosure/lane provenance) |
| `scoring` | `scoringPipehead` | **Invokes** the afi-core deterministic scorer over the envelope's strategy-local view |
| `provenance` | `provenancePipehead` | **ScoredSignal v1 + ReplayProfile v1 + ProvenanceRecord v1** (schema-validated in-process) |

The `harness.ts` module composes these in a fixed order:

```
validate → fan-out (5 lanes) → normalize → envelope → score → provenance
```

and returns one aggregate `{ validation, envelope, scoredSignal,
provenanceRecord, replayProfile, internal }` from a single pass over a fixture.
A schema-validation failure is surfaced as a **structured value** (no uncaught
throw) and **short-circuits** the pipeline, so no downstream artifact is
produced for invalid input. A generated artifact that fails D2 schema
validation surfaces the same way under `stage: "artifact-validation"`.

---

## The D2-native outward artifact surface (District 2 M2)

The outward artifacts of one pass are **D2-native** and validate against the
merged afi-config District 2 M1 schemas (`schemas/provenance/v1/`):

- **AnalystInputEnvelope v1** — a strict wrapper around the intentionally
  **opaque** strategy-local enriched view (`FroggyEnrichedView` in this
  profile). The view is declared via `strategyViewType` /
  `enrichedViewSchemaRef` and participates in hashing **only** through the
  explicit `strategyLocalViewHash` pin. Nothing inside the view is protocol
  canon. The envelope also carries EvidenceRef v1 objects (hash-only evidence
  for the committed OHLCV/news/social/ai-ml fixture inputs),
  SourceDisclosureProfile v1 objects, and per-lane EnrichmentProvenance v1
  records.
- **ScoredSignal v1 projection** — the thin scored-signal projection: identity,
  direction, risk bucket, conviction, UWR score/axes (read **verbatim** from
  the afi-core `analystScore`), an optional domain-declared `evaluatedAt`
  (derived from the OHLCV evidence `asOf` — never wall-clock), and the
  provenance link. It structurally excludes `rawUss`, `lenses`,
  `_priceFeedMetadata`, `rawPayload`, storage fields, debug fields, and every
  volatile processing timestamp.
- **ProvenanceRecord v1** — one record per pass binding
  `inputHash` (signal-input domain, over the validated raw USS),
  `enrichmentHash` (enrichment-bundle domain, over the normalized bundle
  material), and `outputHash` (scored-output domain, over the emitted
  ScoredSignal projection), plus evidence refs, source-disclosure refs, the
  replay-profile ref, domain-tag summary, and stage schema versions.
- **ReplayProfile v1** — deterministic replay pins for the run: committed
  fixture dataset id, per-lane version pins, evidence ids and CanonicalHash
  pins, `factsRequired: true`, `replayabilityLevel: "deterministic"`.

**No hash cycle:** the ScoredSignal carries only the deterministic, id-derived
`provenanceRecordRef` (`provenance-record:<signalId>`) — never a digest of the
record; the record's `outputHash` then commits to the finished ScoredSignal
projection. The commitment is one-directional by construction and by test.

### Retired pre-D2 POC artifacts

The former outward POC shapes are **retired** and no longer emitted anywhere:

- `AnalysisBundle` as an outward CLI block (it remains an **internal**
  intermediate under the harness aggregate's clearly-marked `internal` key),
- `DemoScoredSignal` (replaced outward by the ScoredSignal v1 projection; the
  in-process carrier between the scorer and the projection is now the
  `@internal` `InternalScoringResult`, never emitted),
- `DemoReputationReceipt` (retired outright; no D2 counterpart),
- `AuditRecord` and the old mission-local canonicalizer (superseded by
  ProvenanceRecord v1 + CanonicalHash v1).

**TradePlan v1 is not generated** by this profile: the pipehead USS fixture
carries no trade levels and CPJ mapping is frozen. A validation helper
(`validateTradePlanV1`) ships for completeness.

---

## CanonicalHash v1 (afi.hash.v1) — hash doctrine implementation

`src/pipeheads/provenance/canonicalHashV1.ts` implements the off-chain D2
CanonicalHash v1 behavior. Canonicalization/hashing **rules** are canonical
doctrine; this module is their reference implementation:

- **sha256 only** — keccak256/on-chain domains are a separate family and are
  not representable here.
- **`canonicalizationVersion: "afi.hash.v1"`** with a **required `afi.*`
  domain tag** validated against `^afi(\.[a-z0-9-]+)+$`.
- **Domain separation in the preimage** — the digest is computed over
  `"afi.hash.v1" + "\n" + domainTag + "\n" + canonicalJson`, so the same
  object hashed under two domains yields two digests (cross-domain reuse is
  impossible).
- **Deterministic recursive key sorting + stable JSON serialization** (array
  order preserved; `undefined` dropped).
- **Timestamp policy** — volatile runtime/storage timestamps (`scoredAt`,
  `createdAt`, `updatedAt`, `storedAt`, `processedAt`, `ingestedAt`,
  `startedAt`, `finishedAt`) are **excluded** recursively by default (or
  **rejected** under `volatileTimestampPolicy: "reject"`); domain-declared
  evidence/evaluation timestamps (`asOf`, `fetchedAt`, `postedAt`,
  `observedAt`, `observationTime`, `evaluatedAt`) **are** hash material.
- **Number policy (strict, no float opt-in)** — safe integers are admissible;
  **every non-integer number is rejected, unconditionally** — no flag exists
  to admit arbitrary floats. Decimal strings are preserved as strings.

### The hash-projection layer (field-specific number policy)

`src/pipeheads/provenance/hashProjection.ts` bridges the strict number policy
with the schema-declared numeric surfaces:

- Declared key sets name EXACTLY which fields may carry numbers on each hashed
  surface: `SCORE_DECIMAL_KEYS` (`uwrScore`, `conviction`, and the four UWR
  axes — the merged ScoredSignal schema types these as JSON numbers),
  `ENRICHMENT_DECIMAL_KEYS` (lane indicator/sentiment fields of this profile),
  and `OHLCV_DECIMAL_KEYS` (candle fields).
- `projectDecimalFieldsForHash` converts declared fields — **always**, integer
  or not, so a field's preimage type never flips with its value — into
  deterministic **canonical decimal strings** (shortest round-trip, plain
  notation: `0.1875 → "0.1875"`). There is **no** scaled base-unit integer
  encoding.
- The projection affects the **hash preimage only**; emitted artifacts keep
  their schema-conformant JSON numbers.
- Any non-integer number under an **undeclared** key is still rejected by the
  canonicalizer (fail-closed).

### D2 schema validation adapter

`src/pipeheads/provenance/schemaValidation.ts` validates every generated
artifact against the **merged afi-config schemas** (loaded from the installed
`afi-config` package — never duplicated locally) on a dedicated strict AJV
instance (same options + `x-afi*` vocabulary as afi-config's own harness; the
canonical USS validator's AJV instance is untouched, and no strictness is
loosened globally). The provenance pipehead runs these validators — plus a
forbidden-key guard (`rawUss`, `lenses`, `_priceFeedMetadata`, `_id`,
`createdAt`, `updatedAt`, `rawPayload`, `claimRoot`, `rewardAmount`,
`vaultAddress`, `validatorDecision`, `demoOnly`) — in-process on every pass.

---

## Normalization boundary (reference adapter, not protocol behavior)

**USS v1.1 compatibility is canonical. The normalization method is not.**

The `normalizePipehead` in this repository is a **reference adapter/profile**:
one way of adapting validated USS + lane results into an internal bundle and a
strategy-local enriched view. Different analysts, providers, validators,
institutions, or AFI-compatible agents may use different source-specific
parsers, mappers, and normalization methods as long as they:

- emit valid USS objects,
- preserve required provenance,
- expose evidence/source references where required,
- satisfy the D2 hash/disclosure/replay requirements,
- do not falsify or silently discard material signal intent.

Note the asymmetry: **canonicalization-for-hashing rules may be canonical**
(they are protocol doctrine), while **ingestion normalization algorithms are
not** (they are implementation choices).

---

## How Droids operate it (operate, do not adjudicate)

Droids **operate** the pipeline machinery; they do **not adjudicate** outcomes.
Concretely, Droids:

- move state between pipeheads (validate → fan-out → normalize → envelope →
  score → provenance),
- run the five analysis lanes and fan them in to the internal analysis bundle,
- **invoke** the deterministic afi-core scorer and carry its output through
  verbatim,
- emit the D2-native, content-hashed, replayable artifact set,
- write the tests, fixtures, CLI demo, and this documentation.

Droids never substitute LLM/subjective judgment for a score, a validation
decision, or any trust-critical output. No pipehead re-implements, re-weights,
or "adjusts" scoring/UWR/reputation math. The score is produced solely by the
deterministic kernel described next; the pipeheads only transport and bind it.

---

## Where the deterministic AFI logic is the source of truth

The **source of truth** is the deterministic afi-core kernel, invoked unchanged:

- **Scorer:** `scoreFroggyTrendPullbackFromEnriched(enriched)` from
  `afi-core/analysts/froggy.trend_pullback_v1.js`
  (`analystId = "froggy"`, `strategyId = "trend_pullback_v1"`).
- **Universal Weighting Rule (UWR):** `defaultUwrConfig` is used **unchanged**
  (four equal axis weights of `0.25`), so `uwrScore` equals the equal-weight
  mean of the four `uwrAxes` (`structure`, `execution`, `risk`, `insight`).

The scoring pipehead (`src/pipeheads/scoringPipehead.ts`) **only invokes** this
scorer over the envelope's opaque strategy-local view and carries the afi-core
`AnalystScoreTemplate` through verbatim on the internal carrier; the outward
ScoredSignal v1 projection reads those values verbatim. It never recomputes or
re-weights anything. District 2 M2 introduced **no** changes to `afi-core`,
`afi-math`, or `afi-config`; the scorer and UWR config are referenced read-only
via the `afi-core/...` package name. The golden scoring values over the
committed fixture are **byte-identical** to the pre-D2 goldens
(`uwrScore 0.1875`, axes `structure 0.15 / execution 0 / risk 0.2 /
insight 0.4`).

Determinism is mandatory: identical input ⇒ identical output ⇒ identical
digests. The outward D2 artifacts carry **no runtime timestamps at all**, so
two runs are byte-identical even under different injected clocks; the only
clock-derived fields live on internal carriers and are excluded from every
content hash by the afi.hash.v1 timestamp policy.

### The five lanes: two wired, three provisional

The analysis stage always exposes exactly **five lanes** in a stable order —
in this profile (the lane set is profile-local, not protocol canon):

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

Each lane's status and provenance are emitted structurally as
EnrichmentProvenance v1 records on the envelope (`status: "complete"` for
wired, `"provisional"` for fixture lanes, `"failed"` for degraded lanes), each
with a `laneOutputHash` pin.

The CLI demo (`node --loader ts-node/esm src/cli/run-pipehead-demo.ts`) makes
this visible: it prints a five-lane summary labeling each lane `[WIRED]` or
`[PROVISIONAL]`, followed by four independently-parseable JSON blocks
(`AnalystInputEnvelope`, `ScoredSignal`, `ProvenanceRecord`, `ReplayProfile`).
Running it twice yields byte-identical artifact blocks.

---

## Decision Records DR-001 / DR-002 — both RESOLVED

The original offline mission could not reuse two trust-relevant afi-reactor
modules, so self-contained equivalents were used **behind clean seams** with
canonical restoration recorded as Decision Records DR-001 and DR-002.
**District One Hardening (Mission 1.5-B) resolved both** at exactly those
seams; District 2 M2 did not touch them.

### DR-001 — RESOLVED: schema validation is canonical `validateUsignalV11`

`src/pipeheads/schemaValidationPipehead.ts` delegates to canonical
`validateUsignalV11` (ajv compiled over the canonical afi-config
`usignal/v1_1` core+index schemas). The public contract is
`{ ok, errors: [{ field, message }] }` with `errors` always an array;
required-property ajv errors map `field` to the missing key (e.g.
`provenance.signalId`).

### DR-002 — RESOLVED: the technical lane uses the canonical indicator kernel

The WIRED `technical-indicators` lane defaults to `canonicalIndicatorEngine`
(`src/pipeheads/lanes/technicalLane.ts`), which wraps canonical
`computeTechnicalEnrichment` (→ `froggyProfile` → `indicatorKernel` →
`trading-signals` v7) through the injectable `runTechnicalLane(candles,
engine)` seam. The offline helper (`src/pipeheads/lanes/technicalIndicators.ts`)
is retained only as a non-default injectable engine proving the seam still
works. **Scoring remains 100% afi-core**, unchanged.

### Golden pins after District 2 M2

The committed golden (`test/pipeheads/fixtures/golden.json`) pins both the
scoring values and the afi.hash.v1 digests:

- **Scoring values (UNCHANGED from pre-D2):** `uwrScore 0.1875`, axes
  `structure 0.15 / execution 0 / risk 0.2 / insight 0.4`, `direction neutral`,
  `riskBucket medium`, `conviction 0.1875`.
- **Hash pins (re-pinned for D2 M2 by design):** the digests are now
  CanonicalHash v1 values under the new preimage rule and domain tags
  (`inputHash` signal-input; `enrichmentHash` enrichment-bundle — replaces the
  old `bundleHash`; `outputHash` scored-output over the ScoredSignal v1
  projection; plus the envelope's `strategyLocalViewHash` pin). A recompute
  that diverges signals nondeterminism or an unreviewed
  scoring/canonicalization change.

## Remaining limitations

This remains a **pre-live reference implementation**:

- The `news`, `social`, and `ai-ml` lanes remain **provisional committed
  fixtures** (no live providers); only `technical-indicators` and
  `pattern-recognition` are wired.
- The demo runs over committed fixtures with a frozen injected clock; there is
  no persistence, no DB/vault writes, and no network I/O.
- Validator certification, minting, settlement, rewards, and reputation
  mutation remain out of scope and downstream of the reactor.
- TradePlan v1 generation is deferred (no trade levels exist on the current
  fixture surface; CPJ mapping is frozen).

---

## Future missions / next steps

1. **Wire the three provisional lanes.** Replace the committed `news`,
   `social`, and `ai-ml` fixtures with real, governed data sources behind the
   existing lane seams (still respecting governance boundaries), emitting
   honest SourceDisclosureProfile / EvidenceRef metadata for each.
2. **Persistence profile.** Consider a governed, auditable persistence path
   for ProvenanceRecord v1 (via `storageProfileRef`; storage remains an
   implementation profile, not protocol canon — out of scope here).
3. **Replay tooling.** Build operator tooling around the ReplayProfile v1 pins
   for drift detection.
4. **TradePlan v1.** Generate trade-intent projections when a signal surface
   with actual trade levels exists.

These are explicitly future work. Token/mint/treasury/vault/settlement logic,
emissions math, reward distribution, live trading, production deploys/keys, and
any change to core scoring/UWR/reputation math (or mutation of reputation
state) remain **out of scope** and are governed by the Charter and Pipehead
Addendum.

---

## Summary

This is a pre-live **reference implementation** of a Droid-operated, five-lane,
deterministic, replayable signal-evaluation path whose outward artifact surface
is **D2-native**: AnalystInputEnvelope v1, ScoredSignal v1, ProvenanceRecord
v1, and ReplayProfile v1, all validated in-process against the merged
afi-config District 2 schemas and bound together by CanonicalHash v1
(afi.hash.v1: sha256, domain-tagged preimages, strict timestamp and number
policies with a field-specific decimal hash projection). The afi-core scorer +
UWR (`defaultUwrConfig`, unchanged) is the deterministic source of truth and
its outputs are byte-identical to the pre-D2 goldens. The pre-D2 POC outward
artifacts (DemoScoredSignal, DemoReputationReceipt, AuditRecord) are retired.
No part of this system — including its normalization adapter — is presented as
canonical protocol behavior; canonical status belongs to the schemas,
validation rules, and hash doctrine alone.
