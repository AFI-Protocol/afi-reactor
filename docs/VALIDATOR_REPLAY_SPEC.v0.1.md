# Validator Replay Spec v0.1 (afi-reactor)

## Purpose & Scope

This spec defines how the reactor performs **deterministic replay** of signals and validator decisions. Replay is used to:
- Verify validator consistency over time.
- Audit past minting decisions.
- Support research/evals on validator behavior.

It does **not** define scoring formulas (those live in `afi-core`); it defines orchestrator behavior and contracts for replay.

## Replayable Lifecycle (Textual Flow)

Replay focuses on the scoring → validation → vaulting slice of the DAG. A typical path:

`scored-signal` → `afi-ensemble-score` → `dao-mint-checkpoint` → `validated-signal` → `tssd-vault-persist` → `vaulted-signal` → `full-cognition-loop`

Replay-critical segments:
- Scorer + validator + mint-decider equivalents (`afi-ensemble-score`, `dao-mint-checkpoint`, downstream validator decision outputs).
- Persistence of validated artifacts (vaulted/persisted signal) used for later comparison.
  - The canonical `vaulted-signal` schema is owned by **afi-infra**; afi-reactor consumes it via `config/schema.codex.json` as a DAG contract only, not as the implementation owner.

## ValidatorReplaySession (Conceptual)

A replay session SHOULD capture:
- `replaySessionId` — unique id.
- `originalSignalId` — signal being replayed.
- `codexVersion` — DAG/Codex configuration version used.
- `configSnapshotId` — validator/scorer configuration snapshot (thresholds, novelty, etc.).
- `dataSnapshotRef` — reference to the data/Vault snapshot used for inputs.
- `timestampRequested`, `timestampCompleted`.

Pinned inputs (codex + config + data) are required so the same replay session yields identical outputs later (within timestamp tolerances).

## Replay Invariants

- **Determinism:** Same codex version + same config + same data snapshot → same validator outputs.
- **Isolation:** Replay must not mutate production state (no new mints, no writes to live TSSD collections). Replay writes go to replay/test collections or logs.
- **Traceability:** Every replay session links to the original signal, validators involved, and a clear log of decisions.

## DAG Contract for Replay

The reactor should be able to:
- Start replay from a given node (e.g., from `scored-signal`) or from a stored `vaulted-signal` snapshot.
- Feed the relevant nodes (`afi-ensemble-score`, `dao-mint-checkpoint`, etc.) with the same inputs used originally.
- Collect outputs and compare to historical outcomes (when available).
- Emit a replay report artifact (JSON/logs).

This spec is non-prescriptive about implementation details; it defines what a compliant replay must achieve.

## Validator Responsibilities in Replay

Validators (and validator-like nodes) must:
- Respect deterministic inputs and produce the same decisions given the same inputs.
- In replay mode: avoid side effects (no writes to live vaults, no live minting); optionally emit diagnostics (e.g., “why approved/rejected”).

Replay is an orchestrator concern, but validators must be replay-friendly.
Replay consumes validator outputs, decision envelopes, and UWR-derived confidence values as defined in **afi-core** (e.g., `ValidatorDecision`, `UniversalWeightingRule`); afi-reactor does not implement UWR math or PoI/PoInsight logic, it only orchestrates replay over those contracts.

## Interaction with the TSSD Vault

- Live runs: validated signals flow to the TSSD Vault via nodes like `tssd-vault-persist` (Vault implementation lives in `afi-infra`).
- Replay: reactor may read from the Vault or a replay snapshot, but should write replay results to separate collections/logs/artifacts, not the main Vault.

## Versioning & Future Work

- v0.1 is **normative** for invariants (determinism, isolation, traceability) and concepts (ReplaySession, replayable lifecycle).
- v0.1 is **non-prescriptive** about file layout, exact logging formats, or DAG rewiring.
- Future versions may:
  - Define a concrete `ValidatorReplaySession` schema.
  - Add DAG nodes/plugins dedicated to replay.
  - Integrate with AFI evals and PoI/PoInsight measurement.
