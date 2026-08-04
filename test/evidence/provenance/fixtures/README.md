# Provenance fixtures

- `signal.uss.json` — canonical USS input for builder/hash tests.
- `golden.json` — committed golden values. **Whole-file sha256 pin** (guardrail):
  `312da1180b0bd418c03f595093516ebdc755ba81465a0b526ace43d002126e06`.

## Stale `_note` in `golden.json` (do not “fix” the bytes here)

`golden.json`'s `_note` claims District-2 evidence-law digests (domain tag inside
the preimage) for `enrichmentHash` and `strategyLocalViewHash`.

**Live path (main):**

- `composition.enrichmentHash` is computed under the **composition** law
  (`src/pipeline/hashing.ts` `canonicalHashOf`, tag carried not hashed) in
  `src/services/graphScoringService.ts`.
- `strategyLocalViewHash` is **not produced** on the live scoring path (tag
  reserved in `canonicalHashV1.ts`; optional on the draft envelope only).
- `inputHash` / `outputHash` remain evidence-law (`computeCanonicalHashV1`).

Do **not** edit `golden.json` solely to correct the note — that would move the
whole-file pin without a sanctioned golden program. The authoritative correction
lives in `src/evidence/README.md` (“Two hashing laws…”) and this README.
