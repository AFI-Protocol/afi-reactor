#!/usr/bin/env node
/**
 * DLC-GOV D-DLC-4 checkpoint derivation law — pure unit coverage for
 * scripts/checkpoint-reassess-lib.mjs (no Mongo, no network).
 * Run: npm run test:checkpoint-reassess
 *
 * Also validates the built artifact against the GOVERNED schema
 * (node_modules/afi-config schemas/signal-reassessment/v1) under strict
 * AJV and reproduces its seal with the canonical reference implementation —
 * the slot gate's schema-validation and sealing clauses, exercised on the
 * actual builder output.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  REASSESSMENT_SCHEMA_ID,
  REASSESSMENT_DOMAIN_TAG,
  READING_RULE,
  buildReassessment,
  canonicalize,
  checkpointEligibility,
  classifyOutcome,
  horizonMinutes,
  overallReading,
  sealReassessment,
} from "../../scripts/checkpoint-reassess-lib.mjs";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n      actual:   ${a}\n      expected: ${e}`);
  }
}
function throws(fn, pattern, label) {
  try {
    fn();
    failures++;
    console.error(`  ✗ ${label} — did not throw`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (pattern.test(msg)) {
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.error(`  ✗ ${label} — threw '${msg}', wanted ${pattern}`);
    }
  }
}

// --- fixtures ---------------------------------------------------------------
const NOW = "2026-08-24T12:00:00.000Z";
function ctxFixture(overrides = {}) {
  return {
    schema: "afi.operational.scoring-context.v0",
    signalId: "sig-checkpoint-test-1",
    capturedAt: "2026-08-24T00:00:05.000Z",
    scoredAt: "2026-08-24T00:00:00.000Z",
    meta: { symbol: "BTCUSDT", timeframe: "1h", strategy: "trend_pullback_v1", direction: "long" },
    decayParams: { halfLifeMinutes: 720, greeksTemplateId: "decay-ratio-v1", barsPerHalfLife: 12 },
    ...overrides,
  };
}
function rowsFixture() {
  return [
    {
      horizon: "12h",
      horizonBasis: "decay-derived",
      decayRef: { greeksTemplateId: "decay-ratio-v1", halfLifeMinutes: 720, fractionOfHalfLife: 1 },
      evaluatedAt: "2026-08-24T12:05:00.000Z",
      entryPrice: 65000,
      exitPrice: 64675,
      returnPct: -0.5,
      signedReturnPct: -0.5,
      mfePct: 1.5,
      maePct: -0.8,
    },
    {
      horizon: "3h",
      horizonBasis: "decay-derived",
      decayRef: { greeksTemplateId: "decay-ratio-v1", halfLifeMinutes: 720, fractionOfHalfLife: 0.25 },
      evaluatedAt: "2026-08-24T03:05:00.000Z",
      entryPrice: 65000,
      exitPrice: 65390,
      returnPct: 0.6,
      signedReturnPct: 0.6,
      mfePct: 0.9,
      maePct: -0.2,
    },
    {
      horizon: "6h",
      horizonBasis: "decay-derived",
      decayRef: { greeksTemplateId: "decay-ratio-v1", halfLifeMinutes: 720, fractionOfHalfLife: 0.5 },
      evaluatedAt: "2026-08-24T06:05:00.000Z",
      entryPrice: 65000,
      exitPrice: 65845,
      returnPct: 1.3,
      signedReturnPct: 1.3,
      mfePct: 1.5,
      maePct: -0.2,
    },
  ];
}

console.log("checkpointEligibility (D-DLC-4(1), fail-closed):");
eq(checkpointEligibility(ctxFixture({ decayParams: null }), Date.parse(NOW)).eligible, false, "null decayParams never eligible");
eq(checkpointEligibility(ctxFixture({ decayParams: null }), Date.parse(NOW)).reason, "no-stamped-decay-params", "…with the fail-closed reason");
eq(checkpointEligibility(ctxFixture({ scoredAt: "garbage" }), Date.parse(NOW)).eligible, false, "unparseable scoredAt never eligible");
eq(checkpointEligibility(ctxFixture(), Date.parse("2026-08-24T11:59:00.000Z")).eligible, false, "1 minute before the half-life: not eligible");
eq(checkpointEligibility(ctxFixture(), Date.parse(NOW)).eligible, true, "exactly AT the half-life: eligible (at/post)");
eq(checkpointEligibility(ctxFixture(), Date.parse("2026-08-25T00:00:00.000Z")).eligible, true, "post half-life: eligible");

console.log("classifyOutcome (rule signedReturnPct-sign-v1):");
eq(classifyOutcome(0.6), "favorable", "+0.6 → favorable");
eq(classifyOutcome(-0.5), "adverse", "−0.5 → adverse");
eq(classifyOutcome(0), "flat", "0 → flat");
eq(classifyOutcome(null), "indeterminate", "null (neutral) → indeterminate");
eq(classifyOutcome(NaN), "indeterminate", "NaN → indeterminate (never a guess)");

console.log("overallReading:");
eq(overallReading(["favorable", "favorable"]), "confirmed", "all favorable → confirmed");
eq(overallReading(["adverse", "adverse", "adverse"]), "contradicted", "all adverse → contradicted");
eq(overallReading(["favorable", "adverse"]), "mixed", "split → mixed");
eq(overallReading(["favorable", "flat"]), "mixed", "favorable+flat → mixed");
eq(overallReading(["indeterminate", "indeterminate"]), "indeterminate", "nothing determinate → indeterminate");
eq(overallReading(["indeterminate", "favorable"]), "confirmed", "indeterminates excluded from the overall");

console.log("horizonMinutes (DH-GOV label grammar):");
eq(horizonMinutes("15m"), 15, "15m");
eq(horizonMinutes("12h"), 720, "12h");
eq(horizonMinutes("12hours"), null, "bad label → null");

console.log("buildReassessment — the sealed artifact:");
const artifact = buildReassessment(ctxFixture(), rowsFixture(), NOW);
eq(artifact.schema, REASSESSMENT_SCHEMA_ID, "schema id");
eq(
  Object.keys(artifact).sort(),
  ["checkpointTime", "horizonsRead", "realizedFigures", "reassessmentReading", "schema", "seal", "signalId"],
  "member set EXHAUSTIVE (D-DLC-4(3)) — nothing more"
);
eq(artifact.checkpointTime, { scoredAt: "2026-08-24T00:00:00.000Z", checkpointAt: NOW, elapsedMinutes: 720, halfLifeMinutes: 720 }, "checkpointTime self-proving");
eq(artifact.horizonsRead.map((h) => h.horizon), ["3h", "6h", "12h"], "horizons sorted by length");
eq(artifact.horizonsRead[0].fractionOfHalfLife, 0.25, "fractionOfHalfLife carried from decayRef");
eq(
  artifact.realizedFigures[2],
  { horizon: "12h", evaluatedAt: "2026-08-24T12:05:00.000Z", entryPrice: 65000, exitPrice: 64675, returnPct: -0.5, signedReturnPct: -0.5, mfePct: 1.5, maePct: -0.8 },
  "realization copied VERBATIM (D-DLC-4(2))"
);
eq(artifact.reassessmentReading.direction, "long", "asserted direction copied");
eq(artifact.reassessmentReading.rule, READING_RULE, "governed rule const");
eq(artifact.reassessmentReading.perHorizon.map((p) => p.outcome), ["favorable", "favorable", "adverse"], "deterministic per-horizon reading");
eq(artifact.reassessmentReading.overall, "mixed", "deterministic overall");
eq(artifact.seal.domainTag, REASSESSMENT_DOMAIN_TAG, "seal domain tag carried");

// seal reproduces under the reference impl (top-level 'seal' excluded)
{
  const stripped = {};
  for (const k of Object.keys(artifact)) if (k !== "seal") stripped[k] = artifact[k];
  const recomputed = createHash("sha256").update(Buffer.from(canonicalize(stripped), "utf-8")).digest("hex");
  eq(artifact.seal.value, recomputed, "seal.value reproduces (canonical-json-hashing.v1, 'seal' excluded)");
}

// re-sealing is idempotent on the sealed content
eq(sealReassessment(artifact).seal.value, artifact.seal.value, "sealing is deterministic");

console.log("neutral assertion:");
const neutralRows = rowsFixture().map((r) => ({ ...r, signedReturnPct: null }));
const neutralArtifact = buildReassessment(ctxFixture({ meta: { direction: "neutral" } }), neutralRows, NOW);
eq(neutralArtifact.reassessmentReading.perHorizon.every((p) => p.outcome === "indeterminate"), true, "neutral → all indeterminate");
eq(neutralArtifact.reassessmentReading.overall, "indeterminate", "neutral → overall indeterminate");
eq(neutralArtifact.reassessmentReading.direction, "neutral", "missing/neutral direction recorded as neutral");

console.log("refusals (log-and-skip at the caller; never a guessed artifact):");
throws(() => buildReassessment(ctxFixture(), [], NOW), /no captured outcome rows/, "zero rows refuses");
throws(() => buildReassessment(ctxFixture(), rowsFixture(), "2026-08-24T06:00:00.000Z"), /not checkpoint-eligible/, "pre-half-life refuses");
throws(() => buildReassessment(ctxFixture({ decayParams: null }), rowsFixture(), NOW), /not checkpoint-eligible/, "stampless refuses (fail-closed)");
throws(
  () => buildReassessment(ctxFixture(), [{ ...rowsFixture()[0], horizon: "12hours" }], NOW),
  /unrecognized horizon label/,
  "bad horizon label refuses"
);

console.log("operator-override rows:");
const overrideRows = rowsFixture().map(({ decayRef, ...r }) => ({ ...r, horizonBasis: "operator-override" }));
const overrideArtifact = buildReassessment(ctxFixture(), overrideRows, NOW);
eq(
  Object.keys(overrideArtifact.horizonsRead[0]).sort(),
  ["horizon", "horizonBasis"],
  "no fractionOfHalfLife member without a decayRef"
);

console.log("governed-schema validation (afi-config sibling contract):");
const SCHEMA_PATH = new URL(
  "../../node_modules/afi-config/schemas/signal-reassessment/v1/signal-reassessment.schema.json",
  import.meta.url
).pathname;
const HASH_SCHEMA_PATH = new URL(
  "../../node_modules/afi-config/schemas/provenance/v1/canonical-hash.schema.json",
  import.meta.url
).pathname;
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
  ajv.addVocabulary([
    "x-afiStatus",
    "x-afiPartOf",
    "x-afiDoctrineRefs",
    "x-afiOpenItems",
    "x-afiProposedNotAccepted",
    "x-afiConstraints",
  ]);
  ajv.addSchema(JSON.parse(readFileSync(HASH_SCHEMA_PATH, "utf-8")));
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")));
  for (const [label, doc] of [
    ["mixed long artifact", artifact],
    ["neutral artifact", neutralArtifact],
    ["operator-override artifact", overrideArtifact],
  ]) {
    const ok = validate(doc);
    if (!ok) {
      failures++;
      console.error(`  ✗ ${label} rejected by the governed schema:`, validate.errors);
    } else {
      console.log(`  ✓ ${label} validates against afi.signal-reassessment.v1`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nall checkpoint derivation checks passed.");
