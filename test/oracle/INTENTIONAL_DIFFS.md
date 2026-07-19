# ORACLE RECONCILIATION — intentional golden diffs (W3 stage B production switch)

The SLOT-FCP-REACTOR production switch (server endpoints → strategy
resolution → boot-validated registry composition → GraphExecutor → evidence
v2) was proven against the committed behavioral-oracle goldens. The goldens
were regenerated ONCE via `npm run oracle:regen`; **every changed field is
itemized below and belongs to one of the documented intentional diff
classes** (spec §7). Anything else diffing would have been a defect to fix in
code, never absorbed into a golden.

Regenerated goldens (all 24 committed golden files; no file added or removed):

- `fail-soft/{tv-long,tv-short,tv-neutral,cpj-blofin-perp-long,cpj-coinbase-spot-sell,cpj-blofin-perp-neutral}.{builtin,registry}.json` (12)
- `enriched/{tv-long,tv-short,tv-neutral,cpj-blofin-perp-long,cpj-coinbase-spot-sell,cpj-blofin-perp-neutral}.{builtin,registry}.json` (12)

## Class 1 — `facts.strategy` resolution (and the fixture strategy-field update)

Strategy resolution now runs BEFORE USS mapping (spec §4): `facts.strategy`
is the RESOLVED registered strategyId on both routes. The committed webhook
fixtures' `strategy` field was updated from the legacy free text
`froggy_trend_pullback_v1` to the registered `trend_pullback_v1` (a
registered ref) before regenerating. Exact changed fields, per golden:

| Field (golden path) | Goldens | Old → new | Why |
|---|---|---|---|
| `/canonicalUss/facts/strategy` | all 24 | TV: `froggy_trend_pullback_v1` → `trend_pullback_v1`; CPJ: `cpj-ingested` → `trend_pullback_v1` | resolved strategyId replaces raw free text (TV) and the removed `cpj-ingested` constant (CPJ) |
| `/canonicalUss/provenance/providerRef` | 12 (TV only) | `froggy_trend_pullback_v1` → `trend_pullback_v1` | providerRef is the payload's verbatim strategy text; the FIXTURE field changed (rule unchanged) |
| `/canonicalUss/provenance/ingestHash` | 12 (TV only) | new sha256 | TV ingestHash hashes the raw payload, whose `strategy` field changed with the fixture (CPJ ingestHash is unchanged — the CPJ payload did not change) |
| `/inputHash/value` + `/evidenceRecord/provenanceRecord/inputHash/value` | all 24 | new sha256 | inputHash hashes the canonical USS, whose bytes changed per the rows above |
| `/httpResponse/rawUss/...`, `/httpResponse/uss/...`, `/httpResponse/pipelineResult/rawUss/...` | all 24 | mirrors of the canonicalUss rows | the response envelope embeds the canonical USS |
| `/httpResponse/meta/strategy`, `/httpResponse/pipelineResult/meta/strategy` | all 24 (12+12) | as facts.strategy | `meta.strategy` reads `facts.strategy` |

`signalId` cascade note: the webhook DEFAULT signalId composition now uses
the resolved strategyId (`{symbol}-{timeframe}-{resolved strategy}-...`).
Every committed oracle fixture carries an EXPLICIT signalId, so **no golden
signalId changed**; the cascade is real only for default-id webhooks (covered
by the error-table "double-post WITHOUT signalId" row, which asserts
distinctness, not bytes).

## Class 2 — evidence record v2 (schema const + required composition)

| Field (golden path) | Goldens | Old → new | Why |
|---|---|---|---|
| `/evidenceRecord/schema` | all 24 | the v1 evidence schema id → the v2 evidence schema id | FCP-GOV D-FCP-7: the new decision + new schema version (never a silent mutation) |
| `/evidenceRecord/composition` | all 24 | absent → the complete `afi.composition-ref.v1` object | v2's one addition: pipelineId `froggy-trend-pullback`, pipelineVersion `v1.0.0`, the pinned manifestHash `b8d9b734…`, analystConfigHash `269ae355…`, pluginSetHash `6d54c8b7…`, scorer plugin identity, per-run `executionSummaryHash` (tag `afi.d2.execution-summary`), per-run `enrichmentHash` (tag `afi.d2.enrichment-bundle`, timestamp-free bundle projection) |

## Class 3 — response envelope additions

**None.** The switch adds NO new fields to either endpoint's success
envelope (kept deliberately minimal). The envelope diffs above are all value
mirrors of class 1.

## Error-table additions (no golden files; contract rows)

New 403 resolution-rejection rows in `oracleErrorTable.test.ts`
(`unknown_provider_binding` unknown provider on both routes,
`inactive_provider_binding` inactive binding, `unauthorized_strategy`
free text without a defaultStrategy), plus a positive row proving free text
WITH a defaultStrategy resolves to the registered default. **Every
pre-existing error row is unchanged** (same statuses, same discriminators,
same fail-closed semantics).

## Explicitly byte-equal (verified by the regen diff audit)

`scorerInput` (the exact FroggyTrendPullbackInput), `analystScore` (incl.
every `uwrAxes` value), `uwrResolvedSource`, `decayParams`
(decay-swing-v1 → halfLifeMinutes 720, now resolved from the registration's
decayConfig instead of horizon inference), `outputHash` (projection preimage
unchanged), `lenses`, `_priceFeedMetadata`, `uwrProfile` (same pinned
profile metadata + RC-6 source), idempotency/conflict semantics, fail-soft
behavior, and the Mongo record mapping — none of these changed in any
golden.

---

# FLPR-GOV RECONCILIATION — five-lane provider runtime activation

The five-lane provider runtime activation (FLPR-GOV: five vendor-neutral
provider-instance-backed category lanes on `froggy-trend-pullback v1.1.0`,
the aiMl lane joined pre-merge, classic direct-call nodes deleted) was proven
against the committed goldens with a field-level old-vs-new differential
before regeneration. **Every scoring-relevant field is BYTE-EQUAL across all
24 goldens**: `scorerInput`, `analystScore`, `uwrResolvedSource`,
`decayParams`, `inputHash`, `outputHash`, `canonicalUss`, and the evidence
record's `scoredSignal` projection, `uwrProfile` stamp, and
`provenanceRecord`. The goldens were then regenerated ONCE via
`npm run oracle:regen`; the changed fields are exactly these intentional
classes:

1. **`evidenceRecord.composition`** (and its `httpResponse.pipelineResult`
   mirror on CPJ captures): `pipelineVersion` v1.0.0 → v1.1.0 and the five
   composition hashes (`manifestHash`, `analystConfigHash`, `pluginSetHash`,
   `executionSummaryHash`, `enrichmentHash`) — the governed D-PBF-10
   consequence of the manifest carrying `providerInstanceRef`s and the
   re-recorded analyst-config pin.
2. **`httpResponse.lenses` / `_priceFeedMetadata.patternSignals`**: the
   pattern lens is now the governed `afi.enrichment.pattern.v1` payload
   (series/motifs/discords/changePoints/pivots + the optional D-FLPR-3
   candlestick block) instead of the retired classic payload; the sentiment
   lens is now the governed axes shape; the BTC-fixed regime block is gone.
3. **Enriched SOL captures lose the sentiment lens** (5 → 4 lenses): the
   keyless CFTC COT reference lane maps only LISTED COT markets (BTC/ETH);
   an unmapped symbol honestly contributes no sentiment axes — never a
   fabricated default market (D-FLPR-4).
4. **Fail-soft lane status vocabulary**: remote lanes that fail now THROW at
   the adapter edge and settle as `failed-optional` after their declared
   retry policy (previously the classic nodes swallowed errors internally
   and settled `degraded`); the degradation is recorded, never silent.

Anything else diffing would have been a defect to fix in code, never
absorbed into a golden.

5. **Enriched-suite news lens content** (the recorded-transport swap): the
   enriched oracle variant now records the SEC-EDGAR reference lane's fixed
   transport instead of the retired NewsData module seam, so the enriched
   captures' news lens bytes are the recorded filing events (source
   `sec-edgar`, `shockDirection: "unknown"`, accession-linked items) rather
   than the prior recorded headlines. News is score-inert (D-FLPR-5) —
   `scorerInput`/`analystScore`/hashes verified byte-equal across the swap.

## Mission D reconciliation — Tiny Brains internal orchestration (composition re-pin)

The aiMl lane moved to the governed orchestration-profile contract: the
provider record is `1.1.0` (adds `supportedModels: ["froggy-reference-v1"]`),
the reference aiMl ProviderInstance is `1.1.0` (adds `model:
froggy-reference-v1`, `adapterVersion: 1.1.0`), and the official pipeline is
re-versioned `froggy-trend-pullback v1.2.0` (aiml node pins instance `1.1.0`;
topology — nodes and edges — byte-unchanged). The froggy composition pin was
re-recorded onto v1.2.0. Goldens were regenerated ONCE via
`npm run oracle:regen`; **exactly three field pairs changed per golden file
(all 24), all composition-identity, no behavioral or scored field:**

| Field (golden path) | Goldens | Old → new | Why |
|---|---|---|---|
| `.../composition/pipelineVersion` | all 24 | `v1.1.0` → `v1.2.0` | official pipeline re-versioned (aiml lane pins instance 1.1.0; geometry unchanged) |
| `.../composition/manifestHash/value` | all 24 | `87bcb7ed…` → `095b5577…` | manifestHash hashes the re-versioned manifest bytes |
| `.../composition/analystConfigHash/value` | all 24 | `2274978a…` → `395fd7f9…` | analyst config re-recorded its `pipelineRef` (v1.2.0 + new manifestHash) |

Verified byte-EQUAL across the re-pin (no golden diff): every `scoredSignal`
field (`direction`/`uwrScore`/`uwrAxes`/`riskBucket`/`conviction`), the
`enrichmentHash` and `pluginSetHash` (the aiMl payload shape and plugin set
are unchanged — `afi.enrichment.aiml.v1` and `afi-analysis-aiml@2.0.0` are
untouched), `executionSummaryHash`, `inputHash`, and `outputHash`. aiMl
remains score-inert (D-FLPR-5); the frozen v2 evidence shape was unchanged.

Anything else diffing would have been a defect to fix in code, never
absorbed into a golden.

---

# EV3-GOV RECONCILIATION — Mission C: Evidence V3 + provider invocation provenance

The Evidence V3 program (EV3-GOV: `afi.scored-signal-evidence.v3` as the sole
current evidence contract, five per-lane invocation proofs, recordHash /
replayHash, froggy-trend-pullback **v1.3.0** all-lanes-critical) regenerated
the ENRICHED goldens ONCE via `npm run oracle:regen` (D-EV3-8(1)).

## Golden inventory change

- `enriched/*.{builtin,registry}.json` (12) — regenerated (diff classes below).
- `fail-soft/*` (12) + `oracleGoldensFailSoft.test.ts` — **DELETED**: the
  "external providers OFF, network down, still scores" environment those
  goldens froze is structurally impossible under v1.3.0 — every category lane
  is CRITICAL (D-EV3-5(1)); a failed lane now yields NO scored evaluation and
  NO evidence record. The behavior is pinned by the replacement suites:
  `oracleFailFast.test.ts` (fail-fast abort: honest 500, zero submissions,
  bounded diagnostics) and `oracleReplayDeterminism.test.ts` (§15.4: the same
  evaluation twice → byte-identical records/replayHash; a Date-only
  wall-clock perturbation moves scoredAt but NOT the record bytes,
  recordHash, or replayHash). The invariance + error-table suites (and the
  enriched suite) now install the ONE shared recorded-transport set
  (`support/recordedLaneStubs.ts`) so every scored 200 is a full five-lane
  run.

## Intentional diff classes (regen audit — scripted field-level comparison)

Method: every regenerated golden was compared against its pre-regen (main)
bytes with a recursive JSON path differ; every changed path was classified
against the allowed classes; **zero unclassified diffs remained**, and the
byte-identity of every scoring surface was asserted explicitly per file.

Exactly SEVEN diff classes, each in ALL 12 goldens, and nothing else:

| Field (golden path) | Old → new | Why |
|---|---|---|
| `/evidenceRecord/schema` | v2 id → `afi.scored-signal-evidence.v3` | D-EV3-1: the new decision + new schema version |
| `/evidenceRecord/composition/pipelineVersion` | `v1.2.0` → `v1.3.0` | D-EV3-5(1): the governed all-lanes-critical successor manifest |
| `/evidenceRecord/composition/manifestHash/value` | `095b5577…` → `df3372da…` | manifestHash hashes the re-versioned manifest bytes |
| `/evidenceRecord/composition/analystConfigHash/value` | `395fd7f9…` → `e34471de…` | analyst config re-pinned its `pipelineRef` onto v1.3.0 |
| `/evidenceRecord/providerInvocations` | absent → the five ordered proofs | D-EV3-2: v3 addition (aiMl, news, pattern, sentiment, technical) |
| `/evidenceRecord/recordHash` | absent → `afi.d2.evidence-record` commitment | D-EV3-4(6): v3 addition |
| `/evidenceRecord/replayHash` | absent → `afi.d2.evidence-replay` commitment | D-EV3-4(6): v3 addition |

## Explicitly byte-EQUAL (asserted per golden by the regen audit script)

`inputHash`, `outputHash`, `scorerInput` (the exact
FroggyTrendPullbackInput), `analystScore` (incl. every `uwrAxes` value),
`uwrResolvedSource`, `decayParams`, `canonicalUss`, the FULL `httpResponse`
envelope, and inside the evidence record: `scoredSignal`,
`provenanceRecord`, `uwrProfile`, the identifier surface
(signalId/analystId/strategyId/strategyVersion/lifecycleState/finalized/
canonicalizationVersion), and the composition's `pipelineId`,
`scorerPluginId`, `scorerPluginVersion`, `pluginSetHash`,
`executionSummaryHash`, and `enrichmentHash` — across ALL 12 goldens. No
scored value moved; `manifestHash`/`analystConfigHash` moved only through
the governed D-EV3-5(1) manifest amendment.

Anything else diffing would have been a defect to fix in code, never
absorbed into a golden.
