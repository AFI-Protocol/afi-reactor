/**
 * WIRED Pattern Recognition lane.
 *
 * Reuses the repo's pure, offline `detectPatterns`
 * (`src/enrichment/patternRecognition.ts`) over committed fixture OHLCV.
 * `detectPatterns` imports types only (no `trading-signals`, no network), so it
 * is safe to reuse offline. The lane is genuinely WIRED (`provisional: false`,
 * real deterministic detection).
 *
 * Pure & deterministic given the candle input: no `Math.random`, no
 * `Date.now`, no network, no filesystem. Timestamps come from `ctx.clock()`
 * and never affect the payload.
 *
 * ESM: relative imports use `.js`.
 */

import type { AfiCandle } from "../../types/AfiCandle.js";
import type { PatternLensV1 } from "../../types/UssLenses.js";
import { detectPatterns } from "../../enrichment/patternRecognition.js";
import type {
  AnalysisLaneId,
  AnalysisLaneResult,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "../types.js";

export const PATTERN_LANE_ID: AnalysisLaneId = "pattern-recognition";
export const PATTERN_LANE_PIPEHEAD_ID = "pattern-lane";

export type PatternLanePayload = PatternLensV1["payload"];

/**
 * Pure pattern-lane computation. Produces a well-formed
 * {@link AnalysisLaneResult} with `provisional: false`, reusing `detectPatterns`
 * deterministically over the candle input.
 */
export function runPatternLane(
  candles: AfiCandle[]
): AnalysisLaneResult<PatternLanePayload> {
  const patterns = detectPatterns(candles);
  if (patterns === null) {
    throw new Error(
      `patternLane: insufficient OHLCV (need >=20 candles for pattern detection, got ${candles.length})`
    );
  }

  return {
    lane: PATTERN_LANE_ID,
    provisional: false,
    payload: patterns,
    confidence:
      typeof patterns.patternConfidence === "number"
        ? patterns.patternConfidence / 100
        : undefined,
  };
}

/**
 * The pattern lane as a typed pipehead. `execute(candles, ctx)` returns a
 * `PipeheadExecutionResult` wrapping the `AnalysisLaneResult`. Timestamps come
 * from `ctx.clock()` and are excluded from every hash.
 */
export const patternLane: Pipehead<AfiCandle[], AnalysisLaneResult<PatternLanePayload>> = {
  id: PATTERN_LANE_PIPEHEAD_ID,
  kind: "analysis-lane",
  lane: PATTERN_LANE_ID,
  async execute(
    candles: AfiCandle[],
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<AnalysisLaneResult<PatternLanePayload>>> {
    const startedAt = ctx.clock();
    const result = runPatternLane(candles);
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: "ok",
      provisional: false,
      output: result,
      startedAt,
      finishedAt,
    };
  },
};
