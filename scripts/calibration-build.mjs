#!/usr/bin/env node
/**
 * CAL-GOV CAL-BUILDER (D-CAL-1 … D-CAL-4) — the analyst calibration builder:
 * the FIRST consumer of signal_reassessments as an aggregate.
 *
 * For every grouping key (D-CAL-2) present among the sealed
 * afi.signal-reassessment.v1 artifacts, this job joins each reassessment to
 * its SEALED evidence record on the canonical evidence plane (read-only;
 * D-CAL-1(2)), VERIFIES both on read (seal.value and recordHash recomputed —
 * D-CFG-2(2); an unverifiable input is excluded and counted, never
 * substituted), applies the D-CAL-4 supersession rules against the evidence
 * history collection and the previous calibration record for the key, and
 * appends ONE sealed afi.analyst-calibration.v1 record per key whose consumed
 * set changed — AJV-validated against the governed schema before every insert
 * — to analyst_calibrations. Nothing is ever taken from the analytics copy
 * (scoring_context).
 *
 * Custody prerequisite: the job's credential needs READ on the evidence
 * database in addition to readWrite on the analytics database (the
 * checkpoint job's pattern). The evidence plane is never written by this job.
 *
 * Store surface + writer (MONGO-GOV honored, named per the slot gate):
 * analyst_calibrations lives in the ANALYTICS database (default
 * afi_signal_analytics) — beside, never inside, the canonical evidence
 * plane; THIS SCRIPT is its only writer. Append-only, insert-only, never
 * overwritten (unique index on seal.value); each record links its
 * predecessor for the same key via `supersedes`. Reassessments and scored
 * records are never touched.
 *
 * NEVER a scalar; names no member as PoI or PoInsight (D-CAL-5).
 *
 * Usage: node scripts/calibration-build.mjs
 *   Optional: --db afi_signal_analytics   --evidence-db afi_scored_signal_evidence
 *             --dry-run   --out <dir>  (dry-run only: write each record as JSON)
 * Env: AFI_EVIDENCE_MONGODB_URI (required; same cluster, analytics db),
 *      AFI_ANALYTICS_DB_NAME (default afi_signal_analytics),
 *      AFI_EVIDENCE_DB_NAME (default afi_scored_signal_evidence).
 *
 * Scheduling is deployment configuration outside this repo, exactly like
 * the checkpoint job. CAL-GOV authorizes no deployment; wiring a Cloud Run
 * job for this script is a separate operational act.
 */
import { MongoClient } from "mongodb";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { buildAllCalibrationRecords, keyString } from "./calibration-build-lib.mjs";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DRY = args.includes("--dry-run");
const OUT = argOf("--out", null);
const DB = argOf("--db", process.env.AFI_ANALYTICS_DB_NAME || "afi_signal_analytics");
const EVIDENCE_DB = argOf("--evidence-db", process.env.AFI_EVIDENCE_DB_NAME || "afi_scored_signal_evidence");
const EVIDENCE_COLLECTION = "scored_signal_evidence";
const HISTORY_COLLECTION = "scored_signal_evidence_history";

if (OUT && !DRY) {
  console.error("FATAL: --out is a dry-run-only option (records are written to the store, not to files).");
  process.exit(1);
}
const URI = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!URI) {
  console.error("FATAL: AFI_EVIDENCE_MONGODB_URI is required (same cluster; analytics db).");
  process.exit(1);
}

// The governed schema is a HARD startup requirement: a sealed record is
// never written unvalidated, so no schema means no run.
const SCHEMA_PATH = new URL(
  "../node_modules/afi-config/schemas/analyst-calibration/v1/analyst-calibration.schema.json",
  import.meta.url
).pathname;
const HASH_SCHEMA_PATH = new URL(
  "../node_modules/afi-config/schemas/provenance/v1/canonical-hash.schema.json",
  import.meta.url
).pathname;
if (!existsSync(SCHEMA_PATH)) {
  console.error("FATAL: governed afi.analyst-calibration.v1 schema missing from node_modules/afi-config.");
  process.exit(1);
}
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
const validateCalibration = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")));

const client = new MongoClient(URI);
await client.connect();
const db = client.db(DB);
const reassessments = db.collection("signal_reassessments");
const calibrations = db.collection("analyst_calibrations");
// READ-ONLY handles on the canonical evidence plane (D-CAL-1(2)) — this job
// never writes them (MONGO-GOV D-MONGO-3 sole-writer honored).
const evidence = client.db(EVIDENCE_DB).collection(EVIDENCE_COLLECTION);
const history = client.db(EVIDENCE_DB).collection(HISTORY_COLLECTION);
if (!DRY) {
  await calibrations.createIndex({ "seal.value": 1 }, { unique: true, name: "seal_unique" });
}

let written = 0;
let unchanged = 0;
let failed = 0;
let exitCode = 0;
try {
  const R = await reassessments.find({}).toArray();
  const ids = R.map((r) => r.signalId);
  const E = await evidence.find({ signalId: { $in: ids } }).toArray();
  const Em = new Map(E.map((e) => [e.signalId, e]));
  const historyIds = new Set(
    (await history.find({ signalId: { $in: ids } }, { projection: { signalId: 1 } }).toArray()).map((h) => h.signalId)
  );
  // previous record per key = the latest in each key's supersedes chain
  const previousByKey = new Map();
  for await (const c of calibrations.find({})) {
    const ks = keyString(c.groupKey);
    const prev = previousByKey.get(ks);
    if (!prev) previousByKey.set(ks, c);
    else if (c.supersedes === prev.seal?.value) previousByKey.set(ks, c);
    else if (prev.supersedes === c.seal?.value) {
      /* keep prev */
    } else {
      // chain ambiguity: prefer the one no other record supersedes (computed below)
      previousByKey.set(ks, [prev, c]);
    }
  }
  for (const [ks, v] of previousByKey) {
    if (Array.isArray(v)) {
      const all = await calibrations.find({}).toArray();
      const superseded = new Set(all.map((x) => x.supersedes).filter(Boolean));
      const heads = v.filter((x) => !superseded.has(x.seal?.value));
      previousByKey.set(ks, heads[0] ?? v[0]);
    }
  }

  const { records, excludedUnkeyed } = buildAllCalibrationRecords(R, Em, historyIds, previousByKey);
  console.log(
    `inputs: reassessments=${R.length} evidence=${E.length} history=${historyIds.size} ` +
      `unkeyed-exclusions=${JSON.stringify(excludedUnkeyed)}`
  );
  if (OUT) mkdirSync(OUT, { recursive: true });

  for (const rec of records) {
    try {
      if (!validateCalibration(rec)) {
        throw new Error(`built record rejected by the governed schema: ${JSON.stringify(validateCalibration.errors)}`);
      }
      const ks = keyString(rec.groupKey);
      const prev = previousByKey.get(ks);
      // D-CAL-4(1): append only when the consumed set changed.
      if (prev && prev.seal?.value) {
        const prevIds = (prev.provenance?.signalIds ?? []).map((p) => `${p.signalId}:${p.recordHash}`).join(",");
        const curIds = rec.provenance.signalIds.map((p) => `${p.signalId}:${p.recordHash}`).join(",");
        if (prevIds === curIds && prev.n === rec.n) {
          unchanged++;
          console.log(`= ${rec.groupKey.analystId}/${rec.groupKey.strategyId}@${rec.groupKey.strategyVersion}/H=${rec.groupKey.halfLifeMinutes}: unchanged (n=${rec.n})`);
          continue;
        }
      }
      const label =
        `${rec.groupKey.analystId}/${rec.groupKey.strategyId}@${rec.groupKey.strategyVersion}/H=${rec.groupKey.halfLifeMinutes}: ` +
        `n=${rec.n} attribution=${rec.attribution} win@1=${rec.realized["1"].win.count}/${rec.realized["1"].win.n} ` +
        `(${rec.realized["1"].win.status}) rank@1=${rec.rank["1"].status}`;
      if (DRY) {
        if (OUT) {
          const fn = `${rec.groupKey.analystId}-${rec.groupKey.strategyId}-${rec.groupKey.strategyVersion}-H${rec.groupKey.halfLifeMinutes}-${rec.seal.value.slice(0, 12)}.json`;
          writeFileSync(join(OUT, fn), JSON.stringify(rec, null, 2) + "\n");
        }
        console.log(`[dry-run] would append calibration ${label} (seal ${rec.seal.value.slice(0, 12)}…)`);
        written++;
        continue;
      }
      try {
        await calibrations.insertOne(rec);
      } catch (insertErr) {
        if (insertErr && insertErr.code === 11000) {
          unchanged++;
          continue;
        }
        throw insertErr;
      }
      written++;
      console.log(`✓ ${label} (seal ${rec.seal.value.slice(0, 12)}…)`);
    } catch (err) {
      failed++;
      console.error(`✗ ${keyString(rec?.groupKey ?? {})}: ${err instanceof Error ? err.message : err}`);
    }
  }
} catch (err) {
  failed++;
  console.error(`✗ run failure: ${err instanceof Error ? err.message : err}`);
} finally {
  await client.close().catch(() => {});
}
console.log(
  `calibration-build done: written=${written} unchanged=${unchanged} failed=${failed}${DRY ? " (dry-run)" : ""}`
);
// Exit codes are trusted over summary text (workspace law): ANY failure is a red run.
exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
