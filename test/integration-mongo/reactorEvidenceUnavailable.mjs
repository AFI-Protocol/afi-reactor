/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — COMPILED-build honest-unavailable smoke.
 *
 * Runs the COMPILED Reactor build (dist/src/server.js) with the real, packaged
 * afi-infra store bound but NO MongoDB configured. Proves that when the canonical
 * store is genuinely unavailable, both scored endpoints construct + validate the
 * record, then fail HONESTLY with a first-class 503 (persisted:false) — never a
 * masked 200. This exercises the whole compiled wiring (score → build governed
 * record → submit → real store) and the store-unavailable path WITHOUT needing a
 * MongoDB, so it runs anywhere (including where CI has no Mongo service).
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import request from "supertest";

// Ensure the store is genuinely unconfigured (no URI, no fallback URI).
delete process.env.AFI_EVIDENCE_MONGODB_URI;
delete process.env.AFI_SCORED_SIGNAL_EVIDENCE_URI;
delete process.env.AFI_MONGO_URI;
process.env.NODE_ENV = "test"; // prevent the compiled server from listening

const COMPILED_SERVER = pathToFileURL(
  path.resolve(process.cwd(), "dist/src/server.js")
).href;

async function main() {
  const { default: app, shutdownReactor } = await import(COMPILED_SERVER);

  const tv = await request(app).post("/api/webhooks/tradingview").send({
    signalId: "it-tv-unavailable-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    strategy: "froggy_trend_pullback_v1",
    direction: "long",
  });
  assert.equal(
    tv.status,
    503,
    `tradingview: store-unavailable must be an honest 503 (got ${tv.status}: ${JSON.stringify(tv.body)})`
  );
  assert.equal(tv.body.persisted, false, "tradingview: persisted:false on unavailable store");
  assert.match(String(tv.body.error), /persistence/, "tradingview: persistence error category");
  console.log("  ✅ POST /api/webhooks/tradingview (no Mongo) → honest 503, persisted:false");

  const cpj = await request(app)
    .post("/api/ingest/cpj")
    .send({
      schema: "afi.cpj.v0.1",
      provenance: {
        providerType: "telegram",
        providerId: "telegram-channel-it",
        messageId: "it-cpj-unavailable-1",
        postedAt: "2026-01-15T10:00:00Z",
      },
      extracted: {
        symbolRaw: "BTCUSDT",
        side: "long",
        entry: 42500,
        timeframeHint: "4h",
        venueHint: "blofin",
        marketTypeHint: "perp",
      },
      parse: { parserId: "telegram-signal-parser", parserVersion: "1.0.0", confidence: 1 },
    });
  assert.equal(
    cpj.status,
    503,
    `cpj: store-unavailable must be an honest 503 (got ${cpj.status}: ${JSON.stringify(cpj.body)})`
  );
  assert.equal(cpj.body.persisted, false, "cpj: persisted:false on unavailable store");
  console.log("  ✅ POST /api/ingest/cpj (no Mongo) → honest 503, persisted:false");

  console.log("\nPASS — compiled build fails honestly (503) when the canonical store is unavailable.");
  return shutdownReactor;
}

// Bounded emergency guard, then NATURAL termination via shutdownReactor (no
// unconditional process.exit(0)). If a handle leaks and the process hangs, the
// guard fails loudly instead.
const EMERGENCY_MS = 15000;
const emergency = setTimeout(() => {
  console.error(`EMERGENCY: process did not terminate within ${EMERGENCY_MS}ms after cleanup.`);
  process.exit(1);
}, EMERGENCY_MS);

main()
  .then(async (shutdownReactor) => {
    await shutdownReactor().catch(() => {});
    clearTimeout(emergency);
    console.log("Clean shutdown: all handles released; process exits naturally.");
  })
  .catch((err) => {
    console.error("\nFAIL — honest-unavailable smoke failed:\n", err);
    clearTimeout(emergency);
    process.exit(1);
  });
