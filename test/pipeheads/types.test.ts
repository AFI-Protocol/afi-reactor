import { describe, it, expect } from "@jest/globals";
import {
  ANALYSIS_LANE_IDS,
  type AnalysisLaneId,
  type PipeheadKind,
  type PipeheadContext,
  type PipeheadExecutionResult,
  type Pipehead,
  type AnalysisLaneResult,
  type AnalysisBundle,
  type InternalScoringResult,
  type ScoredSignalV1,
  type ProvenanceRecordV1,
  type ReplayProfileV1,
} from "../../src/pipeheads/index.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";

describe("ANALYSIS_LANE_IDS", () => {
  it("is a length-5 tuple in the canonical stable order", () => {
    expect(ANALYSIS_LANE_IDS).toEqual([
      "technical-indicators",
      "pattern-recognition",
      "news",
      "social",
      "ai-ml",
    ]);
    expect(ANALYSIS_LANE_IDS.length).toBe(5);
  });

  it("has no duplicate lane ids", () => {
    expect(new Set(ANALYSIS_LANE_IDS).size).toBe(ANALYSIS_LANE_IDS.length);
  });
});

describe("core contracts are constructible to the §4 shapes", () => {
  it("builds an AnalysisLaneResult", () => {
    const result: AnalysisLaneResult<{ rsi: number }> = {
      lane: "technical-indicators",
      provisional: false,
      payload: { rsi: 55 },
      confidence: 0.8,
      notes: ["wired"],
    };
    expect(result.lane).toBe("technical-indicators");
    expect(result.provisional).toBe(false);
  });

  it("builds a PipeheadExecutionResult with clock-derived timestamps", () => {
    const clock = createFrozenClock();
    const exec: PipeheadExecutionResult<{ ok: true }> = {
      pipeheadId: "schema-validation",
      kind: "validation",
      status: "ok",
      provisional: false,
      output: { ok: true },
      startedAt: clock(),
      finishedAt: clock(),
    };
    expect(exec.status).toBe("ok");
    expect(exec.startedAt).toBe(exec.finishedAt);
  });

  it("builds an AnalysisBundle with all five lane keys", () => {
    const laneResult = (lane: AnalysisLaneId): AnalysisLaneResult => ({
      lane,
      provisional: lane === "news" || lane === "social" || lane === "ai-ml",
      payload: {},
    });
    const bundle: AnalysisBundle = {
      signalId: "btc-4h-1",
      symbol: "BTC/USDT",
      market: "perp",
      timeframe: "4h",
      lanes: {
        "technical-indicators": laneResult("technical-indicators"),
        "pattern-recognition": laneResult("pattern-recognition"),
        news: laneResult("news"),
        social: laneResult("social"),
        "ai-ml": laneResult("ai-ml"),
      },
      provisionalLanes: ["news", "social", "ai-ml"],
      enrichedView: {},
    };
    expect(Object.keys(bundle.lanes).sort()).toEqual([...ANALYSIS_LANE_IDS].sort());
  });

  it("builds the internal scoring carrier (never emitted outward)", () => {
    const scored: InternalScoringResult = {
      signalId: "btc-4h-1",
      uwrScore: 0.5,
      uwrAxes: { structure: 0.5, execution: 0.5, risk: 0.5, insight: 0.5 },
      analystScore: { analystId: "froggy" },
      scoredAt: "2025-01-01T00:00:00.000Z",
    };
    expect(scored.uwrScore).toBe(0.5);
    // the internal carrier is a plain runtime type: no demo/outward flags
    expect("demoOnly" in scored).toBe(false);
    expect("provisional" in scored).toBe(false);
  });

  it("builds D2-native outward artifact shapes (ScoredSignal/ProvenanceRecord/ReplayProfile)", () => {
    const hash = {
      algorithm: "sha256" as const,
      canonicalizationVersion: "afi.hash.v1" as const,
      domainTag: "afi.d2.signal-input",
      value: "0".repeat(64),
    };
    const scoredSignal: ScoredSignalV1 = {
      schema: "afi.scored-signal.v1",
      signalId: "btc-4h-1",
      analystId: "froggy",
      strategyId: "trend_pullback_v1",
      direction: "neutral",
      uwrScore: 0.5,
      provenanceRecordRef: "provenance-record:btc-4h-1",
    };
    const record: ProvenanceRecordV1 = {
      schema: "afi.provenance-record.v1",
      signalId: "btc-4h-1",
      canonicalizationVersion: "afi.hash.v1",
      inputHash: hash,
      outputHash: { ...hash, domainTag: "afi.d2.scored-output" },
    };
    const replay: ReplayProfileV1 = {
      schema: "afi.replay-profile.v1",
      replayabilityLevel: "deterministic",
      factsRequired: true,
    };
    expect(scoredSignal.schema).toBe("afi.scored-signal.v1");
    expect(record.canonicalizationVersion).toBe("afi.hash.v1");
    expect(replay.factsRequired).toBe(true);
  });

  it("Pipehead and PipeheadContext/PipeheadKind compose", () => {
    const kind: PipeheadKind = "analysis-lane";
    const ctx: PipeheadContext = {
      signalId: "btc-4h-1",
      rawUss: {},
      clock: createFrozenClock(),
    };
    const pipehead: Pipehead<unknown, { lane: AnalysisLaneId }> = {
      id: "technical-lane",
      kind,
      lane: "technical-indicators",
      async execute(_input, c) {
        return {
          pipeheadId: this.id,
          kind: this.kind,
          status: "ok",
          provisional: false,
          output: { lane: "technical-indicators" },
          startedAt: c.clock(),
          finishedAt: c.clock(),
        };
      },
    };
    expect(pipehead.kind).toBe("analysis-lane");
    expect(ctx.signalId).toBe("btc-4h-1");
  });
});
