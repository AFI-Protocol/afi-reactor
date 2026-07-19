# AFI Reactor - Common Droid Tasks

Frequent tasks with step-by-step instructions. The pipeline is the single
manifest-driven GraphExecutor (`src/pipeline/`); there is no other executor.

---

## Task 1: Add a New Pipeline Node

**When**: You need to add a new processing step to the graph.

**⚠️ IMPORTANT**: Read `AGENTS.md` first. Enrichment categories are governed by
the five-category namespace (`technical`, `pattern`, `sentiment`, `news`,
`aiMl`).

**Steps**:

1. **Create the node** under `src/pipeline/nodes/` following the existing node
   shape (see `src/pipeline/nodes/mergeEnrichedView.ts` and
   `src/pipeline/nodeSdk.ts` for the `run(input, ctx)` contract and logger
   discipline).
2. **Register it** in the builtin plugin registry
   (`src/pipeline/pluginRegistry.ts`) with a pinned `pluginId@version`.
3. **Reference it from a registered pipeline manifest** (composition is loaded
   and validated at boot by `src/pipeline/registryLoader.ts`; the server refuses
   to boot on an invalid registry).
4. **Add a jest test** under `test/pipeline/` (the jest `testMatch` list in
   `jest.config.js` is an ALLOWLIST — a test outside the listed globs never
   runs).
5. **Run the gates**:
   ```bash
   npm run build && npm test -- --maxWorkers=2
   ```

---

## Task 2: Change a Pipeline Composition

**When**: You need to change lane order/edges for a strategy.

Compositions are data (registered pipeline manifests), not code. Edit the
registered manifest, keep the composition hash discipline intact
(`src/pipeline/hashing.ts`), and prove behavior with the oracle
byte-equivalence suite:

```bash
npm test -- --maxWorkers=2
npm run test:oracle:mongo   # gated real-Mongo half (CI runs it)
```

Never regenerate oracle goldens to make a change pass — byte drift is the signal
that behavior changed.

---

## Task 3: Add a Provider Adapter

**When**: You need a new enrichment data source for one of the five lanes.

The adapter registry in `src/providers/` is the **live, sole enrichment
execution seam**. Follow the pattern in `src/providers/adapters/` (registered
once via `builtinProviderAdapters()` in `src/providers/index.ts`; secrets only
through the injected `SecretResolver`; never a key in a URL; output validated
against the governed category contract). Bind the adapter to a lane by adding a
`ProviderInstance` to the governed afi-config registries and referencing it from
the pipeline manifest.

---

## Task 4: Add an Integration Test

**When**: You need to test ingress-to-evidence behavior.

Use the existing integration suites as templates
(`test/integration-mongo/*.mjs`, run via `npm run test:integration:mongo`); the
compiled 503 smoke is `npm run test:integration:unavailable`.

---

## Getting Help

If stuck on any task:
1. Check `AGENTS.md` for constraints and the current architecture.
2. Look at existing pipeline nodes / provider adapters for patterns.
3. Run tests to verify changes.
4. Ask a human maintainer if unsure.

---

**Last Updated**: 2026-07-18
