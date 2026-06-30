import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type {
  AnalysisLaneId,
  AnalysisLaneResult,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { ANALYSIS_LANE_IDS } from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";
import {
  fanOut,
  indexLaneResults,
  isDegradedLaneResult,
  DEFAULT_LANE_RUNNERS,
  LANE_PROVISIONAL,
  WIRED_LANE_IDS,
  PROVISIONAL_LANE_IDS,
  type FanOutInput,
  type LaneRunner,
} from "../../src/pipeheads/fanOut.js";

function loadOhlcv(): AfiCandle[] {
  const fixturePath = join(process.cwd(), "test/pipeheads/fixtures/ohlcv.json");
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as AfiCandle[];
}

function ctx(iso?: string): PipeheadContext {
  return {
    signalId: "btc-usdt-perp-4h-0001",
    rawUss: {},
    clock: createFrozenClock(iso),
  };
}

function input(candles: AfiCandle[] = loadOhlcv()): FanOutInput {
  return { candles };
}

const CANONICAL: AnalysisLaneId[] = [
  "technical-indicators",
  "pattern-recognition",
  "news",
  "social",
  "ai-ml",
];

describe("fanOut five-lane coordinator", () => {
  it("VAL-LANES-001: always emits exactly five lane results from the canonical set", async () => {
    const results = await fanOut(input(), ctx());
    expect(results).toHaveLength(5);
    const ids = results.map((r) => r.lane);
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort()).toEqual([...CANONICAL].sort());
    for (const id of ids) expect(CANONICAL).toContain(id);
  });

  it("VAL-LANES-002: lane ids appear in the pinned stable order, stable across runs", async () => {
    const a = await fanOut(input(), ctx());
    const b = await fanOut(input(), ctx());
    expect(a.map((r) => r.lane)).toEqual(ANALYSIS_LANE_IDS);
    expect(a.map((r) => r.lane)).toEqual(b.map((r) => r.lane));
    expect(ANALYSIS_LANE_IDS).toHaveLength(5);
  });

  it("VAL-LANES-008: every lane result is a well-formed AnalysisLaneResult", async () => {
    const results = await fanOut(input(), ctx());
    for (const r of results) {
      expect(typeof r.lane).toBe("string");
      expect(typeof r.provisional).toBe("boolean");
      expect(r.payload).toBeDefined();
    }
  });

  it("VAL-LANES-009: wired/provisional split is exact and all five present", async () => {
    const results = await fanOut(input(), ctx());
    const wired = results.filter((r) => r.provisional === false).map((r) => r.lane);
    const prov = results.filter((r) => r.provisional === true).map((r) => r.lane);
    expect([...wired].sort()).toEqual([...WIRED_LANE_IDS].sort());
    expect([...prov].sort()).toEqual([...PROVISIONAL_LANE_IDS].sort());
    // no lane silently dropped
    expect(new Set(results.map((r) => r.lane)).size).toBe(5);
  });

  it("VAL-LANES-009: even on sparse OHLCV all five lanes are present with exact split", async () => {
    // 10 candles is below the wired-lane minimums (EMA-50 needs >=50, patterns >=20)
    const results = await fanOut(input(loadOhlcv().slice(0, 10)), ctx());
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.lane)).toEqual(ANALYSIS_LANE_IDS);
    const wired = results.filter((r) => r.provisional === false).map((r) => r.lane);
    const prov = results.filter((r) => r.provisional === true).map((r) => r.lane);
    expect([...wired].sort()).toEqual([...WIRED_LANE_IDS].sort());
    expect([...prov].sort()).toEqual([...PROVISIONAL_LANE_IDS].sort());
    // the wired lanes degraded (insufficient data) but were NOT dropped
    const tech = results.find((r) => r.lane === "technical-indicators")!;
    expect(isDegradedLaneResult(tech)).toBe(true);
  });

  it("default runners map each lane to its canonical provisional flag", async () => {
    const results = await fanOut(input(), ctx());
    for (const r of results) {
      expect(r.provisional).toBe(LANE_PROVISIONAL[r.lane]);
    }
    expect(LANE_PROVISIONAL["technical-indicators"]).toBe(false);
    expect(LANE_PROVISIONAL["pattern-recognition"]).toBe(false);
    expect(LANE_PROVISIONAL.news).toBe(true);
    expect(LANE_PROVISIONAL.social).toBe(true);
    expect(LANE_PROVISIONAL["ai-ml"]).toBe(true);
  });

  it("is deterministic: two runs with a frozen clock are deeply equal", async () => {
    const a = await fanOut(input(), ctx("2025-01-01T00:00:00.000Z"));
    const b = await fanOut(input(), ctx("2099-12-31T23:59:59.000Z"));
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("indexLaneResults builds a record with all five canonical keys", async () => {
    const results = await fanOut(input(), ctx());
    const record = indexLaneResults(results);
    expect(Object.keys(record).sort()).toEqual([...CANONICAL].sort());
    for (const id of CANONICAL) expect(record[id].lane).toBe(id);
  });
});

describe("fanOut lane error-isolation (VAL-LANES-011, fault injection)", () => {
  function throwingRunners(faulted: AnalysisLaneId): Record<AnalysisLaneId, LaneRunner> {
    return {
      ...DEFAULT_LANE_RUNNERS,
      [faulted]: () => {
        throw new Error(`injected fault in ${faulted}`);
      },
    };
  }

  it("a single throwing lane degrades without aborting fan-out; all five keys remain", async () => {
    const results = await fanOut(input(), ctx(), throwingRunners("news"));
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.lane)).toEqual(ANALYSIS_LANE_IDS);
  });

  it("the whole fan-out does not throw when one lane throws", async () => {
    await expect(fanOut(input(), ctx(), throwingRunners("technical-indicators"))).resolves.toBeDefined();
  });

  it("the faulted lane carries a structured error/degraded marker", async () => {
    const results = await fanOut(input(), ctx(), throwingRunners("ai-ml"));
    const faulted = results.find((r) => r.lane === "ai-ml")!;
    expect(isDegradedLaneResult(faulted)).toBe(true);
    const payload = faulted.payload as { error: boolean; degraded: boolean; message: string };
    expect(payload.error).toBe(true);
    expect(payload.degraded).toBe(true);
    expect(typeof payload.message).toBe("string");
    expect(payload.message).toContain("injected fault");
    expect((faulted.notes ?? []).join(" ").toLowerCase()).toContain("degraded");
  });

  it("the other four lanes are unaffected (match their fault-free payloads)", async () => {
    const clean = await fanOut(input(), ctx());
    const faulted = await fanOut(input(), ctx(), throwingRunners("pattern-recognition"));
    for (const id of ANALYSIS_LANE_IDS) {
      if (id === "pattern-recognition") continue;
      const a = clean.find((r) => r.lane === id)!;
      const b = faulted.find((r) => r.lane === id)!;
      expect(b).toEqual(a);
    }
  });

  it("a degraded wired lane keeps provisional:false so the partition stays exact", async () => {
    const results = await fanOut(input(), ctx(), throwingRunners("technical-indicators"));
    const tech = results.find((r) => r.lane === "technical-indicators")!;
    expect(isDegradedLaneResult(tech)).toBe(true);
    expect(tech.provisional).toBe(false);
    const wired = results.filter((r) => r.provisional === false).map((r) => r.lane);
    expect([...wired].sort()).toEqual([...WIRED_LANE_IDS].sort());
  });

  it("a degraded provisional lane keeps provisional:true", async () => {
    const results = await fanOut(input(), ctx(), throwingRunners("social"));
    const social = results.find((r) => r.lane === "social")!;
    expect(isDegradedLaneResult(social)).toBe(true);
    expect(social.provisional).toBe(true);
  });

  it("a non-degraded normal lane result is not flagged degraded", async () => {
    const results = await fanOut(input(), ctx());
    for (const r of results) {
      expect(isDegradedLaneResult(r)).toBe(false);
    }
  });

  it("isolates even when the runner rejects asynchronously", async () => {
    const runners: Record<AnalysisLaneId, LaneRunner> = {
      ...DEFAULT_LANE_RUNNERS,
      news: async () => {
        throw new Error("async injected fault in news");
      },
    };
    const results = await fanOut(input(), ctx(), runners);
    expect(results).toHaveLength(5);
    const news = results.find((r) => r.lane === "news")!;
    expect(isDegradedLaneResult(news)).toBe(true);
  });
});

describe("fanOut offline discipline", () => {
  it("source scan finds no network / DB / external-adapter imports", () => {
    const src = readFileSync(join(process.cwd(), "src/pipeheads/fanOut.ts"), "utf-8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["'][^"']*(fetch|axios|node-fetch|undici|ws|http|https|mongodb)["']/);
    expect(code).not.toMatch(/from\s+["'][^"']*adapters\//);
    expect(code).not.toMatch(/from\s+["'][^"']*trading-signals[^"']*["']/);
    expect(code).not.toMatch(/Math\.random|Date\.now/);
  });
});
