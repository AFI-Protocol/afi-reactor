/**
 * ORACLE-EQUIVALENCE — real-MongoDB byte-equivalence proof (compiled build).
 *
 * Reuses the repo's replica-set IT convention (see
 * test/integration-mongo/reactorEvidencePersistence.mjs): exercises the
 * COMPILED Reactor (dist/src/server.js) against a real MongoDB through the
 * real, packaged afi-infra canonical evidence store — no jest module
 * mapping — and proves the live store persists EXACTLY the bytes the
 * committed ENRICHED oracle goldens froze:
 *
 *   1. every enriched builtin-mode fixture persists into
 *      `scored_signal_evidence` (record present, readable back);
 *   2. signalId is unique (exactly one document per fixture signalId);
 *   3. the byte-normalized stored record equals the committed golden's
 *      `evidenceRecord` (recursively key-sorted serialization, volatile
 *      clock keys → '<CLOCK>');
 *   4. a registry-mode run matches its registry golden the same way.
 *
 * Under pipeline v1.3.0 every lane is CRITICAL (EV3-GOV D-EV3-5(1)), so this
 * proof reproduces the exact RECORDED world the goldens were frozen under
 * (the ONE byte-source: test/oracle/support/recordedLaneData.ts):
 *
 *   - sentiment (CFTC COT) + news (SEC EDGAR + its declared evaluation
 *     clock): recorded transports injected at the compiled adapter
 *     SINGLETONS — the same seam the jest oracle suites replace via
 *     jest.mock, reached here by mutating the exported singleton objects the
 *     compiled adapter registry holds by reference;
 *   - aiMl (Tiny Brains): the recorded prediction served over a REAL HTTP
 *     transport by the ephemeral stub (tinyBrainsStub.mjs, recorded mode),
 *     driven through the compiled trusted client's full fail-closed
 *     verification chain (an operator-provided TINY_BRAINS_URL is respected,
 *     though a live service cannot reproduce the recorded goldens and will
 *     fail the byte-equality honestly);
 *   - technical (deterministic demo feed via the guarded seam) and the
 *     first-party candlestick pattern lane run their REAL local kernels.
 *
 * All other outbound network stays disabled (fetch guard) — only the Tiny
 * Brains service URL is reachable.
 *
 * Requires AFI_EVIDENCE_MONGODB_URI (a real MongoDB). Fails loudly if unset.
 * Goldens are regenerated ONLY via `npm run oracle:regen`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import request from "supertest";
import { MongoClient } from "mongodb";
import { MongoScoredSignalEvidenceStore } from "afi-infra";
import { startTinyBrainsStub } from "../integration-mongo/support/tinyBrainsStub.mjs";

const URI = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!URI) {
  console.error(
    "FATAL: AFI_EVIDENCE_MONGODB_URI is required — this is a real-MongoDB equivalence proof, not a mock."
  );
  process.exit(1);
}

const DB_NAME = process.env.AFI_EVIDENCE_DB_NAME ?? "afi_scored_signal_evidence_oracle_it";
process.env.AFI_EVIDENCE_DB_NAME = DB_NAME;
process.env.NODE_ENV = "test"; // prevent the compiled server from listening

// Deterministic oracle environment: the deterministic feed (injected through
// the guarded test seam — the runtime registers no synthetic feed) plus every
// external provider key/flag OFF — the exact environment the enriched goldens
// were frozen under (their remote lanes see RECORDED transports, below).
await import("../support/registerDeterministicPriceFeed.mjs");
process.env.AFI_PRICE_FEED_SOURCE = "demo";
for (const k of [
  "COINALYZE_API_KEY",
  "NEWSDATA_API_KEY",
  "NEWS_WINDOW_HOURS",
  "WEBHOOK_SHARED_SECRET",
  "AFI_INGEST_DEDUPE",
  "AFI_DEFAULT_PROVIDER_ID",
  "AFI_UWR_PROFILE_SOURCE",
]) {
  delete process.env[k];
}

const EVIDENCE_COLLECTION = process.env.AFI_EVIDENCE_COLLECTION ?? "scored_signal_evidence";
const ROOT = process.cwd();
const COMPILED_SERVER = pathToFileURL(path.resolve(ROOT, "dist/src/server.js")).href;
const COMPILED_UWR = pathToFileURL(path.resolve(ROOT, "dist/src/config/uwrRuntimeProfile.js")).href;
const COMPILED_COMPOSITION = pathToFileURL(
  path.resolve(ROOT, "dist/src/config/runtimeComposition.js")
).href;
const GOLDENS = path.resolve(ROOT, "test/oracle/goldens/enriched");
const FIXTURES = path.resolve(ROOT, "test/oracle/fixtures");

// ---- the recorded world (v1.3.0: every lane critical) --------------------
// The ONE copy of the recorded remote-lane bytes (shared with the jest oracle
// suites), loaded via Node's native type stripping.
const recorded = await import(
  pathToFileURL(path.resolve(ROOT, "test/oracle/support/recordedLaneData.ts")).href
);

// aiMl lane: the recorded Tiny Brains prediction over a REAL HTTP transport.
// Only default to the ephemeral stub when the operator provided no service.
const tinyBrains = process.env.TINY_BRAINS_URL?.trim()
  ? null
  : await startTinyBrainsStub({ recorded: true });
if (tinyBrains) process.env.TINY_BRAINS_URL = tinyBrains.url;
const AIML_SERVICE_BASE = process.env.TINY_BRAINS_URL.trim();

// Network OFF for everything EXCEPT the Tiny Brains service URL — identical
// to the jest suites' disabled-network determinism (their aiMl transport is
// injected below the client; here the compiled client runs its full
// fail-closed verification chain over real HTTP).
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input?.url ?? "");
  if (url === AIML_SERVICE_BASE || url.startsWith(`${AIML_SERVICE_BASE}/`)) {
    return realFetch(input, init);
  }
  return Promise.reject(new Error("oracle: external network disabled (deterministic proof)"));
};

// sentiment (CFTC COT) + news (SEC EDGAR + its declared evaluation clock):
// recorded transports injected at the compiled adapter SINGLETONS — the exact
// seam the jest oracle suites replace via jest.mock. The compiled adapter
// registry holds these exported objects BY REFERENCE, so rebinding their
// behavior in place (before the first scored request) swaps the transport
// while every identity fact (adapterId/version/category) stays untouched.
const cftcMod = await import(
  pathToFileURL(path.resolve(ROOT, "dist/src/providers/adapters/sentimentCftcCotAdapter.js")).href
);
const edgarMod = await import(
  pathToFileURL(path.resolve(ROOT, "dist/src/providers/adapters/newsSecEdgarAdapter.js")).href
);
const okJson = (value) => async () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => value,
});
Object.assign(
  cftcMod.sentimentCftcCotAdapter,
  cftcMod.createSentimentCftcCotAdapter({
    fetchImpl: okJson([recorded.RECORDED_CFTC_COT_ROW]),
  })
);
Object.assign(
  edgarMod.newsSecEdgarAdapter,
  edgarMod.createNewsSecEdgarAdapter({
    fetchImpl: okJson(recorded.RECORDED_EDGAR_FULL_TEXT_BODY),
    now: () => new Date(recorded.RECORDED_EDGAR_CLOCK_ISO),
  })
);

// ---- byte-normalization mirrors test/oracle/support/oracleHarness.ts ----
const VOLATILE_KEYS = new Set([
  "scoredAt",
  "createdAt",
  "updatedAt",
  "storedAt",
  "processedAt",
  "ingestedAt",
  "startedAt",
  "finishedAt",
  "enrichedAt",
  "firstSeenAt",
]);
const normalizeVolatile = (value) =>
  JSON.parse(
    JSON.stringify(value, (key, v) =>
      VOLATILE_KEYS.has(key) && typeof v === "string" ? "<CLOCK>" : v
    )
  );
const sortDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, sortDeep(x)])
    );
  }
  return v;
};
const bytes = (v) => JSON.stringify(sortDeep(v), null, 2);

const loadJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const CASES = [
  { name: "tv-long", endpoint: "/api/webhooks/tradingview", fixture: "tradingview/tv-long.json" },
  { name: "tv-short", endpoint: "/api/webhooks/tradingview", fixture: "tradingview/tv-short.json" },
  { name: "tv-neutral", endpoint: "/api/webhooks/tradingview", fixture: "tradingview/tv-neutral.json" },
  { name: "cpj-blofin-perp-long", endpoint: "/api/ingest/cpj", fixture: "cpj/cpj-blofin-perp-long.json" },
  { name: "cpj-coinbase-spot-sell", endpoint: "/api/ingest/cpj", fixture: "cpj/cpj-coinbase-spot-sell.json" },
  { name: "cpj-blofin-perp-neutral", endpoint: "/api/ingest/cpj", fixture: "cpj/cpj-blofin-perp-neutral.json" },
];

let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ✅ ${label}`);
};

async function proveCase(app, store, client, { name, endpoint, fixture }, mode) {
  const golden = loadJson(path.join(GOLDENS, `${name}.${mode}.json`));
  const res = await request(app).post(endpoint).send(loadJson(path.join(FIXTURES, fixture)));
  assert.equal(res.status, 200, `${name}: 200 (got ${res.status}: ${JSON.stringify(res.body)})`);
  assert.equal(res.body.persistence?.outcome, "inserted", `${name}: inserted`);
  const signalId = res.body.signalId ?? res.body.persistence?.signalId;
  assert.ok(signalId, `${name}: signalId present`);

  // 1. Record present in the canonical collection.
  const readBack = await store.getBySignalId(signalId);
  assert.ok(readBack, `${name}: record readable back from ${EVIDENCE_COLLECTION}`);

  // 2. Unique signalId — exactly one document.
  const count = await client
    .db(DB_NAME)
    .collection(EVIDENCE_COLLECTION)
    .countDocuments({ signalId });
  assert.equal(count, 1, `${name}: unique signalId (found ${count})`);

  // 3. Byte-normalized stored record equals the committed golden.
  assert.equal(
    bytes(normalizeVolatile(readBack)),
    bytes(golden.evidenceRecord),
    `${name} (${mode}): stored record must byte-equal the committed golden evidenceRecord`
  );
  ok(`${name} [${mode}]: persisted + unique + byte-equal to golden`);
}

async function main() {
  const client = new MongoClient(URI);
  await client.connect();
  await client.db(DB_NAME).dropDatabase();

  const store = new MongoScoredSignalEvidenceStore({ mongoUri: URI, dbName: DB_NAME });
  const { default: app, shutdownReactor } = await import(COMPILED_SERVER);
  const { __resetUwrRuntimeConfigForTests, UWR_PROFILE_SOURCE_ENV } = await import(COMPILED_UWR);
  // The committed oracle fixtures resolve through the oracle registry OVERLAY
  // (test/oracle/fixtures/afi-config — byte-equal official registries + the
  // oracle-fixture provider bindings), exactly like the jest oracle suites.
  const { __setRuntimeCompositionOverridesForTests } = await import(COMPILED_COMPOSITION);
  __setRuntimeCompositionOverridesForTests({
    configRoot: path.resolve(ROOT, "test/oracle/fixtures/afi-config"),
  });

  try {
    // Builtin (default) mode — all six enriched fixtures.
    delete process.env[UWR_PROFILE_SOURCE_ENV];
    __resetUwrRuntimeConfigForTests();
    for (const c of CASES) {
      await proveCase(app, store, client, c, "builtin");
    }

    // Registry mode — same fixture set persists the registry-consumed goldens.
    await client.db(DB_NAME).dropDatabase();
    process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
    __resetUwrRuntimeConfigForTests();
    await proveCase(app, store, client, CASES[0], "registry");

    delete process.env[UWR_PROFILE_SOURCE_ENV];
    __resetUwrRuntimeConfigForTests();

    console.log(`\nPASS — ${passed} real-MongoDB oracle-equivalence checks green.`);
    return shutdownReactor;
  } finally {
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

// Bounded emergency guard (repo IT convention): fail loudly instead of hanging.
const EMERGENCY_MS = 20000;
const emergency = setTimeout(() => {
  console.error(
    `EMERGENCY: process did not terminate within ${EMERGENCY_MS}ms after cleanup — open handles remain.`
  );
  process.exit(1);
}, EMERGENCY_MS);

main()
  .then(async (shutdownReactor) => {
    await shutdownReactor().catch(() => {});
    await tinyBrains?.close().catch(() => {});
    clearTimeout(emergency);
    console.log("Clean shutdown: all handles released; process exits naturally.");
  })
  .catch(async (err) => {
    console.error("\nFAIL — real-MongoDB oracle-equivalence proof failed:\n", err);
    await tinyBrains?.close().catch(() => {});
    clearTimeout(emergency);
    process.exit(1);
  });
