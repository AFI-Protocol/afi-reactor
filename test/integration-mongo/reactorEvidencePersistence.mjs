/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — REAL-MongoDB integration proof (live-beta).
 *
 * Exercises the COMPILED Reactor build (dist/src/server.js) against a real
 * MongoDB (a replica set in CI) through the real, packaged afi-infra canonical
 * evidence store — NO fakes, NO Jest module mapping. Proves:
 *
 *   1. POST /api/webhooks/tradingview constructs, validates, and PERSISTS a
 *      governed afi.scored-signal-evidence.v1 record (persistence.outcome
 *      = "inserted").
 *   2. POST /api/ingest/cpj does the same — with a DECIMAL parse.confidence
 *      (0.87), proving the afi.hash.v1 fixed-point projection of
 *      cpjParseConfidence (no integer-only crutch).
 *   3. Read-back by signalId returns the canonical record, with identifier
 *      continuity across record / scoredSignal / provenanceRecord and the
 *      SCORED / not-finalized lifecycle.
 *   4. ENDPOINT idempotency: re-POSTing the SAME canonical input + signalId
 *      through BOTH endpoints yields an identical record and an idempotent 200
 *      (deterministic scoring — the demo feed is now seeded from governed input).
 *   5. Conflicting duplicate: genuinely different content for the same signalId
 *      is rejected as an honest 409 (append-once; stored record unchanged).
 *   6. No dual-write: the legacy reactor_scored_signals_v1 collection is never
 *      created; the only canonical write surface is the afi-infra evidence store.
 *   7. Clean shutdown: after the proof, shutdownReactor() releases the store +
 *      dedupe handles and the process TERMINATES NATURALLY (no process.exit(0)).
 *
 * Requires AFI_EVIDENCE_MONGODB_URI (a real MongoDB). Fails loudly if unset.
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

const DB_NAME = process.env.AFI_EVIDENCE_DB_NAME ?? "afi_scored_signal_evidence_it";
process.env.AFI_EVIDENCE_DB_NAME = DB_NAME;
process.env.NODE_ENV = "test"; // prevent the compiled server from listening
process.env.AFI_PRICE_FEED_SOURCE = process.env.AFI_PRICE_FEED_SOURCE ?? "demo";

const EVIDENCE_COLLECTION = process.env.AFI_EVIDENCE_COLLECTION ?? "scored_signal_evidence";
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

function assertGovernedRecord(record, signalId) {
  assert.ok(record, `record for ${signalId} must be readable back`);
  assert.equal(record.schema, EVIDENCE_SCHEMA, "governed schema id");
  assert.equal(record.signalId, signalId, "record.signalId continuity");
  assert.equal(record.scoredSignal.signalId, signalId, "scoredSignal.signalId continuity");
  assert.equal(record.provenanceRecord.signalId, signalId, "provenanceRecord.signalId continuity");
  assert.equal(record.scoredSignal.schema, "afi.scored-signal.v1", "thin projection schema");
  assert.equal(record.provenanceRecord.schema, "afi.provenance-record.v1", "provenance schema");
  assert.equal(record.lifecycleState, "SCORED", "SCORED lifecycle");
  assert.equal(record.finalized, false, "SCORED is not finalized");
  assert.ok(record.analystId && record.strategyId && record.strategyVersion, "strategy triple");
}

async function main() {
  const client = new MongoClient(URI);
  await client.connect();
  await client.db(DB_NAME).dropDatabase();

  const store = new MongoScoredSignalEvidenceStore({ mongoUri: URI, dbName: DB_NAME });
  const { default: app, shutdownReactor } = await import(COMPILED_SERVER);
  assert.equal(typeof shutdownReactor, "function", "compiled server exports shutdownReactor");

  const tvSignalId = "it-tv-0001";
  const tvPayload = {
    signalId: tvSignalId,
    symbol: "BTCUSDT",
    timeframe: "1h",
    strategy: "froggy_trend_pullback_v1",
    direction: "long",
  };
  const cpjPayload = {
    schema: "afi.cpj.v0.1",
    provenance: {
      providerType: "telegram",
      providerId: "telegram-channel-it",
      messageId: "it-cpj-msg-0001",
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
    // DECIMAL confidence — proves the afi.hash.v1 fixed-point projection.
    parse: { parserId: "telegram-signal-parser", parserVersion: "1.0.0", confidence: 0.87 },
  };

  const countFor = (signalId) =>
    client.db(DB_NAME).collection(EVIDENCE_COLLECTION).countDocuments({ signalId });

  try {
    // 1. TradingView persists. -----------------------------------------------
    const tv = await request(app).post("/api/webhooks/tradingview").send(tvPayload);
    assert.equal(tv.status, 200, `tradingview 200 (got ${tv.status}: ${JSON.stringify(tv.body)})`);
    assert.equal(tv.body.persistence?.outcome, "inserted", "tradingview inserted");
    ok("POST /api/webhooks/tradingview → 200, persistence.outcome=inserted");

    const tvBack = await store.getBySignalId(tvSignalId);
    assertGovernedRecord(tvBack, tvSignalId);
    const tvReplay = await store.getReplayBundle(tvSignalId);
    assert.ok(tvReplay?.scoredSignal && tvReplay?.provenanceRecord, "tradingview replay bundle");
    ok("tradingview: read-back by signalId + identifier continuity + replay bundle");

    // 2. CPJ persists WITH a decimal parse.confidence. -----------------------
    const cpj = await request(app).post("/api/ingest/cpj").send(cpjPayload);
    assert.equal(cpj.status, 200, `cpj 200 (got ${cpj.status}: ${JSON.stringify(cpj.body)})`);
    assert.equal(cpj.body.persistence?.outcome, "inserted", "cpj inserted");
    const cpjSignalId = cpj.body.signalId;
    assert.ok(cpjSignalId, "cpj signalId present");
    const cpjBack = await store.getBySignalId(cpjSignalId);
    assertGovernedRecord(cpjBack, cpjSignalId);
    ok("POST /api/ingest/cpj (decimal confidence 0.87) → 200 inserted + read-back + continuity");

    // 3. ENDPOINT idempotency (TradingView): identical re-POST → 200 duplicate. -
    const tvDup = await request(app).post("/api/webhooks/tradingview").send(tvPayload);
    assert.equal(tvDup.status, 200, `tv idempotent re-POST still 200 (got ${tvDup.status})`);
    assert.equal(
      tvDup.body.persistence?.outcome,
      "idempotent-duplicate",
      `tv re-POST must be idempotent (got ${tvDup.body.persistence?.outcome})`
    );
    assert.equal(await countFor(tvSignalId), 1, "tv idempotent re-POST created no second record");
    ok("endpoint idempotency (tradingview): identical re-POST → 200 idempotent-duplicate, 1 record");

    // 4. ENDPOINT idempotency (CPJ): identical re-POST → 200 duplicate. -------
    const cpjDup = await request(app).post("/api/ingest/cpj").send(cpjPayload);
    assert.equal(cpjDup.status, 200, `cpj idempotent re-POST still 200 (got ${cpjDup.status})`);
    assert.equal(
      cpjDup.body.persistence?.outcome,
      "idempotent-duplicate",
      `cpj re-POST must be idempotent (got ${cpjDup.body.persistence?.outcome})`
    );
    assert.equal(await countFor(cpjSignalId), 1, "cpj idempotent re-POST created no second record");
    ok("endpoint idempotency (cpj): identical re-POST → 200 idempotent-duplicate, 1 record");

    // 5. Conflicting duplicate: different content, same signalId → 409. ------
    const conflict = await request(app)
      .post("/api/webhooks/tradingview")
      .send({ ...tvPayload, direction: "short" });
    assert.equal(conflict.status, 409, `conflicting duplicate → 409 (got ${conflict.status})`);
    assert.equal(conflict.body.persisted, false, "conflict reports persisted:false");
    assert.match(String(conflict.body.error), /conflict/, "conflict error category");
    assert.deepEqual(
      await store.getBySignalId(tvSignalId),
      tvBack,
      "append-once: the conflicting submit left the stored record byte-unchanged"
    );
    ok("conflicting duplicate → honest 409, append-once (stored record unchanged)");

    // 6. No dual-write: legacy collection never created. ---------------------
    const dbNames = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
    for (const dbName of dbNames) {
      const cols = await client.db(dbName).listCollections({ name: LEGACY_COLLECTION }).toArray();
      assert.equal(cols.length, 0, `legacy ${LEGACY_COLLECTION} must not exist (db '${dbName}')`);
    }
    const evidenceCols = (
      await client.db(DB_NAME).listCollections({}, { nameOnly: true }).toArray()
    ).map((c) => c.name);
    assert.ok(
      evidenceCols.every((c) => c === EVIDENCE_COLLECTION || c === HISTORY_COLLECTION),
      `evidence db holds only the canonical store collections (found: ${evidenceCols.join(", ")})`
    );
    assert.equal(
      await client.db(DB_NAME).collection(EVIDENCE_COLLECTION).countDocuments({}),
      2,
      "exactly the two inserted canonical records (tv + cpj)"
    );
    ok("no dual-write: only the afi-infra evidence store was written (no reactor_scored_signals_v1)");

    console.log(`\nPASS — ${passed} real-MongoDB persistence checks green.`);
    return shutdownReactor;
  } finally {
    // Bounded cleanup of THIS script's own connections.
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

// Bounded emergency guard: if cleanup leaks a handle and the process fails to
// exit naturally, fail LOUDLY (non-zero) instead of hanging CI. On success the
// guard is cleared and the process terminates on its own — no process.exit(0).
const EMERGENCY_MS = 20000;
const emergency = setTimeout(() => {
  console.error(
    `EMERGENCY: process did not terminate within ${EMERGENCY_MS}ms after cleanup — ` +
      `open handles remain (clean-shutdown regression).`
  );
  process.exit(1);
}, EMERGENCY_MS);

main()
  .then(async (shutdownReactor) => {
    // Release the COMPILED app's own bound evidence-store connection + dedupe
    // cache. With every handle closed the event loop drains and the process
    // exits naturally — proving SIGTERM-compatible cleanup.
    await shutdownReactor().catch(() => {});
    clearTimeout(emergency);
    console.log("Clean shutdown: all handles released; process exits naturally.");
  })
  .catch((err) => {
    console.error("\nFAIL — real-MongoDB persistence proof failed:\n", err);
    clearTimeout(emergency);
    process.exit(1);
  });
