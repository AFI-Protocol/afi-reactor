/**
 * Five-lane fan-out coordinator for the AFI Signal Evaluation Pipehead System
 * (non-production POC). Consumed later by the harness.
 *
 * Invariants (architecture.md §1.4 / §3, validation-contract VAL-LANES-001/002/
 * 008/009/011):
 *  - ALWAYS runs exactly the five canonical lanes, in the stable
 *    `ANALYSIS_LANE_IDS` order (length 5). The five-lane shape never collapses.
 *  - The wired/provisional split is exact: `technical-indicators` and
 *    `pattern-recognition` are wired (`provisional: false`); `news`, `social`,
 *    `ai-ml` are provisional (`provisional: true`).
 *  - Lane error-isolation: if one lane throws (or rejects), it degrades to a
 *    structured error/degraded `AnalysisLaneResult` WITHOUT aborting the other
 *    lanes. The returned set still contains all five canonical lanes, the other
 *    four are unaffected, and no lane is ever silently dropped.
 *
 * Pure & deterministic given `(input, ctx, runners)`: no `Math.random`, no
 * `Date.now`, no network, no DB, no filesystem. Timestamps come from
 * `ctx.clock()` and never affect any lane payload.
 *
 * ESM: relative imports use `.js`.
 */

import type { AfiCandle } from "../types/AfiCandle.js";
import type {
  AnalysisLaneId,
  AnalysisLaneResult,
  PipeheadContext,
} from "./types.js";
import { ANALYSIS_LANE_IDS } from "./types.js";
import { technicalLane } from "./lanes/technicalLane.js";
import { patternLane } from "./lanes/patternLane.js";
import { newsLane } from "./lanes/newsLane.js";
import { socialLane } from "./lanes/socialLane.js";
import { aimlLane } from "./lanes/aimlLane.js";

/** The two genuinely WIRED lanes (deterministic real math over fixture OHLCV). */
export const WIRED_LANE_IDS: readonly AnalysisLaneId[] = [
  "technical-indicators",
  "pattern-recognition",
] as const;

/** The three PROVISIONAL (committed-fixture) lanes. */
export const PROVISIONAL_LANE_IDS: readonly AnalysisLaneId[] = [
  "news",
  "social",
  "ai-ml",
] as const;

/**
 * Canonical `provisional` flag per lane. The fan-out preserves this flag even
 * when a lane degrades, so the wired/provisional partition stays exact
 * (VAL-LANES-009) regardless of faults.
 */
export const LANE_PROVISIONAL: Record<AnalysisLaneId, boolean> = {
  "technical-indicators": false,
  "pattern-recognition": false,
  news: true,
  social: true,
  "ai-ml": true,
};

/** Input to the fan-out: the committed fixture OHLCV consumed by the wired lanes. */
export interface FanOutInput {
  candles: AfiCandle[];
}

/**
 * A lane runner produces a single {@link AnalysisLaneResult} from the shared
 * fan-out input and context. This is the CLEAN SEAM that lets the harness (and
 * tests) inject alternate or fault-injecting lane implementations without
 * changing the coordinator.
 */
export type LaneRunner = (
  input: FanOutInput,
  ctx: PipeheadContext
) => AnalysisLaneResult | Promise<AnalysisLaneResult>;

/**
 * Default lane runners wired to the canonical lane pipeheads. The wired lanes
 * consume `input.candles`; the provisional lanes take no input.
 */
export const DEFAULT_LANE_RUNNERS: Record<AnalysisLaneId, LaneRunner> = {
  "technical-indicators": async (input, ctx) =>
    (await technicalLane.execute(input.candles, ctx)).output,
  "pattern-recognition": async (input, ctx) =>
    (await patternLane.execute(input.candles, ctx)).output,
  news: async (_input, ctx) => (await newsLane.execute(undefined, ctx)).output,
  social: async (_input, ctx) => (await socialLane.execute(undefined, ctx)).output,
  "ai-ml": async (_input, ctx) => (await aimlLane.execute(undefined, ctx)).output,
};

/** Human-readable self-label attached to every degraded lane result. */
export const DEGRADED_LANE_NOTE =
  "Lane DEGRADED: its runner threw and the failure was isolated by the fan-out " +
  "coordinator. The other lanes are unaffected and the five-lane set is preserved.";

/**
 * Structured, deterministic payload emitted when a lane runner throws/rejects.
 * Carries explicit `error`/`degraded` markers so callers can detect the failure
 * without a stack trace.
 */
export interface DegradedLanePayload {
  error: true;
  degraded: true;
  laneId: AnalysisLaneId;
  message: string;
  note: string;
}

/**
 * Type guard for a degraded lane result. True iff the payload carries the
 * `error`/`degraded` markers produced by {@link toDegradedLaneResult}.
 */
export function isDegradedLaneResult(
  result: AnalysisLaneResult
): result is AnalysisLaneResult<DegradedLanePayload> {
  const payload = result.payload as Partial<DegradedLanePayload> | null | undefined;
  return (
    payload !== null &&
    typeof payload === "object" &&
    (payload as DegradedLanePayload).error === true &&
    (payload as DegradedLanePayload).degraded === true
  );
}

function toDegradedLaneResult(
  lane: AnalysisLaneId,
  error: unknown
): AnalysisLaneResult<DegradedLanePayload> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    lane,
    provisional: LANE_PROVISIONAL[lane],
    payload: {
      error: true,
      degraded: true,
      laneId: lane,
      message,
      note: DEGRADED_LANE_NOTE,
    },
    notes: [DEGRADED_LANE_NOTE, `error: ${message}`],
  };
}

/**
 * Run the five canonical analysis lanes in stable order with per-lane error
 * isolation. Always returns exactly five {@link AnalysisLaneResult}s, one per
 * `ANALYSIS_LANE_IDS` entry and in that order. A lane whose runner throws (or
 * rejects) is replaced by a structured degraded result; the remaining lanes are
 * unaffected and no lane is dropped.
 */
export async function fanOut(
  input: FanOutInput,
  ctx: PipeheadContext,
  runners: Record<AnalysisLaneId, LaneRunner> = DEFAULT_LANE_RUNNERS
): Promise<AnalysisLaneResult[]> {
  const results: AnalysisLaneResult[] = [];
  for (const lane of ANALYSIS_LANE_IDS) {
    const runner = runners[lane];
    if (typeof runner !== "function") {
      results.push(
        toDegradedLaneResult(lane, new Error(`no lane runner registered for "${lane}"`))
      );
      continue;
    }
    try {
      const result = await runner(input, ctx);
      // Pin the lane id to the canonical slot so a misbehaving runner can never
      // silently drop or relabel a lane.
      results.push({ ...result, lane });
    } catch (error) {
      results.push(toDegradedLaneResult(lane, error));
    }
  }
  return results;
}

/**
 * Index the fan-out results by lane id into a `Record<AnalysisLaneId,
 * AnalysisLaneResult>` with all five canonical keys present. Throws if a
 * canonical lane is missing (defensive; `fanOut` always provides all five).
 */
export function indexLaneResults(
  results: AnalysisLaneResult[]
): Record<AnalysisLaneId, AnalysisLaneResult> {
  const byLane = new Map<AnalysisLaneId, AnalysisLaneResult>();
  for (const result of results) byLane.set(result.lane, result);
  const record = {} as Record<AnalysisLaneId, AnalysisLaneResult>;
  for (const lane of ANALYSIS_LANE_IDS) {
    const result = byLane.get(lane);
    if (result === undefined) {
      throw new Error(`indexLaneResults: missing canonical lane "${lane}"`);
    }
    record[lane] = result;
  }
  return record;
}
