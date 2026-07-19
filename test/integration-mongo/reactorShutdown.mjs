/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — SIGTERM graceful-shutdown proof (live-beta).
 *
 * Spawns the COMPILED reactor as a real, LISTENING server (node dist/src/server.js)
 * with a real MongoDB configured, drives a scored request so the afi-infra
 * evidence store opens a live connection, then sends SIGTERM and requires the
 * process to shut down gracefully and exit 0 PROMPTLY — proving Cloud Run-style
 * SIGTERM handling (close HTTP server → close evidence store / Mongo client →
 * exit) with no leaked handles. A hang (no exit within the deadline) fails.
 *
 * Requires AFI_EVIDENCE_MONGODB_URI (a real MongoDB).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startTinyBrainsStub } from "./support/tinyBrainsStub.mjs";

const URI = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!URI) {
  console.error("FATAL: AFI_EVIDENCE_MONGODB_URI is required — SIGTERM proof needs a real store.");
  process.exit(1);
}

const PORT = process.env.PORT || "8199";
const DB = process.env.AFI_EVIDENCE_DB_NAME || "afi_scored_signal_evidence_shutdown_it";
const SERVER = path.resolve(process.cwd(), "dist/src/server.js");

// The runtime registers no synthetic feed: preload the guarded test seam into
// the child so the deterministic feed exists before the first scored request.
const PRELOAD = pathToFileURL(
  path.resolve(process.cwd(), "test/support/registerDeterministicPriceFeed.mjs")
).href;

// Under pipeline v1.3.0 every lane is CRITICAL (EV3-GOV D-EV3-5(1)): the
// scored request this proof drives needs a live aiMl lane. Start the governed
// Tiny Brains stub in THIS process and hand its URL to the child; an
// operator-provided TINY_BRAINS_URL is respected untouched.
const tinyBrains = process.env.TINY_BRAINS_URL?.trim() ? null : await startTinyBrainsStub();

const child = spawn(process.execPath, ["--import", PRELOAD, SERVER], {
  // NODE_ENV must NOT be "test" so the server actually listens + installs the
  // SIGTERM handler. It also must not be "production": the deterministic-feed
  // seam (correctly) refuses to register synthetic data in production, so this
  // proof runs the listening path under "development".
  env: {
    ...process.env,
    NODE_ENV: "development",
    AFI_EVIDENCE_MONGODB_URI: URI,
    AFI_EVIDENCE_DB_NAME: DB,
    PORT,
    AFI_PRICE_FEED_SOURCE: "demo",
    ...(tinyBrains ? { TINY_BRAINS_URL: tinyBrains.url } : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => (out += d.toString()));
child.stderr.on("data", (d) => (out += d.toString()));

async function waitFor(substr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (out.includes(substr)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function exitWithin(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function post(route, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function run() {
  const listening = await waitFor("Listening on", 30000);
  assert.ok(listening, "compiled server did not start listening within 30s");

  // Drive a scored request so the evidence store opens a live Mongo connection
  // that graceful shutdown must then close.
  const r = await post("/api/webhooks/tradingview", {
    signalId: "shutdown-it-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    strategy: "froggy_trend_pullback_v1",
    direction: "long",
  });
  assert.equal(r.status, 200, `scored POST should persist (got ${r.status}: ${JSON.stringify(r.body)})`);
  assert.equal(r.body.persistence?.outcome, "inserted", "persisted through the real store");
  console.log("  ✅ compiled server listening + evidence store connected (persisted 1 record)");

  // SIGTERM must trigger graceful shutdown and a prompt clean exit.
  child.kill("SIGTERM");
  const result = await exitWithin(15000);
  assert.ok(!result.timedOut, "server did NOT exit within 15s of SIGTERM (leaked handles / no graceful shutdown)");
  assert.equal(
    result.code,
    0,
    `SIGTERM must exit 0 (got code=${result.code} signal=${result.signal})`
  );
  assert.match(out, /Clean shutdown complete/, "graceful shutdown path ran");
  console.log("  ✅ SIGTERM → graceful shutdown, process exited 0 (Cloud Run-compatible)");
  console.log("\nPASS — SIGTERM-compatible clean shutdown proven on the compiled build.");
}

const EMERGENCY_MS = 45000;
const emergency = setTimeout(() => {
  console.error(`EMERGENCY: shutdown proof did not finish within ${EMERGENCY_MS}ms.`);
  try {
    child.kill("SIGKILL");
  } catch {}
  process.exit(1);
}, EMERGENCY_MS);

run()
  .then(async () => {
    await tinyBrains?.close().catch(() => {});
    clearTimeout(emergency);
    // child has exited; no open handles remain → natural termination.
  })
  .catch(async (err) => {
    console.error("\nFAIL — SIGTERM shutdown proof failed:\n", err);
    try {
      child.kill("SIGKILL");
    } catch {}
    await tinyBrains?.close().catch(() => {});
    clearTimeout(emergency);
    process.exit(1);
  });
