/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — REAL-MongoDB integration proof.
 *
 * Exercises the COMPILED Reactor build (dist/src/server.js) against a real
 * MongoDB (a replica set in CI) through the real, packaged afi-infra canonical
 * evidence store — NO fakes, NO Jest module mapping. Proves:
 *
 *   1. POST /api/webhooks/tradingview constructs, validates, and PERSISTS a
 *      governed afi.scored-signal-evidence.v1 record (persistence.outcome
 *      = "inserted").
 *   2. POST /api/ingest/cpj does the same.
 *   3. Read-back by signalId returns the canonical record, with identifier
 *      continuity across record / scoredSignal / provenanceRecord and the
 *      SCORED / not-finalized lifecycle.
 *   4. Idempotent duplicate: re-submitting byte-identical content returns
 *      "idempotent-duplicate" and creates no second record.
 *   5. Conflicting duplicate: a different record for the same signalId is
 *      rejected as an honest 409 (append-once; the stored record is unchanged).
 *   6. No dual-write: the legacy reactor_scored_signals_v1 collection is never
 *      created; the only canonical write surface is the afi-infra evidence store.
 *
 * Requires AFI_EVIDENCE_MONGODB_URI (a real MongoDB). Fails loudly if unset —
 * this script is a persistence PROOF and must never silently skip.
 *
 * Store-unavailable / schema-rejection / persistence-failure propagation remain
 * covered as focused unit tests (test/evidence/…) and by the compiled
 * honest-unavailable smoke (reactorEvidenceUnavailable.mjs).
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import request from "supertest";
import { MongoClient } from "mongodb";
import { MongoScoredSignalEvidenceStore } from "afi-infra";

const URI = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!URI) {
  console.error(
    "FATAL: AFI_EVIDENCE_MONGODB_URI is required — this is a real-MongoDB persistence proof, not a mock."
  );
  process.exit(1);
}

// Isolated test database so the proof is self-contained and cleanable.
const DB_NAME = process.env.AFI_EVIDENCE_DB_NAME ?? "afi_scored_signal_evidence_it";
process.env.AFI_EVIDENCE_DB_NAME = DB_NAME;
process.env.NODE_ENV = "test"; // prevent the compiled server from listening
delete process.env.AFI_MONGO_URI; // ensure the legacy tssd vault path stays inert

const EVIDENCE_COLLECTION =
  process.env.AFI_EVIDENCE_COLLECTION ?? "scored_signal_evidence";
const HISTORY_COLLECTION =
  process.env.AFI_EVIDENCE_HISTORY_COLLECTION ?? "scored_signal_evidence_history";
const EVIDENCE_SCHEMA = "afi.scored-signal-evidence.v1";
const LEGACY_COLLECTION = "reactor_scored_signals_v1";

const COMPILED_SERVER = pathToFileURL(
  path.resolve(process.cwd(), "dist/src/server.js")
).href;

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✅ ${label}`);
}

/** Assert full identifier continuity + SCORED lifecycle on a read-back record. */
function assertGovernedRecord(record, signalId) {
  assert.ok(record, `record for ${signalId} must be readable back`);
  assert.equal(record.schema, EVIDENCE_SCHEMA, "governed schema id");
  assert.equal(record.signalId, signalId, "record.signalId continuity");
  assert.equal(record.scoredSignal.signalId, signalId, "scoredSignal.signalId continuity");
  assert.equal(record.provenanceRecord.signalId, signalId, "provenanceRecord.signalId continuity");
  assert.equal(record.scoredSignal.schema, "afi.scored-signal.v1", "thin projection schema");
  assert.equal(
    record.provenanceRecord.schema,
    "afi.provenance-record.v1",
    "provenance record schema"
  );
  assert.equal(record.lifecycleState, "SCORED", "SCORED lifecycle");
  assert.equal(record.finalized, false, "SCORED is not finalized");
  assert.ok(record.analystId && record.strategyId && record.strategyVersion, "strategy triple");
  assert.equal(
    record.scoredSignal.strategyVersion,
    record.strategyVersion,
    "strategyVersion continuity"
  );
  assert.equal(
    record.provenanceRecord.canonicalizationVersion,
    record.canonicalizationVersion,
    "canonicalizationVersion continuity"
  );
}

async function main() {
  const client = new MongoClient(URI);
  await client.connect();
  // Clean slate for a deterministic, self-contained proof.
  await client.db(DB_NAME).dropDatabase();

  // Read-back store: the SAME packaged afi-infra store, pointed at the test db.
  const store = new MongoScoredSignalEvidenceStore({ mongoUri: URI, dbName: DB_NAME });

  // Import the COMPILED reactor app (real afi-infra store binds at runtime).
  const { default: app } = await import(COMPILED_SERVER);

  const tvSignalId = "it-tv-0001";
  const tvPayload = {
    signalId: tvSignalId,
    symbol: "BTCUSDT",
    timeframe: "1h",
    strategy: "froggy_trend_pullback_v1",
    direction: "long",
  };

  const cpjMessageId = "it-cpj-msg-0001";
  const cpjPayload = {
    schema: "afi.cpj.v0.1",
    provenance: {
      providerType: "telegram",
      providerId: "telegram-channel-it",
      messageId: cpjMessageId,
      postedAt: "2026-01-15T10:00:00Z",
    },
    extracted: {
      symbolRaw: "BTCUSDT",
      side: "long",
      entry: 42500,
      stopLoss: 41800,
      takeProfits: [{ price: 43500 }],
      timeframeHint: "4h",
      venueHint: "blofin",
      marketTypeHint: "perp",
    },
    parse: { parserId: "telegram-signal-parser", parserVersion: "1.0.0", confidence: 1 },
  };

  try {
    // 1. TradingView endpoint persists a governed record. -------------------
    const tvRes = await request(app).post("/api/webhooks/tradingview").send(tvPayload);
    assert.equal(tvRes.status, 200, `tradingview 200 (got ${tvRes.status}: ${JSON.stringify(tvRes.body)})`);
    assert.equal(tvRes.body.persistence?.outcome, "inserted", "tradingview persisted=inserted");
    assert.equal(tvRes.body.persistence?.signalId, tvSignalId, "tradingview persisted signalId");
    assert.equal(tvRes.body.persistence?.lifecycleState, "SCORED", "tradingview SCORED");
    ok("POST /api/webhooks/tradingview → 200, persistence.outcome=inserted");

    const tvBack = await store.getBySignalId(tvSignalId);
    assertGovernedRecord(tvBack, tvSignalId);
    const tvReplay = await store.getReplayBundle(tvSignalId);
    assert.ok(tvReplay?.scoredSignal && tvReplay?.provenanceRecord, "tradingview replay bundle");
    ok("tradingview: read-back by signalId + identifier continuity + replay bundle");

    // 2. CPJ endpoint persists a governed record. ---------------------------
    const cpjRes = await request(app).post("/api/ingest/cpj").send(cpjPayload);
    assert.equal(cpjRes.status, 200, `cpj 200 (got ${cpjRes.status}: ${JSON.stringify(cpjRes.body)})`);
    assert.equal(cpjRes.body.persistence?.outcome, "inserted", "cpj persisted=inserted");
    const cpjSignalId = cpjRes.body.signalId;
    assert.ok(cpjSignalId, "cpj signalId present");
    assert.equal(cpjRes.body.persistence?.signalId, cpjSignalId, "cpj persisted signalId matches");
    ok("POST /api/ingest/cpj → 200, persistence.outcome=inserted");

    const cpjBack = await store.getBySignalId(cpjSignalId);
    assertGovernedRecord(cpjBack, cpjSignalId);
    ok("cpj: read-back by signalId + identifier continuity");

    // 3. Idempotent duplicate (real store): re-submitting the byte-identical
    //    stored record returns idempotent-duplicate and creates no second
    //    record. NOTE: an endpoint re-POST cannot demonstrate this — the scoring
    //    pipeline's enrichment is non-deterministic, so a re-score yields
    //    DIFFERENT content (a conflict, not an idempotent duplicate). The
    //    governed idempotency contract is on the CANONICAL RECORD, so it is
    //    proven here by re-submitting the exact persisted record.
    const idem = await store.submit(tvBack);
    assert.equal(idem.outcome, "idempotent-duplicate", "byte-identical re-submit is idempotent");
    const currentCount = await client
      .db(DB_NAME)
      .collection(EVIDENCE_COLLECTION)
      .countDocuments({ signalId: tvSignalId });
    assert.equal(currentCount, 1, "idempotent re-submit created no second record");
    ok("idempotent duplicate (real store) → idempotent-duplicate, exactly one stored record");

    // 4. Conflicting duplicate (endpoint→store): a DIFFERENT record for the same
    //    signalId is an honest 409 (append-once); the stored record is unchanged.
    const tvConflict = await request(app)
      .post("/api/webhooks/tradingview")
      .send({ ...tvPayload, direction: "short" });
    assert.equal(tvConflict.status, 409, `conflicting duplicate → 409 (got ${tvConflict.status})`);
    assert.equal(tvConflict.body.persisted, false, "conflict reports persisted:false");
    assert.match(String(tvConflict.body.error), /conflict/, "conflict error category");
    const afterConflict = await store.getBySignalId(tvSignalId);
    assert.deepEqual(
      afterConflict,
      tvBack,
      "append-once: the conflicting submit left the stored record byte-unchanged"
    );
    ok("conflicting duplicate → honest 409, append-once (stored record unchanged)");

    // 5. No dual-write: the legacy collection is never created. -------------
    const dbNames = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
    for (const dbName of dbNames) {
      const cols = await client.db(dbName).listCollections({ name: LEGACY_COLLECTION }).toArray();
      assert.equal(
        cols.length,
        0,
        `legacy ${LEGACY_COLLECTION} must not exist (found in db '${dbName}')`
      );
    }
    const evidenceCols = (
      await client.db(DB_NAME).listCollections({}, { nameOnly: true }).toArray()
    ).map((c) => c.name);
    assert.ok(
      evidenceCols.includes(EVIDENCE_COLLECTION),
      "canonical evidence collection exists"
    );
    assert.ok(
      evidenceCols.every((c) => c === EVIDENCE_COLLECTION || c === HISTORY_COLLECTION),
      `evidence db holds only the canonical store collections (found: ${evidenceCols.join(", ")})`
    );
    const totalCanonical = await client
      .db(DB_NAME)
      .collection(EVIDENCE_COLLECTION)
      .countDocuments({});
    assert.equal(totalCanonical, 2, "exactly the two inserted canonical records (tv + cpj)");
    ok("no dual-write: only the afi-infra evidence store was written (no reactor_scored_signals_v1)");

    console.log(`\nPASS — ${passed} real-MongoDB persistence checks green.`);
  } finally {
    // Bounded cleanup — never let connection teardown block process exit. The
    // COMPILED app also holds its own afi-infra store connection we don't own; the
    // assertions above are the proof, and `.then(process.exit)` terminates below.
    await Promise.race([
      (async () => {
        await store.close().catch(() => {});
        await client.db(DB_NAME).dropDatabase().catch(() => {});
        await client.close().catch(() => {});
      })(),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
}

// Force exit on success: the COMPILED app binds its own afi-infra Mongo store
// (open connection + replica-set heartbeats) and initDedupeCache() sets timers,
// none of which this script owns a handle to — so the event loop would never
// drain. The assertions above are the proof; exit deterministically after them.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFAIL — real-MongoDB persistence proof failed:\n", err);
    process.exit(1);
  });
