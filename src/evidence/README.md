# Canonical scored-signal evidence (v3)

The Reactor persists exactly ONE canonical artifact per scored signal: the
governed `afi.scored-signal-evidence.v3` record, submitted through the
afi-infra canonical evidence-store interface (MONGO-GOV D-MONGO-3 — the
Reactor is a submitter, never a writer). v3 = the v2 record shape carried
forward unchanged + exactly three REQUIRED additions (EV3-GOV D-EV3-1):
`providerInvocations` (the five-lane provider invocation proof collection),
`recordHash`, and `replayHash`. The `scoredSignal` projection and
`provenanceRecord` preimages are UNCHANGED (inputHash/outputHash byte-stable
across the version bump).

Pipeline: `buildReactorEvidenceRecord(scored, context)` →
prove (vendored v3 closure + D2 sub-schemas + identifier continuity) →
`store.submit(record)` (afi-infra re-validates authoritatively and verifies
recordHash/replayHash by recomputation, D-EV3-7). Any failure is a
first-class, honestly-reported error — never a masked success.

## The provider invocation proofs (`afi.provider-invocation-proof.v1`)

Exactly FIVE per record — one per governed category, unique, ordered
ascending case-sensitive (`aiMl`, `news`, `pattern`, `sentiment`,
`technical`) — captured inside the ONE live graph pass at the provider
runtime seam (D-EV3-5(2); evidence never re-calls a provider). Each proof
binds non-secret facts only: category + governed result schema id, the
Provider / ProviderInstance identities with composition-law record
fingerprints, the adapter identity + transport kind, the credential binding
(explicit keyless posture XOR opaque CredentialRef facts — never a secret,
D-EV3-6), the closed invocation-input hash, the provider-result and
category-result hashes, the technical lane's `priceSource`, and — on the
aiMl lane only — the nested `afi.aiml-invocation-proof.v1` Tiny Brains
projection (D-EV3-3). The sole builder fails closed on every mismatch
(D-EV3-5(3)); proofs are carried, never consumed (D-EV3-2).

Hash law (D-EV3-4): every proof hash + `recordHash`/`replayHash` run under
the composition canonicalization law (`canonical-json-hashing.v1`,
`src/pipeline/hashing.ts` — tag carried, never hashed), projections in
`src/evidence/provenance/invocationProofHashes.ts`. The Tiny Brains digests
inside the nested proof are OPAQUE `tiny-brains.hash.v1` commitments,
boundary-verified by the KAT-proven recomputation in
`src/providers/clients/tinyBrainsHashV1.ts` — never recomputed under either
afi.hash.v1 law.

## Two hashing laws that share the stamp `afi.hash.v1` (do not unify)

Both composition and evidence paths stamp `canonicalizationVersion: "afi.hash.v1"`,
but they are **different implementations** with different value policies. Unifying
them would move digests (era + cutover). Documented here so competing notes are
not mistaken for a single law:

| Law | Module | Digest preimage | Domain tag | Numbers |
|---|---|---|---|---|
| **Composition** (`canonical-json-hashing.v1`) | `src/pipeline/hashing.ts` (+ infra twin) | `sha256(canonicalize(material))` | **CARRIED** on the CanonicalHash object — **not** in digest bytes | Shortest ECMAScript round-trip floats **admissible** |
| **Evidence** (District-2 / provenance) | `src/evidence/provenance/canonicalHashV1.ts` | `sha256("afi.hash.v1\\n" + domainTag + "\\n" + canonicalJson)` | **Inside** the preimage | Safe integers only; raw floats rejected; declared keys projected to decimal strings via `hashProjection.ts` |
| **Tiny Brains** (third) | `tiny-brains.hash.v1` (opaque hex on proofs) | Service canonical JSON | n/a (not a CanonicalHash) | Service float domain |

**Live assignment (EV3-GOV):** `enrichmentHash`, `manifestHash`, `analystConfigHash`,
`pluginSetHash`, `executionSummaryHash`, lane/provider proof hashes, `recordHash`,
and `replayHash` use the **composition** law. Provenance `inputHash` / `outputHash`
use the **evidence** law.

**Fixture note correction:** `test/evidence/provenance/fixtures/golden.json`'s `_note`
claims evidence-law (tag-in-preimage) digests for `enrichmentHash` / `strategyLocalViewHash`.
That note is **stale relative to the live path**: live `composition.enrichmentHash` is
composition-law (`graphScoringService.ts` → `canonicalHashOf`); `strategyLocalViewHash`
is declared but **not produced** on the live path. The golden file bytes are intentionally
left untouched (whole-file pin `312da118…`); this README is the correction. Tests that
recompute digests assert `inputHash` under the evidence law; they do not recompute the
golden's enrichment/strategyLocalView hex fields.

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
`src/services/graphScoringService.ts`. The per-lane commitments live in the
invocation proofs' `categoryResultHash` values (`afi.d2.lane-output`, the
re-homed reservation) — PR-O1 resolved by D-EV3-4(4) with BOTH commitments
retained.

## Registry-backed UWR stamp

`uwrProfile` is REQUIRED on every record. Recognition is REGISTRY-BACKED
(FCP-GOV D-FCP-9 item 5): the stamp is issued iff the resolved
analyst-strategy registration's `uwrProfileRef` names a registered profile
AND the scorer identity triple matches the registration
(`src/config/uwrProfilePin.ts` — pinned profile metadata values unchanged;
RC-6 `source` semantics verbatim). Unstampable scores fail closed: no
unstamped evidence is ever persisted.
