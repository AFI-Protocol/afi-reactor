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

# DIR-GOV RECONCILIATION — scored-signal direction restoration

Authorized by `afi-governance/decisions/scored-signal-direction-restoration-v0.1.md`
(DIR-GOV, accepted PR #32, merge `6a06b98`). D-DIR-2(3) bounds this
regeneration to EXACTLY the eight direction-bearing goldens and EXACTLY five
fields per golden. The fix: the evidence projection now reads the submitted
side carried from `scored.meta.direction` (= USS `facts.direction`) instead
of the analyst's hardcoded-neutral verdict, restoring the governed contract
"aligned with USS v1.1 facts.direction" (scored-signal.schema.json). The
analyst's own verdict is UNCHANGED everywhere (D-DIR-3).

## Per-golden itemized diffs (all five fields; generated by the regen audit)

`outputHash` appears twice per golden (top-level test capture and
`/evidenceRecord/provenanceRecord/outputHash`) — the two values are asserted
identical and move together, so one column covers both.

| golden | `/evidenceRecord/scoredSignal/direction` | `outputHash.value` (×2) | `recordHash.value` | `replayHash.value` |
|---|---|---|---|---|
| `tv-long.builtin` | `neutral` → `long` | `67ebebda…` → `5af3fcb6…` | `5c7aaf1c…` → `cb84d6a5…` | `2b1c8265…` → `6492f651…` |
| `tv-long.registry` | `neutral` → `long` | `67ebebda…` → `5af3fcb6…` | `f3403dc2…` → `db6db10f…` | `a75bd027…` → `9d40ca19…` |
| `tv-short.builtin` | `neutral` → `short` | `cafdbce2…` → `b1bf0287…` | `5ef63f62…` → `8392214a…` | `197af24a…` → `2456862a…` |
| `tv-short.registry` | `neutral` → `short` | `cafdbce2…` → `b1bf0287…` | `a0a3d932…` → `1e5bf57a…` | `c8dabc10…` → `9c4600bd…` |
| `cpj-blofin-perp-long.builtin` | `neutral` → `long` | `9e4a960c…` → `d53f0adf…` | `3bd2d46f…` → `05662de0…` | `7705ce4e…` → `d6872184…` |
| `cpj-blofin-perp-long.registry` | `neutral` → `long` | `9e4a960c…` → `d53f0adf…` | `cb5894f3…` → `f2892b8c…` | `5a14c116…` → `25137a8d…` |
| `cpj-coinbase-spot-sell.builtin` | `neutral` → `short` | `e19e9b74…` → `03e31a8e…` | `53468f5d…` → `284edad9…` | `f73fe3dd…` → `2fef7210…` |
| `cpj-coinbase-spot-sell.registry` | `neutral` → `short` | `e19e9b74…` → `03e31a8e…` | `8f380e2a…` → `323c0ed4…` | `f09a31be…` → `1f2a6407…` |

## Explicitly byte-EQUAL (asserted per golden by the regen audit script)

The four neutral goldens (`tv-neutral.*`, `cpj-blofin-perp-neutral.*`) are
byte-identical in full. Across the eight regenerated goldens, every path
outside the five listed fields is byte-equal — including `inputHash`,
`scorerInput`, `analystScore` (every value; its `direction` stays the
analyst's own verdict), `uwrResolvedSource`, `decayParams`, `canonicalUss`,
all `httpResponse` content, the full `composition` block
(manifestHash/analystConfigHash/pluginSetHash/executionSummaryHash/
enrichmentHash), and all five `providerInvocations` proofs. The deterministic
provenance golden `test/evidence/provenance/fixtures/golden.json` is
byte-identical (sha256 `312da118…` pin, D-DSC-8(2)/D-R1-6): it predates the
fix and is preserved as the disclosed fossil DIR-GOV §1.6 records. No scored
value moved anywhere.

# EQ-GOV RECONCILIATION — execution-axis trigger quantisation rubric era

Authorized by `afi-governance/decisions/execution-quantisation-v0.1.md`
(EQ-GOV). D-EQ-3(3) bounds this regeneration to ALL twelve goldens and
EXACTLY three fields per golden. The change: the afi-core adapter quantises
pattern confidence at the emitted grade boundaries (>=75 -> 3, >=65 -> 2,
>0 -> 1, else 0; EQ-GOV D-EQ-2) and the scorer plugin's
`implementationVersion` moved `1.0.0` -> `1.1.0` (EQ-GOV D-EQ-3(2), the
SV-GOV D-SV-2(2) orthogonal surface), moving `pluginSetHash`
`5384e1c0…` -> `e10cf9ee…` uniformly. Because every pattern-present fixture
is a pin bar at confidence 65 — the mapping's fixpoint (65 -> 2) — **no
score byte moves in any golden**; the score movement EQ-GOV D-EQ-4
authorizes is pinned by the new afi-core mapping-table unit tests, not by
golden movement.

## Per-golden itemized diffs (all three fields; generated by the regen audit)

`/evidenceRecord/composition/pluginSetHash/value` moves identically in all
twelve goldens: `5384e1c0…` -> `e10cf9ee…`.

| golden | `recordHash.value` | `replayHash.value` |
|---|---|---|
| `tv-long.builtin` | `cb84d6a5…` → `e1a42bc1…` | `6492f651…` → `17a4fd1b…` |
| `tv-long.registry` | `db6db10f…` → `d3c9b22e…` | `9d40ca19…` → `c4097bdf…` |
| `tv-short.builtin` | `8392214a…` → `00ad11f3…` | `2456862a…` → `4b738aa3…` |
| `tv-short.registry` | `1e5bf57a…` → `c28929a2…` | `9c4600bd…` → `621a68af…` |
| `tv-neutral.builtin` | `8f410ced…` → `cd1a8d8a…` | `11579309…` → `ef1161ed…` |
| `tv-neutral.registry` | `1aad0dcc…` → `97b86f83…` | `16c1a7b0…` → `eca179f0…` |
| `cpj-blofin-perp-long.builtin` | `05662de0…` → `d4e27661…` | `d6872184…` → `bf5e7a5b…` |
| `cpj-blofin-perp-long.registry` | `f2892b8c…` → `e287f531…` | `25137a8d…` → `b86fa990…` |
| `cpj-blofin-perp-neutral.builtin` | `55597cd4…` → `7d4e84e4…` | `e6ff1fd9…` → `75a8ef31…` |
| `cpj-blofin-perp-neutral.registry` | `2ad2d131…` → `220881f0…` | `f03a3ae7…` → `7dd34ea1…` |
| `cpj-coinbase-spot-sell.builtin` | `284edad9…` → `a3b19000…` | `2fef7210…` → `c1052587…` |
| `cpj-coinbase-spot-sell.registry` | `323c0ed4…` → `6fb25119…` | `1f2a6407…` → `6f9feb6a…` |

## Explicitly byte-EQUAL (asserted per golden by the regen audit script)

Every regenerated golden was compared against its pre-regen (main) bytes
with a recursive JSON path differ; every changed path was classified against
the three allowed fields; zero unclassified diffs remained. Across all
twelve goldens, every path outside the three listed fields is byte-equal —
including every score and axis value (`scorerInput.triggerPatternQuality`
stays `2` in the six pattern-present goldens: the 65 -> 2 fixpoint proof;
execution stays `0.6666666666666666`, `uwrScore`/`conviction` stay
`0.5916666666666667` pattern-present and `0.42500000000000004` neutral),
`analystScore` in full, `outputHash` (both occurrences), `inputHash`,
`canonicalUss`, all lens payloads, `enrichmentHash`, `manifestHash`,
`analystConfigHash`, `executionSummaryHash`, and all five
`providerInvocations` proofs. The deterministic provenance golden
`test/evidence/provenance/fixtures/golden.json` is byte-identical (sha256
`312da118…` pin, D-DSC-8(2)/D-R1-6) — it contains no composition surface and
no test recomputes its scores. Anything else diffing would have been a
defect to fix in code, never absorbed into a golden.

# AR-GOV RECONCILIATION — ATR-regime activation rubric era

Authorized by `afi-governance/decisions/atr-regime-v0.1.md` (AR-GOV, accepted
PR #36, merge `a46a58e`). D-AR-4(3) bounds this regeneration to ALL twelve
goldens with the enumerated movable classes — unconditional (the lens/hash
chain) plus, only where the fixture's deterministic candles compute a
non-`normal` regime, the derived score/note surfaces. The change: the
technical lane emits the governed regime observation (`atrRegime` +
sealed one-decimal `atrPercentile`, D-AR-2 midrank law over the ~86
in-window ATR-14 observations), the afi-core adapter maps it (absent →
`normal`), and the scorer plugin's `implementationVersion` moved
`1.1.0 → 1.2.0` (D-AR-4(2)), moving `pluginSetHash`
`e10cf9ee…` → `f63c6f21…` uniformly in all twelve goldens. One decimal-key
declaration was needed (`atrPercentile`; `atrRegime` is a closed string and
needs none — D-AR-4(3)(a)'s "two declarations" is a ceiling, under-used by
one).

Regen audit (recursive JSON path differ, every changed path classified
against the D-AR-4(3) classes): **zero unclassified diffs across all
twelve goldens.** Fixture regimes computed: `normal` for the six
pattern-present goldens (p=30.5 cpj-long, p=70.7 coinbase-sell/tv-long —
score bytes byte-identical, 11 changed paths each), `high` for
cpj-blofin-perp-neutral/tv-neutral (p=94.8 / 86.8), `low` for tv-short
(p=9.8) — 30 changed paths each.

## Unconditional per-golden diffs (all twelve; generated by the regen audit)

`/evidenceRecord/composition/pluginSetHash/value` moves identically in all
twelve: `e10cf9ee…` → `f63c6f21…`. The technical lens payload gains
`atrRegime` + `atrPercentile` in its two per-golden copies (both inside
`httpResponse`: `lenses[].payload` and `_priceFeedMetadata.technicalIndicators`).

| golden | technical `providerResultHash` | technical `categoryResultHash` | aiMl `invocationInputHash` | `enrichmentHash` | `recordHash` | `replayHash` |
|---|---|---|---|---|---|---|
| `cpj-blofin-perp-long.builtin` | `e668ca1e… → 92f5e94a…` | `b870c1e3… → d700b9e2…` | `4d7113c1… → 8702b8a1…` | `688430b8… → 76c5d51a…` | `d4e27661… → 148c93d8…` | `bf5e7a5b… → 3d741501…` |
| `cpj-blofin-perp-long.registry` | `e668ca1e… → 92f5e94a…` | `b870c1e3… → d700b9e2…` | `4d7113c1… → 8702b8a1…` | `688430b8… → 76c5d51a…` | `e287f531… → cb21208a…` | `b86fa990… → 974212e3…` |
| `cpj-blofin-perp-neutral.builtin` | `fc436fc9… → 2b53c11e…` | `8a19f103… → 16a53244…` | `f59d9992… → 37de5af5…` | `5e7b6888… → 9d0d44f5…` | `7d4e84e4… → 9a5eb16f…` | `75a8ef31… → 6b822b18…` |
| `cpj-blofin-perp-neutral.registry` | `fc436fc9… → 2b53c11e…` | `8a19f103… → 16a53244…` | `f59d9992… → 37de5af5…` | `5e7b6888… → 9d0d44f5…` | `220881f0… → ed42faeb…` | `7dd34ea1… → 00cbd0e4…` |
| `cpj-coinbase-spot-sell.builtin` | `ad9b683e… → a5fbb1c2…` | `a8d7cb93… → 3d06a2f8…` | `47843ee8… → 39c93e84…` | `0794ea75… → 4eddd28c…` | `a3b19000… → c7939ccd…` | `c1052587… → d449a7c3…` |
| `cpj-coinbase-spot-sell.registry` | `ad9b683e… → a5fbb1c2…` | `a8d7cb93… → 3d06a2f8…` | `47843ee8… → 39c93e84…` | `0794ea75… → 4eddd28c…` | `6fb25119… → 48791fd9…` | `6f9feb6a… → 4fa107cc…` |
| `tv-long.builtin` | `e1d44bb9… → 857b658b…` | `fdf0324f… → 99a6c915…` | `403bf488… → bbba6412…` | `0ee373d6… → 52c47876…` | `e1a42bc1… → 19f5496c…` | `17a4fd1b… → 2b0586dc…` |
| `tv-long.registry` | `e1d44bb9… → 857b658b…` | `fdf0324f… → 99a6c915…` | `403bf488… → bbba6412…` | `0ee373d6… → 52c47876…` | `d3c9b22e… → 6a2cbd5b…` | `c4097bdf… → 9cfcc50f…` |
| `tv-neutral.builtin` | `070ca091… → 7b6da09b…` | `146315de… → a858f401…` | `85a7d734… → a3e03897…` | `890ecec2… → 930cacbd…` | `cd1a8d8a… → 962dd933…` | `ef1161ed… → 9225bb47…` |
| `tv-neutral.registry` | `070ca091… → 7b6da09b…` | `146315de… → a858f401…` | `85a7d734… → a3e03897…` | `890ecec2… → 930cacbd…` | `97b86f83… → 8a874b48…` | `eca179f0… → da942b8c…` |
| `tv-short.builtin` | `60dfc7c8… → 8e024915…` | `edfff7f1… → ecbc588b…` | `731ac72f… → 5f9005c5…` | `6da5f462… → f2357ac4…` | `00ad11f3… → 37019085…` | `4b738aa3… → 77a267e3…` |
| `tv-short.registry` | `60dfc7c8… → 8e024915…` | `edfff7f1… → ecbc588b…` | `731ac72f… → 5f9005c5…` | `6da5f462… → f2357ac4…` | `c28929a2… → 795daebf…` | `621a68af… → 91375154…` |

## Conditional per-golden diffs (the six non-`normal` fixtures)

Each also gains `analystScore.axisNotes.insight` = "Liquidity or volatility
context is weak." and that sentence appended to `analystScore.rationale`
(both `analystScore` copies — the sub-0.4 insight note, authorized by
D-AR-4(3)/D-AR-5), and `scorerInput.atrRegime` moves off `normal`.
`conviction` equals `uwrScore` throughout.

| golden | regime (sealed p) | insight | uwrScore/conviction | riskBucket | `outputHash` (×2) |
|---|---|---|---|---|---|
| `cpj-blofin-perp-neutral.builtin` | high (p=94.8) | 0.4 → 0.3 | 0.42500000000000004 → 0.4 | medium → high | `a7ca24a2… → 796fa7e2…` |
| `cpj-blofin-perp-neutral.registry` | high (p=94.8) | 0.4 → 0.3 | 0.42500000000000004 → 0.4 | medium → high | `a7ca24a2… → 796fa7e2…` |
| `tv-neutral.builtin` | high (p=86.8) | 0.4 → 0.3 | 0.42500000000000004 → 0.4 | medium → high | `75cc6910… → 1cd9b6f4…` |
| `tv-neutral.registry` | high (p=86.8) | 0.4 → 0.3 | 0.42500000000000004 → 0.4 | medium → high | `75cc6910… → 1cd9b6f4…` |
| `tv-short.builtin` | low (p=9.8) | 0.4 → 0.1 | 0.42500000000000004 → 0.35000000000000003 | medium → low | `b1bf0287… → 81a258ce…` |
| `tv-short.registry` | low (p=9.8) | 0.4 → 0.1 | 0.42500000000000004 → 0.35000000000000003 | medium → low | `b1bf0287… → 81a258ce…` |

## Explicitly byte-EQUAL (asserted per golden by the regen audit script)

Across all twelve goldens, every path outside the classified sets is
byte-equal — including `inputHash`, `canonicalUss`, `manifestHash`,
`analystConfigHash`, `executionSummaryHash`, all pattern/sentiment/news
proof blocks and the aiMl output hashes (`providerResultHash`/
`categoryResultHash`/nested `aimlInvocation`), `providerInvocations[].adapter`
(the D-AR-2 within-identity determination: `afi-adapter-technical-local@1.0.0`
unchanged), `decayParams`, `uwrProfile`, `uwrResolvedSource`, every
direction surface, and — in the six `normal`-regime goldens — every score,
axis, note, and `scorerInput` byte. The six `normal` goldens moved in
exactly the 11 unconditional paths. The deterministic provenance golden
`test/evidence/provenance/fixtures/golden.json` is byte-identical (sha256
`312da118…` pin, D-DSC-8(2)/D-R1-6) — it contains no composition or
technical-lens surface. Anything else diffing would have been a defect to
fix in code, never absorbed into a golden.

---

# DH-GOV RECONCILIATION — analyst-decay correction (decay-intraday-v1)

Regenerated 2026-08-03 under `decay-horizon-alignment-v0.1` D-DH-4 (`npm run
oracle:regen`), after the D-DH-1 analyst-decay correction: the froggy
registered config's `decayConfig.ref.templateId` moved `decay-swing-v1` →
`decay-intraday-v1` (the 5m strategy's appropriate template; the prior swing
selection was the profile's `unknownOrMissing` fallback, not an analyst
choice), rotating `analystConfigHash`
`e34471de…` → `8ab167066132dbff48dc958afb51d93284fbf54f11b921a83092bec8b236749d`.
**No score-bearing change**: no scorer, adapter, plugin, manifest, or
pluginSetHash byte moved (era stays `f63c6f21…`).

## Per-golden itemized diffs (generated by a recursive JSON-path audit of all 12)

Exactly SEVEN diff path classes and nothing else:

| Field (golden path) | Old → new | Where | Why |
|---|---|---|---|
| `/decayParams/greeksTemplateId` | `decay-swing-v1` → `decay-intraday-v1` | 12/12 | D-DH-1: the corrected resolved decay stamp |
| `/decayParams/halfLifeMinutes` | `720` → `60` | 12/12 | D-DH-1: `decay-intraday-v1` half-life |
| `/evidenceRecord/composition/analystConfigHash/value` | `e34471de…` → `8ab16706…` | 12/12 | D-DH-1: the rotated analyst-config pin |
| `/evidenceRecord/recordHash/value` | per-golden | 12/12 | composition bytes sit in the record preimage |
| `/evidenceRecord/replayHash/value` | per-golden | 12/12 | composition bytes sit in the replay preimage |
| `/httpResponse/decayParams/*` | swing/720 → intraday/60 | 6/12 | response-shape family A carries the stamp at top level |
| `/httpResponse/pipelineResult/decayParams/*` | swing/720 → intraday/60 | 6/12 | response-shape family B nests it under `pipelineResult` |

## Explicitly byte-EQUAL (asserted by the audit across all 12)

`analystScore` (every score, axis, note), `uwrScore`/`conviction`,
`riskBucket`, every lens byte, `canonicalUss`, `scorerInput`, `inputHash`,
**`outputHash`** (its preimage excludes the decay stamp — verified by this
regen, recorded here because D-DH-4 itemized it as conditional),
`manifestHash`, `pluginSetHash`, `pipelineVersion`, all five
`providerInvocations` proof blocks, `meta`, and both direction surfaces. The
deterministic provenance golden `test/evidence/provenance/fixtures/golden.json`
is byte-identical (sha256 `312da118…` pin, D-DSC-8(2)/D-R1-6). Anything else
diffing would have been a defect to fix in code, never absorbed into a golden.
