/**
 * ORACLE-EQUIVALENCE — branch-order / repeat-run invariance.
 *
 * Runs the SAME committed fixture through the live path 5 times and asserts
 * the canonical surfaces are IDENTICAL on every run: afi.hash.v1 inputHash +
 * outputHash, the exact scorer input (FroggyTrendPullbackInput), and the
 * byte-normalized governed evidence record. This pins that nothing about DAG
 * branch scheduling, PRNG state, or module-level caching leaks into the
 * canonical record — the equivalence bar the manifest-driven executor must
 * clear run-over-run, not just once.
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
    }
  });
});
