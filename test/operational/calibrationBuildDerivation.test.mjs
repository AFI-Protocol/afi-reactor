#!/usr/bin/env node
/**
 * CAL-GOV D-CAL-1 … D-CAL-4 calibration derivation law — pure unit coverage for
 * scripts/calibration-build-lib.mjs (no Mongo, no network).
 * Run: npm run test:calibration-build
 *
 * (1) Synthetic units: the rounding law, cluster assignment, verify-on-read
 *     exclusion, supersession exclusion, magnitude-convention exclusion,
 *     neutral handling, status vocabulary, no-scalar / no-PoI-PoInsight keys.
 * (2) The 2026-08-24 corpus fixture (186 sealed reassessments joined to
 *     fixture-sealed trimmed evidence records): the CAL-BUILDER gate figures.
 * (3) Governed-schema validation of every built record against the sibling
 *     afi-config afi.analyst-calibration.v1 contract + seal reproduction.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  CALIBRATION_SCHEMA_ID,
  CALIBRATION_DOMAIN_TAG,
  assignClusters,
  buildAllCalibrationRecords,
  buildCalibrationRecord,
  canonicalize,
  evidenceRecordHashVerifies,
  joinRow,
  keyString,
  reassessmentSealVerifies,
  round6,
  sha256Canonical,
} from "../../scripts/calibration-build-lib.mjs";

const require = createRequire(import.meta.url);
let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}\n      actual:   ${a}\n      expected: ${e}`);
  }
}
function ok(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

console.log("rounding law (D-CAL-1(5)):");
eq(round6(1 / 128), 0.007812, "dyadic tie 1/128 rounds half-even DOWN (not toFixed's 0.007813)");
eq(round6(3 / 128), 0.023438, "dyadic tie 3/128 rounds half-even UP (odd sixth digit)");
eq(round6(0.4893617021276596), 0.489362, "69/141 → 0.489362");
eq(round6(-0.5499064), -0.549906, "negative rounds toward even magnitude");
eq(round6(2.0000005), 2.000001, "non-tie above half rounds up (binary value is slightly above)");
eq(round6(7), 7, "integers pass through");

console.log("clusters (D-CAL-3(1)(i)):");
const mk = (mins) => mins.map((m, i) => ({ signalId: `s${i}`, scoredAtMs: m * 60_000 }));
eq(assignClusters(mk([0, 30, 59, 119, 200]), 60), [0, 0, 0, 1, 2], "|Δt| < H chains; gap ≥ H splits (strict)");
eq(assignClusters(mk([0, 60]), 60), [0, 1], "exactly H apart is NOT an overlap");

// --- synthetic evidence/reassessment factories --------------------------------
function evidenceFixture(signalId, overrides = {}) {
  const e = {
    schema: "afi.scored-signal-evidence.v3",
    signalId,
    analystId: "froggy",
    strategyId: "trend_pullback_v1",
    strategyVersion: "1.0.0",
    scoredSignal: { uwrScore: 0.5, riskBucket: "medium", providerId: "p", direction: "long" },
    composition: {
      pipelineId: "froggy-trend-pullback",
      pipelineVersion: "v1.3.0",
      manifestHash: { value: "a".repeat(64) },
      analystConfigHash: { value: "b".repeat(64) },
      scorerPluginId: "froggy.trend_pullback_v1",
      scorerPluginVersion: "1.0.0",
      pluginSetHash: { value: "c".repeat(64) },
    },
    uwrProfile: { profileId: "uwr-weighted-lifts-v0.1", source: "builtin-value-identity" },
    ...overrides,
  };
  const pre = { ...e };
  delete pre.recordVersion;
  e.recordHash = { algorithm: "sha256", canonicalizationVersion: "afi.hash.v1", domainTag: "afi.d2.evidence-record", value: sha256Canonical(pre) };
  return e;
}
function reassessmentFixture(signalId, scoredAt, direction, signed, overrides = {}) {
  const fig = (h, s) => ({ horizon: h, evaluatedAt: scoredAt, entryPrice: 100, exitPrice: 100 + s, returnPct: s, signedReturnPct: s, mfePct: Math.max(0, s) + 0.1, maePct: Math.max(0, -s) + 0.1 });
  const out = (s) => (s === null ? "indeterminate" : s > 0 ? "favorable" : s < 0 ? "adverse" : "flat");
  const doc = {
    schema: "afi.signal-reassessment.v1",
    signalId,
    checkpointTime: { scoredAt, checkpointAt: "2026-08-24T22:26:33.088Z", elapsedMinutes: 20000, halfLifeMinutes: 60 },
    horizonsRead: [
      { horizon: "15m", horizonBasis: "decay-derived", fractionOfHalfLife: 0.25 },
      { horizon: "30m", horizonBasis: "decay-derived", fractionOfHalfLife: 0.5 },
      { horizon: "1h", horizonBasis: "decay-derived", fractionOfHalfLife: 1 },
    ],
    realizedFigures: [fig("15m", signed), fig("30m", signed), fig("1h", signed)],
    reassessmentReading: {
      direction,
      rule: "signedReturnPct-sign-v1",
      perHorizon: [
        { horizon: "15m", outcome: out(signed) },
        { horizon: "30m", outcome: out(signed) },
        { horizon: "1h", outcome: out(signed) },
      ],
      overall: signed === null ? "indeterminate" : signed > 0 ? "confirmed" : signed < 0 ? "contradicted" : "mixed",
    },
    ...overrides,
  };
  const stripped = { ...doc };
  delete stripped.seal;
  doc.seal = { algorithm: "sha256", canonicalizationVersion: "afi.hash.v1", domainTag: "afi.checkpoint.signal-reassessment", value: sha256Canonical(stripped) };
  return doc;
}

console.log("verify-on-read + exclusions (D-CAL-1(2), D-CAL-1(6), D-CAL-4(2)):");
{
  const sid = "btcusdt-5m-trend-pullback-v1-long-2026-08-06T07:20:06Z";
  const e = evidenceFixture(sid);
  const r = reassessmentFixture(sid, "2026-08-06T07:20:07.143Z", "long", 0.2);
  ok(reassessmentSealVerifies(r) && evidenceRecordHashVerifies(e), "synthetic seal + recordHash verify");
  ok(joinRow(r, e, new Set()).row, "clean join produces a row");
  eq(joinRow(r, undefined, new Set()).exclude, "unverifiableInput", "missing evidence → unverifiableInput");
  const tampered = { ...e, analystId: "someone-else" };
  eq(joinRow(r, tampered, new Set()).exclude, "unverifiableInput", "tampered evidence (hash mismatch) → unverifiableInput");
  const badSeal = { ...r, seal: { ...r.seal, value: "0".repeat(64) } };
  eq(joinRow(badSeal, e, new Set()).exclude, "unverifiableInput", "broken reassessment seal → unverifiableInput");
  eq(joinRow(r, evidenceFixture(sid, { recordVersion: 2 }), new Set()).exclude, "supersededSinceCheckpoint", "recordVersion > 1 → supersededSinceCheckpoint");
  eq(joinRow(r, e, new Set([sid])).exclude, "supersededSinceCheckpoint", "history entry → supersededSinceCheckpoint");
  const viol = reassessmentFixture(sid, "2026-08-06T07:20:07.143Z", "long", 0.2, {});
  viol.realizedFigures[2].mfePct = 0.05; // signed 0.2 > mfe 0.05
  const strippedV = { ...viol };
  delete strippedV.seal;
  viol.seal = { ...viol.seal, value: sha256Canonical(strippedV) };
  eq(joinRow(viol, e, new Set()).exclude, "magnitudeConventionViolation", "signed > mfePct → magnitudeConventionViolation");
  const row = joinRow(r, e, new Set()).row;
  eq(row.symbol, "btcusdt", "symbol is signalId-derived");
  eq(row.timeframe, "5m", "timeframe is signalId-derived");
  eq(row.key.halfLifeMinutes, 60, "key halfLife comes from the sealed reassessment");
}

console.log("small-group record (status vocabulary, neutral handling, no scalar):");
{
  const rows = [];
  const exclusions = { unverifiableInput: 1, supersededSinceCheckpoint: 0, magnitudeConventionViolation: 0 };
  for (let i = 0; i < 12; i++) {
    const dir = i % 3 === 2 ? "neutral" : i % 2 ? "short" : "long";
    const sid = `btcusdt-5m-trend-pullback-v1-${dir}-2026-08-06T0${i}:00:00Z`;
    const signed = dir === "neutral" ? null : i % 4 === 0 ? -0.3 : 0.4;
    const e = evidenceFixture(sid, { scoredSignal: { uwrScore: 0.3 + 0.05 * (i % 5), riskBucket: i % 2 ? "low" : "high", providerId: "p", direction: dir } });
    const r = reassessmentFixture(sid, `2026-08-06T${String(i * 2).padStart(2, "0")}:00:00.000Z`, dir, signed);
    rows.push(joinRow(r, e, new Set()).row);
  }
  const rec = buildCalibrationRecord(rows[0].key, rows, null, exclusions);
  eq(rec.schema, CALIBRATION_SCHEMA_ID, "schema id");
  eq(rec.seal.domainTag, CALIBRATION_DOMAIN_TAG, "domain tag");
  eq(rec.n, 12, "n");
  eq(rec.provenance.directions, { long: 4, short: 4, neutral: 4 }, "direction counts incl. neutral");
  eq(rec.readings.perF["1"].indeterminate, 4, "neutral rows → indeterminate");
  eq(rec.realized["1"].win.n, 8, "realized denominator excludes null-signed rows");
  eq(rec.realized["1"].win.status, "insufficient", "n < 100 → insufficient");
  ok(rec.realized["1"].win.rate === undefined && rec.realized["1"].win.interval === undefined, "insufficient carries counts only");
  eq(rec.rank["1"].status, "insufficient", "rank insufficient below 100");
  ok(rec.rank["1"].claim === undefined, "no claim under insufficient");
  eq(rec.provenance.exclusions.unverifiableInput, 1, "exclusion counter carried");
  eq(rec.attribution, "corpus", "one symbol, < 28 days → corpus");
  eq(rec.supersedes, null, "first record supersedes null");
  ok(rec.reliability["1"].length === 20 && rec.reliability["1"].every((b, k) => b.k === k), "twenty bins in order");
  const keys = [];
  const walk = (o) => { if (o && typeof o === "object") for (const k of Object.keys(o)) { keys.push(k); walk(o[k]); } };
  walk(rec);
  eq(keys.filter((k) => /(^|[^a-z])(poi|poinsight|reputation|rep_?t)([^a-z]|$)/i.test(k)), [], "no PoI / PoInsight / reputation member anywhere (D-CAL-5)");
  // supersession by a second run whose previous provenance stamps a different recordHash
  const prev = { ...rec, provenance: { ...rec.provenance, signalIds: rec.provenance.signalIds.map((p, i) => (i === 0 ? { ...p, recordHash: "d".repeat(64) } : p)) } };
  const rec2 = buildCalibrationRecord(rows[0].key, rows, prev, exclusions);
  eq(rec2.n, 11, "drifted recordHash excluded on the next run");
  eq(rec2.provenance.exclusions.supersededSinceCalibration, 1, "…and counted under supersededSinceCalibration");
  eq(rec2.supersedes, rec.seal.value, "supersedes links the previous seal");
  // determinism: rebuilding yields the identical seal
  eq(buildCalibrationRecord(rows[0].key, [...rows].reverse(), null, exclusions).seal.value, rec.seal.value, "input order does not change the seal (accumulation order law)");
}

console.log("corpus fixture (2026-08-24) — the CAL-BUILDER gate figures:");
const FIX = new URL("../fixtures/calibration/corpus-2026-08-24.json", import.meta.url).pathname;
const fix = JSON.parse(readFileSync(FIX, "utf-8"));
const Em = new Map(fix.evidence.map((e) => [e.signalId, e]));
const { records, excludedUnkeyed } = buildAllCalibrationRecords(fix.reassessments, Em, new Set(fix.historyIds), new Map());
eq(excludedUnkeyed, { unverifiableInput: 0, supersededSinceCheckpoint: 0, magnitudeConventionViolation: 0 }, "186/186 join (fixture-sealed evidence verifies)");
const h60 = records.find((r) => r.groupKey.halfLifeMinutes === 60);
const h180 = records.find((r) => r.groupKey.halfLifeMinutes === 180);
eq(records.length, 2, "two keys");
eq([h60.n, h180.n], [141, 45], "group n 141 / 45");
eq(h60.provenance.directions, { long: 71, short: 70, neutral: 0 }, "H=60 directions 71/70");
eq(h180.provenance.directions, { long: 45, short: 0, neutral: 0 }, "H=180 directions 45/0");
eq(h60.readings.overall, { confirmed: 41, contradicted: 43, mixed: 57, indeterminate: 0 }, "H=60 overall 41/57/43/0");
eq(h180.readings.overall, { confirmed: 10, contradicted: 15, mixed: 20, indeterminate: 0 }, "H=180 overall 10/20/15/0");
eq([h60.realized["1"].win.count, h60.realized["1"].win.rate], [69, 0.489362], "win 69/141 = 0.489362");
eq(h60.realized["1"].win.se, 0.029567, "cluster-robust SE 0.029567");
eq([h60.rank["1"].rho, h60.rank["1"].interval], [0.037435, [-0.118875, 0.191934]], "ρ 0.037435 [−0.118875, 0.191934]");
eq(h60.rank["1"].claim, "insufficient-for-claim", "ρ claim insufficient below 200");
for (const f of ["0.25", "0.5", "1"]) eq(h60.reliability[f].filter((b) => b.status === "sealed").map((b) => b.k), [7, 8, 10, 11], `sealed bins k=7,8,10,11 at f=${f}`);
eq([h60.dependence.clusters, h60.dependence.withNeighbour, h60.dependence.pairedOpposite, h60.dependence.greedyNonOverlap], [57, 107, 107, 69], "H=60 dependence G/withNeighbour/pairedOpposite/greedy");
eq(h60.dependence.perFraction["1"].lag1Autocorrelation.value, -0.549906, "H=60 lag-1 −0.549906");
eq([h180.dependence.clusters, h180.dependence.withNeighbour, h180.dependence.pairedOpposite, h180.dependence.greedyNonOverlap], [20, 32, 0, 23], "H=180 dependence");
eq(h180.dependence.perFraction["1"].designEffect.value, 1.28692, "H=180 design effect 1.286920");
ok(h180.realized["1"].win.status === "insufficient" && h180.rank["1"].status === "insufficient" && h180.reliability["1"].every((b) => b.status === "insufficient"), "H=180 seals counts only");
// alternation: 141 runs over 141 signals
{
  const rows = fix.reassessments.filter((r) => r.checkpointTime.halfLifeMinutes === 60).sort((a, b) => a.checkpointTime.scoredAt < b.checkpointTime.scoredAt ? -1 : 1);
  let runs = 1;
  for (let i = 1; i < rows.length; i++) if (rows[i].reassessmentReading.direction !== rows[i - 1].reassessmentReading.direction) runs++;
  eq(runs, 141, "141-run long/short alternation");
}

console.log("governed-schema validation (afi-config sibling contract):");
const SCHEMA_PATH = new URL("../../node_modules/afi-config/schemas/analyst-calibration/v1/analyst-calibration.schema.json", import.meta.url).pathname;
const HASH_SCHEMA_PATH = new URL("../../node_modules/afi-config/schemas/provenance/v1/canonical-hash.schema.json", import.meta.url).pathname;
if (!existsSync(SCHEMA_PATH)) {
  failures++;
  console.error("  ✗ governed schema missing from node_modules/afi-config — merge order broken (schema family must land first)");
} else {
  const AjvMod = require("ajv");
  const Ajv = AjvMod.default ?? AjvMod;
  const addFormatsMod = require("ajv-formats");
  const addFormats = addFormatsMod.default ?? addFormatsMod;
  const ajv = new Ajv({ strict: true, allowUnionTypes: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  ajv.addVocabulary(["x-afiStatus", "x-afiPartOf", "x-afiDoctrineRefs", "x-afiOpenItems", "x-afiProposedNotAccepted", "x-afiConstraints"]);
  ajv.addSchema(JSON.parse(readFileSync(HASH_SCHEMA_PATH, "utf-8")));
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")));
  for (const rec of records) {
    const label = `H=${rec.groupKey.halfLifeMinutes}`;
    if (!validate(rec)) {
      failures++;
      console.error(`  ✗ ${label} rejected by the governed schema:`, validate.errors);
    } else console.log(`  ✓ ${label} validates against afi.analyst-calibration.v1`);
    const stripped = { ...rec };
    delete stripped.seal;
    eq(createHash("sha256").update(Buffer.from(canonicalize(stripped), "utf-8")).digest("hex"), rec.seal.value, `${label} seal reproduces`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nall calibration derivation checks passed.");
