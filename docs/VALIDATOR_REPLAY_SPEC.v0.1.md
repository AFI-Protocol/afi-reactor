# Reproducibility & Replay Spec v0.1 (afi-reactor)

## Status

The reactor **stops at scored**. Validator certification, minting decisions, and
trade execution are **downstream / external** concerns and are **not** reactor
responsibilities. The earlier in-reactor "validator replay" model — a
scored → validate → mint-checkpoint → vault lifecycle driven by codex replay
tooling — has been **removed**, along with the scripts and config that backed it.
This spec now documents the reproducibility guarantee the reactor actually
provides.

## Purpose & Scope

This spec defines how the reactor guarantees **deterministic, reproducible
scoring** so runs can be audited and compared over time. It does **not** define
scoring formulas (those live in `afi-core`); it defines the runtime's
reproducibility contract up to the scored-signal evidence boundary.

## What Is Reproducible

Every live scoring run is reproducible from ingress to the scored-signal evidence
record:

- **Boot-validated composition** — the registered pipeline manifest and governed
  registries are loaded and AJV-validated at boot, with canonical `afi.hash.v1`
  pins verified fail-closed (`src/pipeline/registryLoader.ts`). The same pinned
  composition is required for identical outputs.
- **Deterministic execution** — the single GraphExecutor
  (`src/pipeline/executor.ts`) runs the five enrichment lanes and the Froggy UWR
  scorer with no wall-clock or random inputs on the scoring path.
- **Byte-stable outputs** — scoring, UWR, decay, and evidence are proven
  byte-identical by the oracle golden suites (`npm test`, and the gated
  `npm run test:oracle:mongo`).
- **Canonical provenance** — the District-2 provenance law
  (`src/evidence/provenance/`) stamps `afi.hash.v1` over a canonical projection
  (sha256-only, domain-tagged preimages, volatile-timestamp exclusion) into the
  governed `afi.scored-signal-evidence.v2` record.

## Reproducibility Invariants

- **Determinism**: same pinned composition + same inputs → same scored output and
  same `afi.hash.v1` projection.
- **Isolation**: replaying/re-running a scoring path must not mutate production
  state. Evidence is written only by **afi-infra** (the sole writer); the reactor
  builds and validates the record, it does not own the store.
- **Traceability**: the evidence record links the scored signal to the
  composition it was produced under (`afi.composition-ref.v1`) and to its
  canonical hash.

## Out of Scope (not reactor responsibilities)

- Validator certification / accept-reject decisions.
- Minting decisions and mint orchestration (`afi-mint`).
- Persisting or comparing certified/minted artifacts.

Any replay of those downstream decisions is defined and owned by the downstream
consumers, over the scored-signal evidence the reactor emits — not here.

## Versioning

- v0.1 is **normative** for the reproducibility invariants (determinism,
  isolation, traceability) as implemented by the oracle goldens and the D2
  provenance law.
- v0.1 is **non-prescriptive** about downstream certification/mint replay, which
  lives outside this repo.
