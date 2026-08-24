#!/usr/bin/env node
/**
 * DLC-GOV DLC-CHECKPOINT (D-DLC-4) — the half-life checkpoint reader:
 * the FIRST consumer of signal_outcomes.
 *
 * For every scoring_context document that is checkpoint-eligible
 * (elapsed since the sealed scoredAt >= the stamped halfLifeMinutes,
 * D-DLC-4(1)) and has no reassessment yet, this job reads the sealed
 * assertion (analytics copy) plus that signal's captured signal_outcomes
 * rows (DH-GOV {H/4, H/2, H} law — CONSUMED, never changed) and appends
 * ONE sealed afi.signal-reassessment.v1 artifact to signal_reassessments.
 *
 * Store surface + writer (MONGO-GOV honored, named per the slot gate):
 * signal_reassessments lives in the ANALYTICS database (default
 * afi_signal_analytics) — beside, never inside, the canonical evidence
 * plane; THIS SCRIPT is its only writer. Append-only, one artifact per
 * signalId (unique index), insert-only, never overwritten. The scored
 * record is never touched.
 *
 * Human or automated, same contract (D-DLC-4(4)): this job emits exactly
 * the artifact a human validator would; validator identity is expressly
 * NOT a member of the artifact.
 *
 * Usage: node scripts/checkpoint-reassess.mjs
 *   Optional: --db afi_signal_analytics   --now <ISO>   --limit N   --dry-run
 * Env: AFI_EVIDENCE_MONGODB_URI (required; same cluster, analytics db),
 *      AFI_ANALYTICS_DB_NAME (default afi_signal_analytics).
 * Scheduling is deployment configuration outside this repo, exactly like
 * the outcomes capture job. DLC-GOV authorizes no deployment; wiring a
 * Cloud Run job for this script is a separate operational act.
 */
import { MongoClient } from "mongodb";
import { buildReassessment, checkpointEligibility } from "./checkpoint-reassess-lib.mjs";

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DRY = args.includes("--dry-run");
const DB = argOf("--db", process.env.AFI_ANALYTICS_DB_NAME || "afi_signal_analytics");
const NOW_ISO = argOf("--now", new Date().toISOString());
const LIMIT = Number(argOf("--limit", "0")) || 0;

if (!Number.isFinite(Date.parse(NOW_ISO))) {
  console.error(`FATAL: --now '${NOW_ISO}' does not parse as an instant.`);
  process.exit(1);
}

const URI = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!URI) {
  console.error("FATAL: AFI_EVIDENCE_MONGODB_URI is required (same cluster; analytics db).");
  process.exit(1);
}

const client = new MongoClient(URI);
await client.connect();
const db = client.db(DB);
const contexts = db.collection("scoring_context");
const outcomes = db.collection("signal_outcomes");
const reassessments = db.collection("signal_reassessments");
await reassessments.createIndex({ signalId: 1 }, { unique: true, name: "signalId_unique" });

const nowMs = Date.parse(NOW_ISO);
let eligible = 0;
let written = 0;
let skippedExisting = 0;
let skippedIneligible = 0;
let skippedNoRows = 0;
let failed = 0;

const cursor = contexts.find({}, { sort: { capturedAt: 1 } });
for await (const ctx of cursor) {
  if (LIMIT && written >= LIMIT) break;
  try {
    const elig = checkpointEligibility(ctx, nowMs);
    if (!elig.eligible) {
      skippedIneligible++;
      continue;
    }
    eligible++;
    const existing = await reassessments.findOne(
      { signalId: ctx.signalId },
      { projection: { _id: 1 } }
    );
    if (existing) {
      skippedExisting++;
      continue;
    }
    const rows = await outcomes.find({ signalId: ctx.signalId }).toArray();
    if (rows.length === 0) {
      // Capture incomplete: the checkpoint reads what was captured, nothing
      // else (D-DLC-4(2)) — retry on a later run once rows exist.
      skippedNoRows++;
      continue;
    }
    const artifact = buildReassessment(
      ctx,
      rows.map(({ _id, ...r }) => r),
      NOW_ISO
    );
    if (DRY) {
      console.log(
        `[dry-run] would append reassessment ${ctx.signalId}: ` +
          `${artifact.reassessmentReading.overall} over ${artifact.horizonsRead.length} horizons ` +
          `(seal ${artifact.seal.value.slice(0, 12)}…)`
      );
      written++;
      continue;
    }
    await reassessments.insertOne(artifact);
    written++;
    console.log(
      `✓ ${ctx.signalId}: ${artifact.reassessmentReading.overall} ` +
        `(${artifact.reassessmentReading.perHorizon.map((p) => p.outcome).join("/")})`
    );
  } catch (err) {
    failed++;
    console.error(`✗ ${ctx?.signalId ?? "<unknown>"}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(
  `checkpoint-reassess done: eligible=${eligible} written=${written} ` +
    `existing=${skippedExisting} preHalfLife=${skippedIneligible} noRows=${skippedNoRows} failed=${failed}${DRY ? " (dry-run)" : ""}`
);
await client.close();
process.exit(failed > 0 && written === 0 && eligible > 0 ? 1 : 0);
