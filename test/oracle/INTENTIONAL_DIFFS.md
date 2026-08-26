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

---

# TDR-GOV regeneration (timeframe-decay-resolution-v0.1 D-TDR-5(2)) — per-signal ratio decay law

All twelve enriched goldens regenerated via `npm run oracle:regen` after the
TDR-GOV D-TDR-4 registration flip (`decayConfig` → `{ ratio: {
barsPerHalfLife: 12, unknownTimeframeMinutes: 5 } }`, `analystConfigHash`
rotation `8ab16706…` → `1172e5da91dfd9ac6e65a060b628c5a4f1bbdd41545904a7a6a59e15fc0fe705`)
and the D-TDR-3 per-signal resolution seam. The decay stamp is now
**per-fixture-timeframe** (`halfLifeMinutes = 12 × timeframeMinutes`,
identity `decay-ratio-v1`), so the twelve goldens fan out across three derived
half-lives instead of sharing one template value.

## Per-golden itemized diffs (generated by a recursive JSON-path audit of all 12)

Exactly SIX diff path classes and nothing else:

| JSON path class | old → new | goldens |
| --- | --- | --- |
| `/decayParams/greeksTemplateId` | `decay-intraday-v1` → `decay-ratio-v1` | 12/12 |
| `/decayParams/halfLifeMinutes` | `60` → per-fixture: **180** (15m fixtures: `cpj-blofin-perp-neutral` ×2, `tv-neutral` ×2), **720** (1h fixtures: `cpj-coinbase-spot-sell` ×2, `tv-long` ×2), **2880** (4h fixtures: `cpj-blofin-perp-long` ×2, `tv-short` ×2) | 12/12 |
| `/decayParams/{barsPerHalfLife, timeframeMinutes, timeframeAssumed}` | ABSENT → `12` / per-fixture `15`&#124;`60`&#124;`240` / `false` (the D-TDR-3(3) self-describing stamp) | 12/12 |
| `/evidenceRecord/composition/analystConfigHash/value` | `8ab16706…` → `1172e5da…` | 12/12 |
| `/evidenceRecord/recordHash/value` | per-golden | 12/12 |
| `/evidenceRecord/replayHash/value` | per-golden | 12/12 |

plus the response-side mirror of the `/decayParams/*` movement in whichever of
the two shape families each golden carries: `/httpResponse/decayParams/*`
(6/12, family A) and `/httpResponse/pipelineResult/decayParams/*` (6/12,
family B) — byte-equal to the top-level stamp in every golden.

Explicitly byte-EQUAL (asserted per golden by the regen audit): `analystScore`
(including `holdingHorizon` and `signalTimeframe`), `uwrScore`/`conviction`,
`riskBucket`, every lens byte, `canonicalUss`, `scorerInput`, `inputHash`,
**`outputHash`** (its preimage excludes the decay stamp — re-verified by this
regen), `enrichmentHash`, `manifestHash`, `pluginSetHash`, `pipelineVersion`,
all five `providerInvocations` proof blocks, `meta`, and both direction
surfaces. The deterministic provenance golden
`test/evidence/provenance/fixtures/golden.json` is byte-identical (sha256
`312da118…` pin, D-DSC-8(2)/D-R1-6). Anything else diffing would have been a
defect to fix in code, never absorbed into a golden.

---

# CFG-GOV regeneration (analyst-configuration-freedom-v0.1 D-CFG-2, slot CFG-IMMUTABILITY) — sealed at admission

CFG-GOV D-CFG-2 (accepted 2026-08-06, merge `414f2cc`) amends MONGO-GOV
D-MONGO-5: a canonical scored-signal evidence record becomes **immutable at
admission in the SCORED state**, so the sole canonical writer now writes every
record `finalized: true` ("this determination is sealed"). `finalized` is
inside the recordHash preimage by law (D-EV3-4(6): recordHash excludes only
{recordHash, replayHash}), so the marker flip MOVES `recordHash` on every
record written after the slot — a **documented intentional diff**, not a
byte-stable change, exactly as D-CFG-6 provides. `finalized` is excluded from
the replayHash preimage by construction, so `replayHash` is byte-stable.

The 12 `enriched/` goldens were regenerated ONCE via `npm run oracle:regen`;
the 12 `fail-soft/` goldens embed no evidence record and are untouched.

## Per-golden itemized diffs (generated by a recursive JSON-path audit of all 12)

Exactly TWO diff path classes and nothing else:

| JSON path class | old → new | goldens |
| --- | --- | --- |
| `/evidenceRecord/finalized` | `false` → `true` | 12/12 |
| `/evidenceRecord/recordHash/value` | per-golden (the marker is in the record preimage) | 12/12 |

## Explicitly byte-EQUAL (asserted per golden by the regen audit script)

**`/evidenceRecord/replayHash/value`** (the D-EV3-4(6) replay projection
excludes `finalized` — proven byte-stable across all 12), `analystScore`
(every axis, `uwrScore`, `conviction`), `riskBucket`, `decayParams`, every
lens byte, `canonicalUss`, `scorerInput`, `inputHash`, `outputHash`,
`enrichmentHash`, `manifestHash`, `analystConfigHash`, `pluginSetHash`, all
five `providerInvocations` proof blocks, `meta`, both direction surfaces, and
the full `httpResponse` family. No scored-value field moved. Anything else
diffing would have been a defect to fix in code, never absorbed into a golden.

---

# DEM-GOV regeneration (declarative-enrichment-mapping-v0.1 D-DEM-6(2), D-DEM-7(4), D-DEM-5(3); slot DEM-BIND step (d′), owner-authorized 2026-08-22)

The froggy registration gained `mappingRef {froggy-trend-pullback, 1.0.0}`
(D-DEM-2(3)), the scorer plugin's `implementationVersion` moved `1.2.0 →
1.3.0` (D-DEM-7(4), the EQ-GOV D-EQ-3(2) precedent class — the scorer node
now composes its input from the registered mapping's interpreter fragment plus
the residual builder), and fired declared defaults became RECORDED
degradations (D-DEM-5(3)) riding the execution-summary status flip.

The 12 `enriched/` goldens were regenerated ONCE via `npm run oracle:regen`;
the `fail-soft/` goldens embed no evidence record and are untouched.

## Per-golden itemized diffs (generated by a recursive JSON-path audit of all 12)

Exactly THREE diff path classes and nothing else:

| JSON path class | old → new | goldens |
| --- | --- | --- |
| `/evidenceRecord/composition/analystConfigHash/value` | `1172e5da…` → `aa8cf5cf…` (mappingRef enters the config preimage, D-DEM-6(2)) | 12/12 |
| `/evidenceRecord/composition/pluginSetHash/value` | `f63c6f21…` → `220c004e…` (implementationVersion 1.3.0, D-DEM-7(4)) | 12/12 |
| `/evidenceRecord/composition/executionSummaryHash/value` | `9b23d299…` → `1178e36d…` — **grandfather #3 fires**: `patternConfidence` is absent on these six recorded inputs, the band's declared `absent` member supplies `triggerPatternQuality: 0`, and the firing is a recorded degradation flipping the scorer's summary status (D-DEM-5(3): *"two determinations that differ only in whether a default fired are hash-distinguishable forever"*) | **6/12 only**: `tv-neutral.{builtin,registry}`, `tv-short.{builtin,registry}`, `cpj-blofin-perp-neutral.{builtin,registry}` |

`recordHash`/`replayHash` move on 12/12 as pure consequences (the three
values above sit inside both preimages).

## Explicitly byte-EQUAL (asserted per golden by the regen audit script)

**`executionSummaryHash` on the six non-firing goldens** (`9b23d299…`
unchanged — design ruling R2: the status-only marker provably leaves every
non-firing preimage byte-identical), `analystScore` (every axis, `uwrScore`,
`conviction`), `riskBucket`, `scorerInput` (the mapping path reproduces the
retired seam byte-for-byte, incl. the grandfathered defaults — D-DEM-5(4)),
`decayParams`, every lens byte, `canonicalUss`, `inputHash`, `outputHash`,
`enrichmentHash`, `manifestHash` (`df3372da…`, unmoved), all five
`providerInvocations` proof blocks, `finalized`/`lifecycleState`, `meta`,
both direction surfaces, and the full `httpResponse` family. No scored-value
field moved. Anything else diffing would have been a defect to fix in code,
never absorbed into a golden.

---

# DEM-PRODUCER-PLAN reconciliation — the planned R:R becomes a provider fact (DEM-GOV §9, owner-authorized 2026-08-25)

**Authority.** DEM-GOV §9 `DEM-PRODUCER-PLAN` (founder instruction of 2026-08-25 recorded verbatim in the DEM-GOV Status line + §9; afi-governance #55) with §9 determinations D-2/D-4/D-5 (afi-governance #56). D-DEM-7(2) authorizes the movement in class (the risk axis fed by `rrMultiplePlanned`, hence `uwrScore`/`conviction`); this section is the D-DEM-7(3) itemization. **A slot whose diff exceeds its own itemization must not merge.**

**What changed on the path.** (1) `cpjMapper` carries the submitted trade plan as `uss.plan` (`afi.trade-plan.v1`, decimal strings) or refuses at ingest (422 `trade_plan_invalid`); TV/MarkitTick untouched. (2) The technical lane verifies every submitted level against the candles it fetched (band `[L − W, H + W]`, plan geometry from prices only) and emits `technical.plan` (`entryLow/entryHigh/entryPrice/stopPrice/firstTargetPrice/targetCount/rrToFirstTarget/envelopeLow/envelopeHigh/barCount`) or refuses the determination (422 `trade_plan_unverifiable`, no record). (3) `viewTechnical` projects `plan` verbatim. (4) Mapping **1.1.0** binds `rrMultiplePlanned ← technical.plan.rrToFirstTarget` (producer-declared optional, default **1** = the rubric floor; the firing is a recorded degradation). (5) afi-core deletes the `pulledBackIntoSweetSpot && !brokeEmaWithBody ? 2 : 1` synthesis; the composer partitions the ten fields exactly. (6) `implementationVersion`: technical `2.0.0 → 2.1.0`, merge `1.1.0 → 1.2.0`, scorer `1.3.0 → 1.4.0`; `pluginSetHash` `220c004e… → 36f911f4…`; `analystConfigHash` `aa8cf5cf… → 5cb9b7a4…` (mappingRef 1.0.0 → 1.1.0). (7) The two plan-bearing CPJ **fixtures were re-authored inside the demo feed's price envelope** (BTC: entry 42500/SL 41800/TP 43500 → 50000/49300/51000; ETH: entry 2280.5 → 3001.5) — the old levels lay thousands of dollars outside every window the demo feed can print and would have been refused by the law this slot lands; a test now proves the envelope contains every committed fixture plan.

Goldens regenerated ONCE via `npm run oracle:regen`; audited with the committed differ `node test/oracle/support/goldenDiff.mjs` (all 12 changed; 0 byte-equal).

## Per-golden scored-value movement (the class D-DEM-7(2) authorizes: the risk axis and its derivatives)

| golden | `scorerInput.rrMultiplePlanned` | `uwrAxes.risk` | `uwrScore` = `conviction` | `structure` | plan on USS | `executionSummaryHash` |
|---|---|---|---|---|---|---|
| `cpj-blofin-perp-long.{builtin,registry}` | 2 → 1.4286 | 0.9 → 0.5 | 0.59167 → 0.49167 | 0.4 (unmoved) | yes (verified; rr 1000/700) | byte-equal (already degraded by a grandfather firing) |
| `cpj-blofin-perp-neutral.{builtin,registry}` | 2 → 1 | 0.9 → 0.2 | 0.4 → 0.225 | 0.4 | no → floor default fired | byte-equal (already degraded) |
| `cpj-coinbase-spot-sell.{builtin,registry}` | 2 → 1 | 0.9 → 0.2 | 0.59167 → 0.41667 | 0.4 | yes, entry-only → no R:R claim → floor default fired | **moved** (`executed` → `degraded`) |
| `tv-long.{builtin,registry}` | 2 → 1 | 0.9 → 0.2 | 0.59167 → 0.41667 | 0.4 | no → floor default fired | **moved** (`executed` → `degraded`) |
| `tv-neutral.{builtin,registry}` | 2 → 1 | 0.9 → 0.2 | 0.4 → 0.225 | 0.4 | no → floor default fired | byte-equal (already degraded) |
| `tv-short.{builtin,registry}` | 2 → 1 | 0.9 → 0.2 | 0.35 → 0.175 | 0.4 | no → floor default fired | byte-equal (already degraded) |

`riskBucket` is unmoved on all 12 (it reads `atrRegime`, not the risk axis). `rationale`/`axisNotes` unmoved (the rubric emits no risk note). The risk axis is now **non-constant over the corpus** ({0.2, 0.5}) — via the provider's plan on the plan-bearing CPJ fixture and the declared floor elsewhere.

## Per-golden identity-hash / input-surface movement

| JSON path class | goldens | why |
|---|---|---|
| `/canonicalUss/plan`, `/httpResponse/uss/plan`, `/httpResponse/pipelineResult/rawUss/plan` (absent → object) | 4: the two plan-bearing CPJ fixtures × 2 modes | the carried `afi.trade-plan.v1` block |
| `/canonicalUss/provenance/ingestHash` (+ the two response echoes, `/httpResponse/ingestHash`) | same 4 | the CPJ fixture bytes changed (levels re-authored) — ingestHash hashes the CPJ payload |
| `/inputHash/value`, `/evidenceRecord/provenanceRecord/inputHash/value` | same 4 | the canonical USS gained `plan` (decimal strings; afi.hash.v1 admits them verbatim) |
| `/httpResponse/pipelineResult/lenses/0/payload/plan`, `…/_priceFeedMetadata/technicalIndicators/plan` | same 4 | the lane's verified plan facts ride the technical payload |
| `/evidenceRecord/composition/enrichmentHash/value` | same 4 | the technical lens payload gained `plan` |
| `/evidenceRecord/providerInvocations/4/{providerResultHash,categoryResultHash}/value` (technical) | same 4 | the validated technical CategoryResult gained `technical.plan` |
| `/evidenceRecord/providerInvocations/0..4/invocationInputHash/value` (all five lanes) | same 4 | every lane's proof commits to the canonical signal, which gained `plan` |
| `/evidenceRecord/composition/executionSummaryHash/value` | 4: `cpj-coinbase-spot-sell.*`, `tv-long.*` | the scorer node's status flips `executed → degraded` where the floor default is the FIRST fired default (D-DEM-5(3)); the other 8 were already `degraded` by a grandfather firing |
| `/evidenceRecord/composition/analystConfigHash/value` | all 12 | `aa8cf5cf… → 5cb9b7a4…` (mappingRef 1.1.0) |
| `/evidenceRecord/composition/pluginSetHash/value` | all 12 | `220c004e… → 36f911f4…` (three implementationVersion moves) |
| `/outputHash/value`, `/evidenceRecord/provenanceRecord/outputHash/value` | all 12 | the scored output moved (risk axis) |
| `/evidenceRecord/recordHash/value`, `/evidenceRecord/replayHash/value` | all 12 | consequences of the above |

## Explicitly byte-EQUAL (asserted by the differ across all 12)

`manifestHash` (the pipeline manifest is untouched), `decayParams`, `uwrProfile`, `scoredSignal.direction`/`meta.direction` (DIR-GOV D-DIR-3: the submitted side is untouched and unread by the producer), every axis other than `risk` (`structure` 0.4, `execution`, `insight` — byte-equal), `riskBucket`, `rationale`/`axisNotes`, the pattern/sentiment/news/aiMl lens payloads, the pattern/sentiment/news/aiMl `providerResultHash`/`categoryResultHash`, every `scorerInput` field other than `rrMultiplePlanned`, `canonicalUss.facts` (still exactly five keys), all six TV goldens' `canonicalUss`/`inputHash`/`ingestHash` (the TV route carries no plan), the `312da118…126e06` provenance golden and `ATLAS_MANIFEST_HASH`. No scoring-law value moved (weights, clamps, rr bands, riskBucket map untouched).

## D-DEM-5(5) residual, recorded honestly

On the CPJ route with a complete plan the risk axis is now a function of the provider's verified R:R and `brokeEmaWithBody` — the Evidence-§3 collinearity is **resolved** there. On every plan-less submission (all TradingView/MarkitTick traffic today, and CPJ submissions without a stop or target) the risk axis reads the declared floor and varies only through `brokeEmaWithBody`: **residual** until a plan carrier exists on that route (§9 determination D-5). The R:R is verified-plausible but submitter-chosen; a stop-placement validity rule would be a new threshold (§8) — a modelling filing.

---

# DEM-PRODUCER-CANDLE reconciliation — brokeEmaWithBody and haFlatBackConfirmed become computed facts (DEM-GOV §9, owner-authorized 2026-08-25)

**Authority.** DEM-GOV §9 `DEM-PRODUCER-CANDLE` — the act D5-GOV D-D5-1 expressly reserved — with §9 determinations D-2/D-3. D-DEM-7(2) authorizes the movement in class (the structure and risk axes fed by the named inputs); this section is the D-DEM-7(3) itemization. Baseline for every row below is the **`DEM-PRODUCER-PLAN` state** (the wave that merged immediately before), not the pre-slot main.

**What changed on the path.** The technical kernel computes, over the window it already fetches (no new fetch, no new provider, no new parameter): `brokeEmaWithBody` (the latest bar's body closed on the counter-trend side of EMA20; in a range regime, the body crossed EMA20 on that bar), `haFlatBack` (the Heikin-Ashi flat-back side of the latest HA bar — recurrence over the whole window, seed `(o+c)/2`, epsilon 0) and `haFlatBackConfirmed` (the flat-back agrees with the lane's own EMA20/EMA50 trend law; range → false). `viewTechnical` projects all three; mapping **1.2.0** binds `brokeEmaWithBody` and `haFlatBackConfirmed` as **required** binds (no optionality: a window below the 50-candle kernel floor emits no technical payload and the determination refuses, D-DEM-5(2)). afi-core deletes `BROKE_EMA_WITH_BODY_UNIMPLEMENTED_STUB`, its `??` read, and the `haFlatBackConfirmed: false` literal; the residual shrinks to the HTF bias placeholders + `liquiditySwept`. `implementationVersion`: technical `2.1.0 → 2.2.0`, merge `1.2.0 → 1.3.0`, scorer `1.4.0 → 1.5.0`; `pluginSetHash` `36f911f4… → 5eef1faf…`; `analystConfigHash` `5cb9b7a4… → 300783e4…` (mappingRef 1.2.0).

Goldens regenerated ONCE via `npm run oracle:regen`; audited with `node test/oracle/support/goldenDiff.mjs --ref dem/plan-reactor`.

## Per-golden scored-value movement — **the structure axis stops being a constant**

| golden | `brokeEmaWithBody` | `haFlatBackConfirmed` | `uwrAxes.structure` | `uwrAxes.risk` | `uwrScore` = `conviction` |
|---|---|---|---|---|---|
| `tv-neutral.{builtin,registry}` (SOL/USDT 15m) | false → **true** | false (unmoved) | **0.4 → 0.15** | 0.2 → **0.0** | 0.225 → 0.1125 |
| the other ten goldens | false → false (now computed) | false → false (now computed) | 0.4 (unmoved) | unmoved | unmoved |

On the SOL 15m seed the latest demo bar's body crosses EMA20 in a `range` regime, so the producer returns **true**: structure loses its `+0.15` no-break credit and takes the `−0.10` penalty (0.4 → 0.15), and risk takes the rubric's `−0.2` break penalty on top of the PLAN floor (0.2 → 0.0, clamped). **Both axes are therefore non-constant over the fixture corpus** — structure ∈ (0.4, 0.15), risk ∈ (0.5, 0.2, 0.0) — which is this slot's gate. `haFlatBackConfirmed` is `false` on all twelve **by construction**, not by literal: every demo seed's `trendBias` is `range` (the i.i.d. demo feed keeps EMA20 within 0.5% of EMA50), and a range regime has no side to confirm against. The HA branch is therefore proven by the KATs in `test/pipeline/candleStructure.test.ts` (both flat-back sides, the no-wick edge at exact equality, the doji case, seed-independence at the 50-bar floor), not by the corpus.

## Per-golden identity / payload movement

| JSON path class | goldens | why |
|---|---|---|
| `…/lenses/0/payload/{brokeEmaWithBody,haFlatBack,haFlatBackConfirmed}` and the `_priceFeedMetadata.technicalIndicators` mirror (absent → value) | all 12 | the three computed facts join the technical payload |
| `/evidenceRecord/composition/enrichmentHash/value` | all 12 | the technical lens payload gained three fields |
| `/evidenceRecord/providerInvocations/4/{providerResultHash,categoryResultHash}/value` (technical) | all 12 | the validated technical CategoryResult gained them |
| `/evidenceRecord/composition/analystConfigHash/value` | all 12 | mappingRef 1.1.0 → 1.2.0 |
| `/evidenceRecord/composition/pluginSetHash/value` | all 12 | three implementationVersion moves |
| `/scorerInput/{brokeEmaWithBody,haFlatBackConfirmed}` | 2 (`tv-neutral.*`, brokeEmaWithBody only) | the computed value differs from the retired stub on that seed alone |
| scored-value class (`uwrAxes.structure`, `uwrAxes.risk`, `uwrScore`, `conviction`, `analystScore.rationale`, both `outputHash` copies) | 2 (`tv-neutral.*`) | the axes moved on that seed |
| `/evidenceRecord/{recordHash,replayHash}/value` | all 12 | consequences of the above |

## Explicitly byte-EQUAL (asserted by the differ)

`manifestHash`; `inputHash`/`ingestHash`/`canonicalUss` on **all 12** (this slot touches no ingest surface); `executionSummaryHash` on all 12 (the fired-default set is unchanged — the candle binds are required, so they never fire a default); `decayParams`; `uwrProfile`; `riskBucket`; `scoredSignal.direction`/`meta.direction`; the `execution` and `insight` axes; the pattern/sentiment/news/aiMl lens payloads and their proofs; every other `scorerInput` field; the `312da118…126e06` provenance golden; `ATLAS_MANIFEST_HASH`. No scoring-law value moved.

## D-DEM-5(5) residual after this slot

The structure axis is no longer capped at `0.40`, but its two live terms are the sweet-spot credit and the EMA-break term; the **HTF-alignment `+0.4` term and the HA `+0.2` term remain unreachable** — the first because `weeklyBias`/`dailyBias` are still the literal `"neutral"` (that is `DEM-PRODUCER-HTF`), the second because a `range` regime cannot confirm a flat-back and the demo corpus is entirely `range`. Recorded, not hidden.

---

# DEM-PRODUCER-HTF reconciliation — real higher-timeframe bias; the structure axis passes its former 0.40 cap (DEM-GOV §9, owner-authorized 2026-08-25)

**Authority.** DEM-GOV §9 `DEM-PRODUCER-HTF` — the mission DIR-GOV D-DIR-3's scope-guard reserved — with §9 determinations D-1 (the HTF composition value and the additive `paramsSchema.htf` within plugin identity) and D-2 (adapter identity held). D-DEM-7(2) authorizes the movement in class; this section is the D-DEM-7(3) itemization. Baseline for every row is the **`DEM-PRODUCER-CANDLE` state**.

**What changed on the path.** The technical adapter reads the **registered composition value** (`nodeOverrides.technical.config.htf` = `{1d, 1w, 100}`, boot-validated against the plugin's closed `paramsSchema`) and fetches the signal window plus both higher-timeframe windows **concurrently** (`Promise.all` — this lane is the pipeline's entry node). Each HTF window is run through the SAME EMA20/EMA50 trend law and emitted as `technical.htf.{daily,weekly}` = `{timeframe, trendBias, ema20, ema50, barCount}`; a window below the 50-candle kernel floor emits **no sub-block** (declared producer absence). `viewTechnical` projects the block; mapping **1.3.0** recodes `weeklyBias`/`dailyBias` from the lane's trend vocabulary into the rubric's bias vocabulary (`bullish→long`, `bearish→short`, `range→neutral`; `absent→neutral`, a recorded default). afi-core deletes the two `"neutral" as const` literals and the residual shrinks to **`liquiditySwept` alone** — the D-DEM-4(2) inventory is empty. The rubric's `"unknown"`-direction branch semantics are resolved in-slot (see below). `implementationVersion`: technical `2.2.0 → 2.3.0`, merge `1.3.0 → 1.4.0`, scorer `1.5.0 → 1.6.0`; `pluginSetHash` `5eef1faf… → 59ff5437…`; `analystConfigHash` `300783e4… → 71de40d2…`.

**Test-only fixture change.** `test/support/deterministicPriceFeedAdapter.ts` gains a deterministic per-symbol drift applied **only to timeframes ≥ 1d** (BTC up on both; ETH up daily / down weekly; everything else flat). Timeframes below 1d are byte-untouched, so every golden's own-timeframe series, indicators and pattern facts are unchanged — verified by the differ (no `lenses/0/payload/ema20` movement).

## Per-golden scored-value movement — **the structure axis passes its former 0.40 cap**

| golden | `weeklyBias` | `dailyBias` | `uwrAxes.structure` | `uwrScore` = `conviction` | `analystScore.direction` |
|---|---|---|---|---|---|
| `cpj-blofin-perp-long.{builtin,registry}` (BTC) | neutral → **long** | neutral → **long** | 0.4 → **0.8** | 0.49167 → 0.59167 | neutral → **long** |
| `tv-long.{builtin,registry}` (BTC) | neutral → **long** | neutral → **long** | 0.4 → **0.8** | 0.41667 → 0.51667 | neutral → **long** |
| `cpj-coinbase-spot-sell.{builtin,registry}` (ETH) | neutral → **short** | neutral → **long** | 0.4 (unmoved) | unmoved | neutral → **unknown** |
| `tv-short.{builtin,registry}` (ETH) | neutral → **short** | neutral → **long** | 0.4 (unmoved) | unmoved | neutral → **unknown** |
| `cpj-blofin-perp-neutral.{builtin,registry}` (SOL) | neutral → neutral | neutral → neutral | 0.4 (unmoved) | unmoved | neutral (unmoved) |
| `tv-neutral.{builtin,registry}` (SOL) | neutral → neutral | neutral → neutral | 0.15 (unmoved) | unmoved | neutral (unmoved) |

**The gate is met.** The aligned-HTF `+0.4` structure term fires for the first time in the system's history: structure reaches **0.8** on the four BTC goldens — **beyond its former `0.40` cap** — and now spans `{0.15, 0.4, 0.8}` over the corpus. The ETH pair exercises a genuine higher-timeframe **conflict** (weekly bearish, daily bullish): the aligned term does not fire, and the analyst's verdict is `"unknown"` — the branch DIR-GOV's scope-guard reserved, now reachable, resolved, and pinned by a golden. `riskBucket` unmoved (it reads `atrRegime`). `rationale`/`axisNotes` move only where the structure note crosses its threshold.

## Per-golden identity / payload movement

| JSON path class | goldens | why |
|---|---|---|
| `…/lenses/0/payload/htf`, `…/_priceFeedMetadata/technicalIndicators/htf` (absent → object) | all 12 | the lane's HTF facts join the technical payload |
| `/scorerInput/{weeklyBias,dailyBias}` | 8 (BTC ×4, ETH ×4) | the recoded facts differ from the retired literal |
| scored-value class (`uwrAxes.structure`, `uwrScore`, `conviction`, `analystScore.direction`, `rationale`, both `outputHash` copies) | 8 | the axes/verdict moved on those seeds |
| `/evidenceRecord/composition/enrichmentHash/value` | all 12 | the technical lens payload gained `htf` |
| `/evidenceRecord/providerInvocations/4/{providerResultHash,categoryResultHash}/value` | all 12 | the validated technical CategoryResult gained `htf` |
| `/evidenceRecord/providerInvocations/4/invocationInputHash/value` | all 12 | the technical node's merged params gained the registered `htf` value |
| `/evidenceRecord/composition/{analystConfigHash,pluginSetHash}/value` | all 12 | mappingRef 1.3.0 + `nodeOverrides`; three implementationVersion moves |
| `/evidenceRecord/{recordHash,replayHash}/value` | all 12 | consequences |

## Explicitly byte-EQUAL

`manifestHash` (the pipeline manifest is untouched — the composition value rides `nodeOverrides`, §8 honored); `inputHash`/`ingestHash`/`canonicalUss` on all 12 (no ingest surface is touched); `executionSummaryHash` **except** where an HTF recode legitimately fires its `absent` member; the own-timeframe technical indicators (`ema20`, `ema50`, `rsi14`, `atr14`, `emaDistancePct`, `isInValueSweetSpot`, `atrRegime`, `brokeEmaWithBody`, `haFlatBack*`) on all 12 — the drift is confined to ≥ 1d timeframes; the pattern/sentiment/news/aiMl lens payloads and proofs; `execution`, `insight` and `risk` axes; `riskBucket`; `scoredSignal.direction`/`meta.direction` (the SUBMITTED side — unchanged and unread by the producer, DIR-GOV D-DIR-3); the `312da118…126e06` provenance golden; `ATLAS_MANIFEST_HASH`. **No scoring-law value moved.**

## D-DEM-5(5) residual after the four slots

Every scorer input is now a computed fact of a registered producer (D-DEM-5(1)); the residual is `liquiditySwept` alone, whose disposition D-DEM-3(5) expressly reserves. What remains, recorded honestly: (1) **risk on plan-less submissions** — the TradingView/MarkitTick routes carry no trade plan, so risk there is the declared floor moved only by `brokeEmaWithBody`; closing it needs a plan carrier on those routes (a separate authorization). (2) **The HA flat-back term** (+0.2) is unreachable in a `range` regime by construction of the rubric — a formula question for a modelling filing, not a placeholder. (3) **R:R is verified-plausible but submitter-chosen**: a stop-placement validity rule would be a new threshold (§8), so it belongs to a modelling filing. (4) **Symbols with fewer than 50 weekly bars** on the registered feed (listings under ~1 year) score `weeklyBias = neutral` permanently — a declared absence, not a defect, but it caps their structure at 0.6. (5) **A venue that does not offer a registered higher-timeframe window** yields that bias as a declared absence for every signal it serves: `coinbase` has **no weekly bar** (ccxt's own timeframes table), so a coinbase-backed composition scores `weeklyBias = neutral` permanently and its structure is capped at 0.6; `blofin` — the production feed — offers both `1d` and `1w`. This is a capability fact checked BEFORE the request, so the window is never asked for; a fetch that FAILS for a timeframe the venue does offer still refuses the determination (fail closed, never fall back). Found by the afi-gateway boundary proof, which runs the reactor against the real coinbase feed.
