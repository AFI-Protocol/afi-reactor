# AFI Reactor - Common Droid Tasks

Frequent tasks with step-by-step instructions. The pipeline is the
manifest-driven GraphExecutor (`src/pipeline/`); there is no other executor.

---

## Task 1: Add a New Pipeline Node

**When**: You need to add a new processing step to the signal pipeline.

**⚠️ IMPORTANT**: Read `docs/AFI_ORCHESTRATOR_DOCTRINE.md` and `AGENTS.md`
first. Category nodes are governed by the five-category namespace
(`technical`, `pattern`, `sentiment`, `news`, `aiMl` — FCP-GOV D-FCP-1).

**Steps**:

1. **Create the node** under `src/pipeline/nodes/` following the existing
   node shape (see `src/pipeline/nodes/technical.ts` and
   `src/pipeline/nodeSdk.ts` for the `run(input, ctx)` contract and logger
   discipline).
2. **Register it** in the builtin plugin registry
   (`src/pipeline/pluginRegistry.ts`) with a pinned `pluginId@version`.
3. **Reference it from a registered pipeline manifest** (the composition is
   loaded and validated at boot by `src/pipeline/registryLoader.ts`; the
   server refuses to boot on an invalid registry — D-FCP-8).
4. **Add a jest test** under `test/pipeline/` (the jest `testMatch` list in
   `jest.config.js` is an ALLOWLIST — a test outside the listed globs never
   runs).
5. **Run the gates**:
   ```bash
   npm run build && npm test -- --maxWorkers=2
   ```

---

## Task 2: Change a Pipeline Composition

**When**: You need to change node order/edges for a strategy.

Compositions are data (registered pipeline manifests), not code. Edit the
registered manifest, keep the composition hash discipline intact
(`src/pipeline/hashing.ts`), and prove behavior with the oracle
byte-equivalence suite:

```bash
npm test -- --maxWorkers=2
npm run test:oracle:mongo   # gated real-Mongo half (CI runs it)
```

Never regenerate oracle goldens to make a change pass — byte drift is the
signal that behavior changed.

---

## Task 3: Add a Provider Adapter

**When**: You need a new enrichment data source behind the provider socket.

Follow the PBF-GOV pattern in `src/providers/adapters/` (registered once via
`builtinProviderAdapters()` in `src/providers/index.ts`; secrets only through
the injected `SecretResolver`; never a key in a URL; output validated against
the governed category contract). Note: binding category nodes to provider
adapters at runtime is Mission-B scope — do not wire the socket into the live
manifest.

---

## Task 4: Add an Integration Test

**When**: You need to test ingress-to-evidence behavior.

Use the existing integration suites as templates
(`test/integration-mongo/*.mjs`, run via
`npm run test:integration:mongo`); the compiled 503 smoke is
`npm run test:integration:unavailable`.

---

## Getting Help

If stuck on any task:
1. Check `docs/AFI_ORCHESTRATOR_DOCTRINE.md`
2. Check `AGENTS.md` for constraints
3. Look at existing pipeline nodes for patterns
4. Run tests to verify changes
5. Ask human maintainer if unsure

---

**Last Updated**: 2026-07-18 (DSC-GOV clean-cut consolidation)
