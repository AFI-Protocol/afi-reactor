/**
 * MarkitTick captured-payload PREFLIGHT scoring test — TradingView Low-Latency
 * Origin Prep v0.1.
 *
 * Drives the new POST /api/webhooks/tradingview/markittick route with CAPTURED
 * raw MarkitTick alert payloads (bull_cross, bear_cross) and asserts a REAL
 * synchronous scored 200 with Evidence V3 persistence + the latency
 * instrumentation block. Uses the same recorded-provider harness the enriched
 * oracle suite uses (technical demo feed + local pattern kernel run REAL; the
 * three remote reference lanes are served by recorded/cached transports) —
 * which is exactly the sanctioned low-latency preflight configuration.
 *
 * NOTE: this is preflight only. Real TradingView-origin acceptance is BLOCKED
 * until the TradingView account plan upgrade enables webhook URLs; originMode
 * stays "captured-preflight" here.
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
import {
  setEvidenceStore,
  resetEvidenceStore,
} from "../../src/evidence/index.js";
import { shutdownDedupeCache } from "../../src/services/ingestDedupeService.js";
import { __resetUwrRuntimeConfigForTests } from "../../src/config/uwrRuntimeProfile.js";
import {
  OracleEvidenceStore,
  installOracleEnv,
  disableNetwork,
  loadFixture,
} from "./support/oracleHarness.js";

const ENDPOINT = "/api/webhooks/tradingview/markittick";

let restoreEnv: () => void;
let restoreNet: () => void;

beforeAll(() => {
  restoreEnv = installOracleEnv();
  restoreNet = disableNetwork();
  // Raw MarkitTick alerts carry no providerId; the route injects this. The oracle
  // overlay binds `oracle-provider-tv` (webhook → froggy triple). In production
  // the default `giovanni_tradingview_staging` binding (real afi-config) is used.
  process.env.AFI_MARKITTICK_PROVIDER_ID = "oracle-provider-tv";
  __resetUwrRuntimeConfigForTests();
  shutdownDedupeCache();
});

afterAll(() => {
  resetEvidenceStore();
  shutdownDedupeCache();
  restoreNet();
  restoreEnv();
  delete process.env.AFI_MARKITTICK_PROVIDER_ID;
  __resetUwrRuntimeConfigForTests();
});

const CASES = [
  { name: "bull_cross → LONG", file: "tradingview/markittick-bull-cross.json", direction: "long" },
  { name: "bear_cross → SHORT", file: "tradingview/markittick-bear-cross.json", direction: "short" },
] as const;

describe("MarkitTick captured-payload preflight scoring", () => {
  it.each(CASES)("scores a captured %s with persistence + latency", async ({ file, direction }) => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);

    const res = await request(app).post(ENDPOINT).send(loadFixture(file));

    // --- real synchronous scored signal ---
    expect(res.status).toBe(200);
    expect(res.body.persistence?.outcome).toBe("inserted");
    expect(typeof res.body.analystScore?.uwrScore).toBe("number");
    expect(res.body.analystScore.uwrScore).toBeGreaterThanOrEqual(0);
    expect(res.body.analystScore.uwrScore).toBeLessThanOrEqual(1);

    // --- direction from the MarkitTick event ---
    expect(res.body.origin).toMatchObject({
      source: "tradingview",
      indicatorId: "markittick_adaptive_rsi_supertrend_v1",
      direction,
      providerId: "oracle-provider-tv",
      originMode: "captured-preflight",
    });
    expect(res.body.rawUss.facts.direction).toBe(direction);
    expect(res.body.rawUss.provenance.indicatorId).toBe(
      "markittick_adaptive_rsi_supertrend_v1"
    );
    expect(res.body.rawUss.provenance.originMode).toBe("captured-preflight");

    // --- latency instrumentation block ---
    const lat = res.body.latency;
    expect(lat).toBeDefined();
    expect(typeof lat.selectedProfileId).toBe("string");
    expect(lat.selectedProfileId).toContain("froggy/trend_pullback_v1");
    for (const k of [
      "totalLatencyMs",
      "ingestLatencyMs",
      "mapperLatencyMs",
      "scorerLatencyMs",
      "persistenceLatencyMs",
    ]) {
      expect(typeof lat[k]).toBe("number");
      expect(lat[k]).toBeGreaterThanOrEqual(0);
    }
    expect(lat.persistence).toBe("included");
    // per-lane latency + status
    expect(Array.isArray(lat.lanes)).toBe(true);
    const laneCats = lat.lanes.map((l: any) => l.lane);
    expect(laneCats).toContain("technical");
    expect(laneCats).toContain("scorer");
    for (const l of lat.lanes) {
      expect(typeof l.latencyMs).toBe("number");
      expect(typeof l.status).toBe("string");
    }
    // persisted evidence really landed
    expect(store.submissions).toHaveLength(1);
    expect(store.submissions[0].lifecycleState).toBe("SCORED");
  });

  it("rejects a deferred v0.1 event (squeeze_breakout) with a typed 422", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({ ticker: "BINANCE:BTCUSDT", tf: "5", event: "squeeze_breakout" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("deferred_event");
  });

  it("excludes persistence by config when AFI_MARKITTICK_PERSIST=false", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    process.env.AFI_MARKITTICK_PERSIST = "false";
    try {
      const res = await request(app)
        .post(ENDPOINT)
        .send(loadFixture("tradingview/markittick-bull-cross.json"));
      expect(res.status).toBe(200);
      expect(res.body.persistence.outcome).toBe("skipped-by-config");
      expect(res.body.latency.persistence).toBe("excluded-by-config");
      expect(res.body.latency.persistenceLatencyMs).toBe(0);
      expect(store.submissions).toHaveLength(0);
    } finally {
      delete process.env.AFI_MARKITTICK_PERSIST;
    }
  });
});
