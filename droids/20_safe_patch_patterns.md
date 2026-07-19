# AFI Reactor - Safe Patch Patterns

How to make safe, reviewable changes to the scored-signal evaluation runtime.
The pipeline is one manifest-driven GraphExecutor; nodes and provider adapters
are small, composable units it runs. Read `AGENTS.md` before starting.

---

## Pattern 1: Keep Nodes & Adapters Stateless

Nodes (`src/pipeline/nodes/`) and provider adapters (`src/providers/adapters/`)
must not carry mutable instance/module state across invocations. Given the same
input they must produce the same output. State (caches, snapshots, persistence)
belongs to the store layer (afi-infra), not to a node.

**Why**: stateless units are composable, testable, and keep runs reproducible.

---

## Pattern 2: Single Responsibility

One node / one adapter does one thing — a technical adapter fetches and shapes
technical indicators; the merge node merges lane results; the scorer node scores.
Do not fold sentiment + pattern + scoring into one unit. Split it.

**Why**: single responsibility keeps units reusable and reviewable.

---

## Pattern 3: Preserve Determinism

Never introduce non-determinism (`Math.random()`, wall-clock time, unordered map
iteration) into a scoring or enrichment path. Determinism is what makes the
oracle byte-equivalence goldens meaningful and the `afi.hash.v1` provenance
stable.

**Why**: any drift in the goldens means behavior changed — that must be a
deliberate, reviewed decision, never an accident.

---

## Pattern 4: Additive Changes to Composition

Composition is data (registered pipeline manifests + governed registries), not
code. Prefer additive changes: register a new node/adapter and reference it,
rather than removing or reordering existing lanes. Keep the composition hash
discipline intact (`src/pipeline/hashing.ts`); registries are pinned with
canonical `afi.hash.v1` and verified at boot (fail-closed).

**Why**: additive, hash-pinned changes preserve backward compatibility and boot
integrity.

---

## Pattern 5: Never Regenerate Oracle Goldens to Pass

If a change makes an oracle golden fail, that is the signal — investigate the
behavior change. Do **not** run the golden-regeneration path to make CI green
unless the byte change is intended, understood, and reviewed.

---

## Pattern 6: Secrets Only Through the Injected Resolver

Provider adapters receive credentials only via the injected `SecretResolver`
(`src/providers/secretResolver.ts`). Never read a secret from a URL, a registry
entry, a manifest, or a committed file.

---

## Pattern 7: Respect the Scored-Only Boundary

The reactor stops at scored. Do not add validator-certification, trade-execution,
or evidence-persistence logic to a node — evidence is written only by afi-infra,
and certification/mint are downstream / external (afi-mint). A node's job ends at
producing a validated category result or a UWR score.

---

## Pattern 8: Test in Isolation, Then Run the Gates

Unit-test a new node/adapter against fixed inputs, then run the full gates:

```bash
npm run build && npm test -- --maxWorkers=2
```

Remember `jest.config.js` `testMatch` is an ALLOWLIST — a test file outside the
listed globs never runs.

---

## Checklist Before Submitting

- [ ] Read `AGENTS.md`
- [ ] Nodes/adapters are stateless and deterministic
- [ ] Single responsibility per unit
- [ ] New units registered with a pinned `pluginId@version`; hash discipline intact
- [ ] Secrets only via the injected `SecretResolver`
- [ ] No validator/execution/evidence-write logic added (scored-only boundary respected)
- [ ] Tests added and passing (`npm test`)
- [ ] Oracle goldens NOT regenerated (unless the byte change is intended and reviewed)

---

**Last Updated**: 2026-07-18
