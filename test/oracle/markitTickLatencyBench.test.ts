/**
 * MarkitTick warm-service latency BENCHMARK (preflight) — TradingView
 * Low-Latency Origin Prep v0.1.
 *
 * Drives the MarkitTick route in-process N times under the sanctioned low-latency
 * preflight configuration (technical demo feed + local pattern kernel REAL; the
 * three remote reference lanes served by recorded/cached transports) and reports
 * p50/p95 for total + per-stage + per-lane latency. This is the warm-service
 * latency metric for the preflight; the same numbers can be reproduced against a
 * live hosted reactor with deploy/tradingview-origin/bench-markittick.mjs.
 *
 * Latency doctrine (reported, not promised): total ≈ ingest + max(required lane)
 * + scorer + persistence. Warm local/cached/fast providers target <150–200ms;
 * slower provider selections (live CFTC/EDGAR/Tiny-Brains) run 1–3s+, bounded by
 * the slowest REQUIRED lane. These recorded lanes stand in for the fast/cached
 * selection.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import request from "supertest";

jest.mock("ccxt", () => {
  class X {}
  return { __esModule: true, default: { blofin: X, coinbase: X } };
});
jest.mock("../../src/providers/adapters/sentimentCftcCotAdapter.js", () => {
  const a = jest.requireActual("../../src/providers/adapters/sentimentCftcCotAdapter.js") as any;
  const s = jest.requireActual("./support/recordedLaneStubs.js") as any;
  return { ...a, sentimentCftcCotAdapter: s.recordedSentimentCftcCotAdapter() };
});
jest.mock("../../src/providers/adapters/newsSecEdgarAdapter.js", () => {
  const a = jest.requireActual("../../src/providers/adapters/newsSecEdgarAdapter.js") as any;
  const s = jest.requireActual("./support/recordedLaneStubs.js") as any;
  return { ...a, newsSecEdgarAdapter: s.recordedNewsSecEdgarAdapter() };
});
jest.mock("../../src/providers/adapters/aimlTinyBrainsAdapter.js", () => {
  const a = jest.requireActual("../../src/providers/adapters/aimlTinyBrainsAdapter.js") as any;
  const s = jest.requireActual("./support/recordedLaneStubs.js") as any;
  return { ...a, aimlTinyBrainsAdapter: s.recordedAimlTinyBrainsAdapter() };
});

import app from "../../src/server.js";
import { setEvidenceStore } from "../../src/evidence/index.js";
import { shutdownDedupeCache } from "../../src/services/ingestDedupeService.js";
import { __resetUwrRuntimeConfigForTests } from "../../src/config/uwrRuntimeProfile.js";
import { OracleEvidenceStore, installOracleEnv, disableNetwork, loadFixture } from "./support/oracleHarness.js";

const ENDPOINT = "/api/webhooks/tradingview/markittick";
const ITERATIONS = Number(process.env.MARKITTICK_BENCH_ITERS ?? 40);
const WARMUP = 5;

let restoreEnv: () => void;
let restoreNet: () => void;

beforeAll(() => {
  restoreEnv = installOracleEnv();
  restoreNet = disableNetwork();
  process.env.AFI_MARKITTICK_PROVIDER_ID = "oracle-provider-tv";
  // Exclude persistence from the pure warm-latency number (in-mem store adds
  // build+validate cost); a separate measured-persistence line is reported too.
  __resetUwrRuntimeConfigForTests();
  shutdownDedupeCache();
});

afterAll(() => {
  shutdownDedupeCache();
  restoreNet();
  restoreEnv();
  delete process.env.AFI_MARKITTICK_PROVIDER_ID;
});

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
function summarize(name: string, samples: number[]): { name: string; p50: number; p95: number; max: number; n: number } {
  const s = [...samples].sort((a, b) => a - b);
  return { name, p50: pct(s, 50), p95: pct(s, 95), max: s[s.length - 1] ?? 0, n: s.length };
}

describe("MarkitTick warm-service latency benchmark (preflight)", () => {
  it(`reports p50/p95 over ${ITERATIONS} warm iterations (persistence measured)`, async () => {
    setEvidenceStore(new OracleEvidenceStore());
    const total: number[] = [];
    const ingest: number[] = [];
    const mapper: number[] = [];
    const scorer: number[] = [];
    const persist: number[] = [];
    const laneSamples: Record<string, number[]> = {};

    for (let i = 0; i < WARMUP + ITERATIONS; i++) {
      // fresh signalId each iteration (avoid dedupe/append-once collisions)
      const payload = { ...loadFixture("tradingview/markittick-bull-cross.json"), signalId: `bench-${i}-${process.hrtime.bigint()}` };
      const res = await request(app).post(ENDPOINT).send(payload);
      expect(res.status).toBe(200);
      if (i < WARMUP) continue; // discard warmup
      const lat = res.body.latency;
      total.push(lat.totalLatencyMs);
      ingest.push(lat.ingestLatencyMs);
      mapper.push(lat.mapperLatencyMs);
      scorer.push(lat.scorerLatencyMs);
      persist.push(lat.persistenceLatencyMs);
      for (const l of lat.lanes) {
        (laneSamples[l.lane] ??= []).push(l.latencyMs);
      }
    }

    const rows = [
      summarize("total", total),
      summarize("ingest", ingest),
      summarize("mapper", mapper),
      summarize("scorer", scorer),
      summarize("persistence", persist),
    ];
    const laneRows = Object.entries(laneSamples).map(([lane, s]) => summarize(`lane:${lane}`, s));

    // eslint-disable-next-line no-console
    console.log(
      "\n=== MarkitTick warm-service latency (preflight: demo feed + recorded/cached remote lanes) ===\n" +
        `iterations=${ITERATIONS} (after ${WARMUP} warmup), clock=Date.now-ms, persistence=measured(in-mem)\n` +
        [...rows, ...laneRows]
          .map((r) => `  ${r.name.padEnd(16)} p50=${r.p50}ms  p95=${r.p95}ms  max=${r.max}ms  n=${r.n}`)
          .join("\n") +
        "\n"
    );

    // Non-flaky guard: warm in-process p95 must be well under the 1–3s slow-lane
    // regime (this catches a gross regression, not a tight SLO).
    const totalSummary = summarize("total", total);
    expect(totalSummary.p95).toBeLessThan(1500);
    expect(total.length).toBe(ITERATIONS);
  });
});
