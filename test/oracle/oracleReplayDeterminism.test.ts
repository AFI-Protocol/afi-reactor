/**
 * ORACLE — deterministic replay law (EV3-GOV §15.4 / D-EV3-4(7)).
 *
 * Through the REAL live path (server → resolution → boot-validated registry
 * composition → GraphExecutor over froggy v1.3.0 → five recorded-transport
 * lanes → Evidence V3 builder → store seam):
 *
 *   1. the SAME evaluation run twice produces BYTE-IDENTICAL v3 records —
 *      identical replay projections, identical replayHash, identical
 *      recordHash (no volatile normalization needed: the canonical record
 *      admits no wall-clock surface at all);
 *   2. a REAL volatile perturbation — the wall clock moved seven hours via
 *      Date-only fake timers, which shifts every operational timestamp
 *      (scoredAt / ingestedAt / node durations become degenerate under the
 *      frozen clock) — leaves the record bytes, recordHash, and replayHash
 *      UNCHANGED: timing-shaped operational values never enter any hashed
 *      preimage (D-EV3-4(7): non-canonical operational diagnostics stay
 *      runtime logs).
 *
 * The perturbation is proven REAL by the response envelope: the run's
 * scoredAt moves with the faked clock while the canonical record does not.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import request from "supertest";

jest.mock("ccxt", () => {
  class OracleUnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: OracleUnusedExchange, coinbase: OracleUnusedExchange },
  };
});

// The shared RECORDED remote-lane transports (one source of recorded bytes).
jest.mock("../../src/providers/adapters/sentimentCftcCotAdapter.js", () => {
  const actual = jest.requireActual(
    "../../src/providers/adapters/sentimentCftcCotAdapter.js"
  ) as typeof import("../../src/providers/adapters/sentimentCftcCotAdapter.js");
  const stubs = jest.requireActual(
    "./support/recordedLaneStubs.js"
  ) as typeof import("./support/recordedLaneStubs.js");
  return { ...actual, sentimentCftcCotAdapter: stubs.recordedSentimentCftcCotAdapter() };
});
jest.mock("../../src/providers/adapters/newsSecEdgarAdapter.js", () => {
  const actual = jest.requireActual(
    "../../src/providers/adapters/newsSecEdgarAdapter.js"
  ) as typeof import("../../src/providers/adapters/newsSecEdgarAdapter.js");
  const stubs = jest.requireActual(
    "./support/recordedLaneStubs.js"
  ) as typeof import("./support/recordedLaneStubs.js");
  return { ...actual, newsSecEdgarAdapter: stubs.recordedNewsSecEdgarAdapter() };
});
jest.mock("../../src/providers/adapters/aimlTinyBrainsAdapter.js", () => {
  const actual = jest.requireActual(
    "../../src/providers/adapters/aimlTinyBrainsAdapter.js"
  ) as typeof import("../../src/providers/adapters/aimlTinyBrainsAdapter.js");
  const stubs = jest.requireActual(
    "./support/recordedLaneStubs.js"
  ) as typeof import("./support/recordedLaneStubs.js");
  return { ...actual, aimlTinyBrainsAdapter: stubs.recordedAimlTinyBrainsAdapter() };
});

import app from "../../src/server.js";
import { setEvidenceStore, resetEvidenceStore } from "../../src/evidence/index.js";
import { shutdownDedupeCache } from "../../src/services/ingestDedupeService.js";
import {
  EVIDENCE_REPLAY_EXCLUDED_FIELDS,
} from "../../src/evidence/provenance/invocationProofHashes.js";
import { canonicalize, stripExcluded } from "../../src/pipeline/hashing.js";
import {
  OracleEvidenceStore,
  installOracleEnv,
  disableNetwork,
  loadFixture,
} from "./support/oracleHarness.js";

let restoreEnv: () => void;
let restoreNet: () => void;

beforeAll(() => {
  restoreEnv = installOracleEnv();
  restoreNet = disableNetwork(); // every remote lane is stubbed
  shutdownDedupeCache();
});

afterAll(() => {
  jest.useRealTimers();
  resetEvidenceStore();
  shutdownDedupeCache();
  restoreNet();
  restoreEnv();
});

interface RunCapture {
  record: Record<string, unknown> & {
    recordHash: { value: string };
    replayHash: { value: string };
  };
  responseScoredAt: string;
}

async function runOnce(endpoint: string, payload: unknown): Promise<RunCapture> {
  const store = new OracleEvidenceStore();
  setEvidenceStore(store);
  const res = await request(app).post(endpoint).send(payload as object);
  expect(res.status).toBe(200);
  expect(store.submissions).toHaveLength(1);
  const isCpj = endpoint === "/api/ingest/cpj";
  const scored = isCpj ? res.body.pipelineResult : res.body;
  return { record: store.submissions[0], responseScoredAt: scored.scoredAt };
}

/** The exact D-EV3-4(6) replay projection, canonically serialized. */
function replayProjection(record: object): string {
  return canonicalize(stripExcluded(record, EVIDENCE_REPLAY_EXCLUDED_FIELDS));
}

/** Fake ONLY Date (wall clock); every scheduler/IO primitive stays real. */
function fakeDateOnly(now: Date): void {
  jest.useFakeTimers({
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
    now,
  });
}

describe.each([
  ["tradingview", "/api/webhooks/tradingview", "tradingview/tv-long.json"],
  ["cpj", "/api/ingest/cpj", "cpj/cpj-blofin-perp-long.json"],
])("oracle replay determinism (%s)", (_label, endpoint, file) => {
  it("the same evaluation twice → byte-identical records, replay projections, replayHash, recordHash", async () => {
    const payload = loadFixture(file);
    const a = await runOnce(endpoint, payload);
    const b = await runOnce(endpoint, payload);

    // full byte identity of the canonical record — WITHOUT any volatile
    // normalization (the v3 record admits no wall-clock surface)
    expect(canonicalize(b.record)).toBe(canonicalize(a.record));
    // the explicit D-EV3-4(6)/(7) replay separation
    expect(replayProjection(b.record)).toBe(replayProjection(a.record));
    expect(b.record.replayHash.value).toBe(a.record.replayHash.value);
    expect(b.record.recordHash.value).toBe(a.record.recordHash.value);
  }, 30_000);

  it("a wall-clock perturbation (+7h, Date-only fake timers) moves the operational timestamps but NOT the record, recordHash, or replayHash", async () => {
    const payload = loadFixture(file);
    const before = await runOnce(endpoint, payload);

    fakeDateOnly(new Date(Date.parse(before.responseScoredAt) + 7 * 60 * 60 * 1000));
    let after: RunCapture;
    try {
      after = await runOnce(endpoint, payload);
    } finally {
      jest.useRealTimers();
    }

    // the perturbation was REAL: the run's operational clock moved…
    expect(after.responseScoredAt).not.toBe(before.responseScoredAt);
    // …and the canonical record did not move with it
    expect(canonicalize(after.record)).toBe(canonicalize(before.record));
    expect(after.record.recordHash.value).toBe(before.record.recordHash.value);
    expect(after.record.replayHash.value).toBe(before.record.replayHash.value);
  }, 30_000);
});
