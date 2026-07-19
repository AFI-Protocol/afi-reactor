/**
 * ORACLE-EQUIVALENCE — branch-order / repeat-run invariance.
 *
 * Runs the SAME committed fixture through the live path 5 times (all five
 * lanes on the shared RECORDED transports — v1.3.0 lanes are critical,
 * D-EV3-5(1)) and asserts the canonical surfaces are IDENTICAL on every run:
 * afi.hash.v1 inputHash + outputHash, the exact scorer input
 * (FroggyTrendPullbackInput), the byte-normalized governed evidence record,
 * and the EV3 record-level commitments (recordHash / replayHash). This pins
 * that nothing about DAG branch scheduling, PRNG state, or module-level
 * caching leaks into the canonical record — the equivalence bar the
 * manifest-driven executor must clear run-over-run, not just once.
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

// RECORDED remote-lane transports (shared stubs): under froggy v1.3.0 every
// lane is CRITICAL (EV3-GOV D-EV3-5(1)) — an invariance run must be a full
// five-lane scored run, so the remote lanes ride the same recorded fixed
// transports as the enriched golden suite.
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
import { scorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
// @ts-ignore — afi-core subpath types resolve via package exports; jest maps to source
import { buildFroggyTrendPullbackInputFromEnriched } from "afi-core/analysts/froggy.enrichment_adapter.js";
import {
  OracleEvidenceStore,
  installOracleEnv,
  disableNetwork,
  loadFixture,
  normalizeVolatile,
  stableStringify,
} from "./support/oracleHarness.js";

let restoreEnv: () => void;
let restoreNet: () => void;
// The scorer-node seam replaces the legacy analyst-plugin seam: the live
// path now scores through the registered scorer category node. The node's
// input IS the (aiMl-augmented) enriched view — same capture semantics.
const analystSpy = jest.spyOn(scorerFroggyTrendPullbackNode, "run");

beforeAll(() => {
  restoreEnv = installOracleEnv();
  restoreNet = disableNetwork();
  shutdownDedupeCache();
});

afterAll(() => {
  analystSpy.mockRestore();
  resetEvidenceStore();
  shutdownDedupeCache();
  restoreNet();
  restoreEnv();
});

const RUNS = 5;

describe.each([
  ["tradingview", "/api/webhooks/tradingview", "tradingview/tv-long.json"],
  ["cpj", "/api/ingest/cpj", "cpj/cpj-blofin-perp-long.json"],
])("oracle invariance (%s)", (_label, endpoint, file) => {
  it(`yields identical inputHash/outputHash/scorer-input/evidence bytes across ${RUNS} runs`, async () => {
    const payload = loadFixture(file);
    const captures: Array<{
      inputHash: string;
      outputHash: string;
      scorerInput: string;
      record: string;
      recordHash: string;
      replayHash: string;
      outcome: string;
    }> = [];

    for (let run = 0; run < RUNS; run++) {
      const store = new OracleEvidenceStore();
      setEvidenceStore(store); // fresh store: every run is a first write
      analystSpy.mockClear();

      const res = await request(app).post(endpoint).send(payload);
      expect(res.status).toBe(200);
      expect(store.submissions).toHaveLength(1);
      const record = store.submissions[0];
      const enrichedView = analystSpy.mock.calls[0][0];

      captures.push({
        inputHash: stableStringify(record.provenanceRecord.inputHash),
        outputHash: stableStringify(record.provenanceRecord.outputHash),
        scorerInput: stableStringify(
          buildFroggyTrendPullbackInputFromEnriched(enrichedView as never)
        ),
        record: stableStringify(normalizeVolatile(record)),
        // EV3-GOV D-EV3-4(7): identical canonical inputs → identical
        // record-level commitments run-over-run (the replay separation).
        recordHash: stableStringify(record.recordHash),
        replayHash: stableStringify(record.replayHash),
        outcome: res.body.persistence.outcome,
      });
    }

    const first = captures[0];
    for (const [i, c] of captures.entries()) {
      expect(c.outcome).toBe("inserted");
      expect([i, c.inputHash]).toEqual([i, first.inputHash]);
      expect([i, c.outputHash]).toEqual([i, first.outputHash]);
      expect([i, c.scorerInput]).toEqual([i, first.scorerInput]);
      expect([i, c.record]).toEqual([i, first.record]);
      expect([i, c.recordHash]).toEqual([i, first.recordHash]);
      expect([i, c.replayHash]).toEqual([i, first.replayHash]);
    }
  }, 30_000); // 5 sequential full runs incl. per-lane declared retry backoff
});
