# Canonical scored-signal evidence (v2)

The Reactor persists exactly ONE canonical artifact per scored signal: the
governed `afi.scored-signal-evidence.v2` record, submitted through the
afi-infra canonical evidence-store interface (MONGO-GOV D-MONGO-3 — the
Reactor is a submitter, never a writer). v2 = v1 + the REQUIRED
`composition` provenance (FCP-GOV D-FCP-7); the `scoredSignal` projection and
`provenanceRecord` preimages are UNCHANGED from v1 (inputHash/outputHash
byte-stable across the version bump).

Pipeline: `buildReactorEvidenceRecord(scored, context)` →
prove (vendored v2 schema + D2 sub-schemas + identifier continuity) →
`store.submit(record)` (afi-infra re-validates authoritatively). Any failure
is a first-class, honestly-reported error — never a masked success.

## The composition stamp (`afi.composition-ref.v1`)

All-or-nothing (a run that cannot pin its full composition refuses to
submit): pipelineId/pipelineVersion, manifestHash (`afi.d2.composition-manifest`),
analystConfigHash (`afi.d2.analyst-config`), scorer plugin identity,
pluginSetHash (`afi.d2.plugin-set`), executionSummaryHash
(`afi.d2.execution-summary`, timestamp-free by construction), and
enrichmentHash. All hashes are canonical-json-hashing.v1
(`src/pipeline/hashing.ts`, KAT-proven).

## The enrichment-bundle projection (enrichmentHash)

`enrichmentHash` = canonical hash, domain tag `afi.d2.enrichment-bundle`, of

```json
{
  "schema": "afi.enrichment-bundle.v1",
  "signalId": "<signalId>",
  "lenses": [ /* the run's USS lens objects, sorted by lens `type` */ ],
  "enrichedCategories": [ /* enrichmentMeta.categories, sorted */ ]
}
```

TIMESTAMP-FREE by construction: the projection carries only lens payloads
and category names — `enrichmentMeta.enrichedAt` (and every other volatile
processing timestamp) never enters it. Domain-declared evidence timestamps
inside lens payloads (e.g. news items' `publishedAt`) are admissible hash
material per the D2 hash doctrine. The value is JSON-round-tripped before
hashing, so the digest covers exactly the JSON semantics of the bundle
(Dates as ISO strings, `undefined` dropped). Implementation:
`src/services/graphScoringService.ts`.

## Registry-backed UWR stamp

`uwrProfile` is REQUIRED on every record. Recognition is REGISTRY-BACKED
(FCP-GOV D-FCP-9 item 5): the stamp is issued iff the resolved
analyst-strategy registration's `uwrProfileRef` names a registered profile
AND the scorer identity triple matches the registration
(`src/config/uwrProfilePin.ts` — pinned profile metadata values unchanged;
RC-6 `source` semantics verbatim). Unstampable scores fail closed: no
unstamped evidence is ever persisted.
