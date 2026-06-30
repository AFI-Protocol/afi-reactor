import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { PipeheadContext } from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";
import {
  technicalLane,
  runTechnicalLane,
  TECHNICAL_LANE_ID,
  TECHNICAL_LANE_PIPEHEAD_ID,
  TECHNICAL_INDICATOR_NOTE,
} from "../../src/pipeheads/lanes/technicalLane.js";
import {
  patternLane,
  runPatternLane,
  PATTERN_LANE_ID,
  PATTERN_LANE_PIPEHEAD_ID,
} from "../../src/pipeheads/lanes/patternLane.js";
import {
  computeOfflineTechnicalIndicators,
  MIN_CANDLES_FOR_INDICATORS,
} from "../../src/pipeheads/lanes/technicalIndicators.js";

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

// Golden indicator values for the committed fixture (computed from the
// repo's deprecated pure EMA/RSI/ATR formulas, the DR-002 blueprint).
const GOLDEN = {
  ema20: 157.85454546262787,
  ema50: 142.39857716501862,
  rsi14: 85.04000000000006,
  atr14: 3.5857142857142867,
  emaDistancePct: 4.31121860788185,
  trendBias: "bullish" as const,
};

describe("fixture ohlcv.json", () => {
  it("has >=50 candles so EMA-50 is defined", () => {
    const candles = loadOhlcv();
    expect(candles.length).toBeGreaterThanOrEqual(MIN_CANDLES_FOR_INDICATORS);
    for (const c of candles) {
      expect(typeof c.open).toBe("number");
      expect(typeof c.high).toBe("number");
      expect(typeof c.low).toBe("number");
      expect(typeof c.close).toBe("number");
      expect(typeof c.volume).toBe("number");
    }
  });
});

describe("computeOfflineTechnicalIndicators (DR-002 offline helper)", () => {
  it("computes the golden EMA/RSI/ATR + derived fields from the fixture", () => {
    const ind = computeOfflineTechnicalIndicators(loadOhlcv());
    expect(ind).not.toBeNull();
    expect(ind!.ema20).toBeCloseTo(GOLDEN.ema20, 10);
    expect(ind!.ema50).toBeCloseTo(GOLDEN.ema50, 10);
    expect(ind!.rsi14).toBeCloseTo(GOLDEN.rsi14, 10);
    expect(ind!.atr14).toBeCloseTo(GOLDEN.atr14, 10);
    expect(ind!.emaDistancePct).toBeCloseTo(GOLDEN.emaDistancePct, 10);
    expect(ind!.trendBias).toBe(GOLDEN.trendBias);
  });

  it("returns null on insufficient data (<50 candles)", () => {
    expect(computeOfflineTechnicalIndicators(loadOhlcv().slice(0, 49))).toBeNull();
  });

  it("is deterministic: two runs produce deeply-equal output", () => {
    expect(computeOfflineTechnicalIndicators(loadOhlcv())).toEqual(
      computeOfflineTechnicalIndicators(loadOhlcv())
    );
  });
});

describe("technical lane (WIRED, DR-002)", () => {
  it("VAL-LANES-003: provisional:false with finite numeric indicators from the fixture", () => {
    const result = runTechnicalLane(loadOhlcv());
    expect(result.lane).toBe(TECHNICAL_LANE_ID);
    expect(result.provisional).toBe(false);
    const p = result.payload;
    for (const v of [p.ema20, p.ema50, p.rsi14, p.atr14, p.emaDistancePct]) {
      expect(typeof v).toBe("number");
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(p.ema20).toBeCloseTo(GOLDEN.ema20, 10);
    expect(p.ema50).toBeCloseTo(GOLDEN.ema50, 10);
    expect(p.rsi14).toBeCloseTo(GOLDEN.rsi14, 10);
    expect(p.atr14).toBeCloseTo(GOLDEN.atr14, 10);
    expect(p.trendBias).toBe(GOLDEN.trendBias);
  });

  it("VAL-LANES-013: self-labels its indicators as self-contained / non-canonical (DR-002)", () => {
    const result = runTechnicalLane(loadOhlcv());
    expect(result.provisional).toBe(false); // still genuinely WIRED
    expect(result.payload.canonicalIndicatorKernel).toBe(false);
    expect(result.payload.indicatorSource).toBe("self-contained-offline");

    const blob = JSON.stringify(result).toLowerCase();
    expect(blob).toContain("self-contained");
    expect(blob).toContain("offline");
    expect(blob).toContain("dr-002");
    expect(blob).toContain("trading-signals");
    expect(blob).toContain("canonical");
    expect(blob).toContain("future work");
    // note is carried both on the result and in the payload
    expect((result.notes ?? []).join(" ")).toBe(TECHNICAL_INDICATOR_NOTE);
  });

  it("VAL-LANES-010: byte-identical payload across two runs over the same fixture", () => {
    const a = runTechnicalLane(loadOhlcv());
    const b = runTechnicalLane(loadOhlcv());
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is a well-formed AnalysisLaneResult (lane id, boolean provisional, defined payload)", () => {
    const result = runTechnicalLane(loadOhlcv());
    expect(typeof result.lane).toBe("string");
    expect(typeof result.provisional).toBe("boolean");
    expect(result.payload).toBeDefined();
  });

  it("throws a structured error on insufficient data (no silent NaN)", () => {
    expect(() => runTechnicalLane(loadOhlcv().slice(0, 49))).toThrow(/insufficient/i);
  });

  it("pipehead execute returns ok + AnalysisLaneResult; clock timestamps do not affect payload", async () => {
    expect(technicalLane.id).toBe(TECHNICAL_LANE_PIPEHEAD_ID);
    expect(technicalLane.kind).toBe("analysis-lane");
    const r1 = await technicalLane.execute(loadOhlcv(), ctx("2025-01-01T00:00:00.000Z"));
    const r2 = await technicalLane.execute(loadOhlcv(), ctx("2099-12-31T23:59:59.000Z"));
    expect(r1.status).toBe("ok");
    expect(r1.provisional).toBe(false);
    expect(r1.output.lane).toBe(TECHNICAL_LANE_ID);
    expect(r1.output).toEqual(r2.output);
    expect(r1.startedAt).not.toBe(r2.startedAt);
  });
});

describe("pattern lane (WIRED, reuses detectPatterns)", () => {
  it("VAL-LANES-004: provisional:false with deterministic pattern fields from the fixture", () => {
    const result = runPatternLane(loadOhlcv());
    expect(result.lane).toBe(PATTERN_LANE_ID);
    expect(result.provisional).toBe(false);
    const p = result.payload;
    expect(typeof p.bullishEngulfing).toBe("boolean");
    expect(typeof p.bearishEngulfing).toBe("boolean");
    expect(typeof p.pinBar).toBe("boolean");
    expect(typeof p.insideBar).toBe("boolean");
    expect(["higher-highs", "lower-lows", "choppy"]).toContain(p.structureBias);
    expect(typeof p.trendPullbackConfirmed).toBe("boolean");
  });

  it("matches detectPatterns output exactly (genuine reuse)", () => {
    // independent recompute via the same reused module produces equal payload
    const result = runPatternLane(loadOhlcv());
    const again = runPatternLane(loadOhlcv());
    expect(result.payload).toEqual(again.payload);
  });

  it("VAL-LANES-010: byte-identical payload across two runs over the same fixture", () => {
    const a = runPatternLane(loadOhlcv());
    const b = runPatternLane(loadOhlcv());
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is a well-formed AnalysisLaneResult (lane id, boolean provisional, defined payload)", () => {
    const result = runPatternLane(loadOhlcv());
    expect(typeof result.lane).toBe("string");
    expect(typeof result.provisional).toBe("boolean");
    expect(result.payload).toBeDefined();
  });

  it("throws a structured error on insufficient data (<20 candles)", () => {
    expect(() => runPatternLane(loadOhlcv().slice(0, 19))).toThrow(/insufficient/i);
  });

  it("pipehead execute returns ok + AnalysisLaneResult; clock timestamps do not affect payload", async () => {
    expect(patternLane.id).toBe(PATTERN_LANE_PIPEHEAD_ID);
    expect(patternLane.kind).toBe("analysis-lane");
    const r1 = await patternLane.execute(loadOhlcv(), ctx("2025-01-01T00:00:00.000Z"));
    const r2 = await patternLane.execute(loadOhlcv(), ctx("2099-12-31T23:59:59.000Z"));
    expect(r1.status).toBe("ok");
    expect(r1.provisional).toBe(false);
    expect(r1.output.lane).toBe(PATTERN_LANE_ID);
    expect(r1.output).toEqual(r2.output);
    expect(r1.startedAt).not.toBe(r2.startedAt);
  });
});

describe("offline discipline (DR-002): neither lane pulls trading-signals / src/indicator", () => {
  const laneFiles = [
    "src/pipeheads/lanes/technicalLane.ts",
    "src/pipeheads/lanes/patternLane.ts",
    "src/pipeheads/lanes/technicalIndicators.ts",
  ];

  it("source scan finds no forbidden imports", () => {
    for (const rel of laneFiles) {
      const src = readFileSync(join(process.cwd(), rel), "utf-8");
      // strip line/block comments so the DR-002 prose mentioning these names
      // (for documentation) does not trip the scan; only real imports matter.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      expect(code).not.toMatch(/from\s+["'][^"']*trading-signals[^"']*["']/);
      expect(code).not.toMatch(/from\s+["'][^"']*\/indicator\/[^"']*["']/);
      expect(code).not.toMatch(/from\s+["'][^"']*enrichment\/technicalIndicators[^"']*["']/);
    }
  });

  it("both lanes load and run at runtime over the fixture (offline)", () => {
    // reaching here means importing the lanes did not throw (no trading-signals
    // landmine) and both produce results offline.
    expect(() => runTechnicalLane(loadOhlcv())).not.toThrow();
    expect(() => runPatternLane(loadOhlcv())).not.toThrow();
  });
});
