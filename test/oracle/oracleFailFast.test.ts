/**
 * ORACLE — evaluation-completeness law (EV3-GOV D-EV3-5(1)).
 *
 * REPLACES the retired fail-soft golden suite: under froggy-trend-pullback
 * v1.3.0 the five category lane nodes are CRITICAL (fail-fast under the
 * governed default) — the "providers OFF, network down, still scores"
 * environment that suite froze is structurally impossible now. A failed or
 * degraded lane yields NO scored evaluation, NO scored signal, and NO
 * evidence record — bounded operational diagnostics only (an honest 500;
 * never a masked 200, never a downgraded record, never a prior-version
 * write).
 *
 * Environment: the ORIGINAL fail-soft world — external providers OFF (no
 * keys, no TINY_BRAINS_URL) and global fetch disabled — with NO recorded
 * transports, so the remote reference lanes REALLY fail at their adapter
 * edges inside the one live graph pass.
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
  restoreNet = disableNetwork();
  shutdownDedupeCache();
});

afterAll(() => {
  resetEvidenceStore();
  shutdownDedupeCache();
  restoreNet();
  restoreEnv();
});

const CASES: Array<{ name: string; endpoint: string; file: string }> = [
  { name: "tv-long", endpoint: "/api/webhooks/tradingview", file: "tradingview/tv-long.json" },
  { name: "cpj-blofin-perp-long", endpoint: "/api/ingest/cpj", file: "cpj/cpj-blofin-perp-long.json" },
];

describe("D-EV3-5(1) — a failed lane aborts the evaluation (no score, no evidence)", () => {
  it.each(CASES)(
    "$name: remote-lane failure → honest 500, ZERO evidence submissions",
    async ({ endpoint, file }) => {
      const store = new OracleEvidenceStore();
      setEvidenceStore(store);

      const res = await request(app).post(endpoint).send(loadFixture(file));

      // fail-fast abort — never a masked 200, never a degraded score
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");
      // bounded operational diagnostics only: no scored surface, no
      // persistence claim, no evidence record of any version
      expect(res.body.analystScore).toBeUndefined();
      expect(res.body.pipelineResult).toBeUndefined();
      expect(res.body.persistence).toBeUndefined();
      expect(store.submissions).toHaveLength(0);
      expect(store.records.size).toBe(0);
    }
  );

  it("the diagnostics stay bounded: no raw lane payloads, credentials, or evidence content in the error envelope", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    const res = await request(app)
      .post("/api/webhooks/tradingview")
      .send(loadFixture("tradingview/tv-long.json"));
    expect(res.status).toBe(500);
    const envelope = JSON.stringify(res.body);
    // never a record, never a proof collection, never credential material
    expect(envelope).not.toContain("scored-signal-evidence");
    expect(envelope).not.toContain("providerInvocations");
    expect(envelope).not.toContain("recordHash");
    expect(envelope).not.toContain("headerValue");
    expect(store.submissions).toHaveLength(0);
  });
});
