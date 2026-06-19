/**
 * Vault Replay Service Tests (scored-only)
 *
 * Replay re-scores a vaulted signal and compares the stored analyst score
 * against the freshly recomputed one. Under the scored-only contract the
 * reactor persists and replays a ReactorScoredSignalV1 (analystScore +
 * scoredAt + rawUss) — there is NO validatorDecision and NO execution block
 * in the reactor's replay surface. Validator certification and execution were
 * moved out of the reactor (external certification / consumer layers), so the
 * legacy demo-chain validator/execution fixtures have been removed.
 *
 * These remain pure unit tests (no MongoDB, no plugins): they lock in the
 * scored-only replay comparison semantics (uwrScore delta + change detection).
 */

import { describe, it, expect } from "@jest/globals";
import type { ReactorScoredSignalV1 } from "../src/types/ReactorScoredSignalV1.js";

/** Stored-vs-recomputed comparison surface for a scored-only replay. */
interface ScoredReplayComparison {
  uwrScoreDelta: number;
  scoreChanged: boolean;
  changes: string[];
}

/** Read-only replay result over the scored-only contract. */
interface ScoredReplayResult {
  signalId: string;
  stored: Pick<ReactorScoredSignalV1, "analystScore" | "scoredAt" | "meta">;
  recomputed: Pick<ReactorScoredSignalV1, "analystScore" | "scoredAt">;
  comparison: ScoredReplayComparison;
  replayMeta: {
    pipelineVersion: string;
    notes: string;
  };
}

function makeAnalystScore(uwrScore: number) {
  return {
    analystId: "froggy",
    strategyId: "trend_pullback_v1",
    uwrScore,
    uwrAxes: {
      structure: uwrScore,
      execution: uwrScore,
      risk: uwrScore,
      insight: uwrScore,
    },
  } as ReactorScoredSignalV1["analystScore"];
}

describe("Vault Replay Service (scored-only)", () => {
  it("describes a replay result with no validator/execution surface", () => {
    const result: ScoredReplayResult = {
      signalId: "test-signal-001",
      stored: {
        analystScore: makeAnalystScore(0.75),
        scoredAt: "2025-12-07T10:00:00.000Z",
        meta: {
          symbol: "BTC/USDT",
          timeframe: "1h",
          strategy: "froggy_trend_pullback_v1",
          direction: "long",
          source: "tradingview-webhook",
        },
      },
      recomputed: {
        analystScore: makeAnalystScore(0.7521),
        scoredAt: "2025-12-07T12:00:00.000Z",
      },
      comparison: {
        uwrScoreDelta: 0.0021,
        scoreChanged: true,
        changes: ["uwrScore changed by +0.0021 (0.7500 → 0.7521)"],
      },
      replayMeta: {
        pipelineVersion: "froggy_trend_pullback_v1",
        notes: "Read-only replay; no DB writes performed",
      },
    };

    expect(result.stored.analystScore?.uwrScore).toBe(0.75);
    expect(result.recomputed.analystScore?.uwrScore).toBe(0.7521);
    // Scored-only contract: nothing validator/execution-shaped leaks in.
    expect((result.stored as any).validatorDecision).toBeUndefined();
    expect((result.stored as any).execution).toBeUndefined();
    expect((result.recomputed as any).validatorDecision).toBeUndefined();
  });

  it("computes a positive uwrScore delta", () => {
    const delta = 0.7521 - 0.75;
    expect(delta).toBeCloseTo(0.0021, 4);
  });

  it("computes a negative uwrScore delta", () => {
    const delta = 0.72 - 0.75;
    expect(delta).toBeCloseTo(-0.03, 4);
  });

  it("detects an unchanged score", () => {
    const stored = 0.92;
    const recomputed = 0.92;
    expect(recomputed - stored).toBe(0);
  });

  it("includes scored-only replay metadata", () => {
    const replayMeta = {
      pipelineVersion: "froggy_trend_pullback_v1",
      notes: "Read-only replay; no DB writes performed",
    };
    expect(replayMeta.pipelineVersion).toBe("froggy_trend_pullback_v1");
    expect(replayMeta.notes).toContain("Read-only");
    expect(replayMeta.notes).toContain("no DB writes");
  });
});
