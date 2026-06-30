/**
 * PROVISIONAL AI/ML lane.
 *
 * Returns a committed, clearly-labeled fixture payload. There is explicitly NO
 * Tiny Brains, NO model inference and NO network: the payload is a hard-coded,
 * deterministic fixture (mirrored by the committed
 * `test/pipeheads/fixtures/lanes/aiml.json`). The result is `provisional: true`
 * and the payload itself carries an in-payload provisional flag + human-readable
 * note, so it is self-identifying as provisional independent of the bundle-level
 * `provisionalLanes` list (VAL-LANES-007, VAL-LANES-012).
 *
 * The payload is shaped to map onto afi-core `FroggyEnrichedView.aiMl`
 * (`FroggyAiMlV1`: `convictionScore`, `direction`, `regime`, `riskFlag`,
 * `notes`) so a future normalization step can project it directly.
 *
 * Pure & deterministic: no `Math.random`, no `Date.now`, no network, no
 * filesystem. Timestamps come from `ctx.clock()` and never affect the payload.
 *
 * ESM: relative imports use `.js`.
 */

import type {
  AnalysisLaneId,
  AnalysisLaneResult,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "../types.js";

export const AIML_LANE_ID: AnalysisLaneId = "ai-ml";
export const AIML_LANE_PIPEHEAD_ID = "ai-ml-lane";

/** Human-readable self-label attached to every ai-ml lane result. */
export const AIML_LANE_NOTE =
  "PROVISIONAL committed AI/ML fixture: non-canonical, demo-only. NO Tiny Brains, " +
  "NO model inference and NO network. Self-identifying as provisional; restoring " +
  "a wired AI/ML lane is deferred to future work.";

export interface AimlLanePayload {
  /** In-payload provisional flag (self-labeled, independent of the bundle). */
  provisional: true;
  fixtureSource: "committed-fixture";
  /** Human-readable provisional note. */
  note: string;
  /** Maps to enriched.aiMl.convictionScore (0..1). */
  convictionScore: number;
  /** Maps to enriched.aiMl.direction. */
  direction: "long" | "short" | "neutral";
  /** Maps to enriched.aiMl.regime. */
  regime: string;
  /** Maps to enriched.aiMl.riskFlag. */
  riskFlag: boolean;
  /** Maps to enriched.aiMl.notes. */
  notes: string;
}

/**
 * Committed AI/ML fixture (mirrors test/pipeheads/fixtures/lanes/aiml.json).
 */
export const DEFAULT_AIML_FIXTURE: AimlLanePayload = {
  provisional: true,
  fixtureSource: "committed-fixture",
  note:
    "PROVISIONAL committed AI/ML fixture for BTC/USDT perp 4h. Non-canonical, " +
    "demo-only: NO Tiny Brains, NO model inference and NO network. Shaped to map " +
    "onto afi-core enriched.aiMl (FroggyAiMlV1); restoring a wired AI/ML lane is " +
    "deferred to future work.",
  convictionScore: 0.6,
  direction: "long",
  regime: "bull",
  riskFlag: false,
  notes: "Committed fixture value; not produced by a live model.",
};

/**
 * Pure ai-ml-lane computation. Returns a well-formed {@link AnalysisLaneResult}
 * with `provisional: true`. The `fixture` parameter is the CLEAN SEAM for a
 * future wired implementation. A fresh deep copy is returned so callers cannot
 * mutate the shared default.
 */
export function runAimlLane(
  fixture: AimlLanePayload = DEFAULT_AIML_FIXTURE
): AnalysisLaneResult<AimlLanePayload> {
  return {
    lane: AIML_LANE_ID,
    provisional: true,
    payload: structuredClone(fixture),
    notes: [AIML_LANE_NOTE],
  };
}

/**
 * The ai-ml lane as a typed pipehead. Timestamps come from `ctx.clock()` and
 * are excluded from every hash.
 */
export const aimlLane: Pipehead<void, AnalysisLaneResult<AimlLanePayload>> = {
  id: AIML_LANE_PIPEHEAD_ID,
  kind: "analysis-lane",
  lane: AIML_LANE_ID,
  async execute(
    _input: void,
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<AnalysisLaneResult<AimlLanePayload>>> {
    const startedAt = ctx.clock();
    const result = runAimlLane();
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: "ok",
      provisional: true,
      output: result,
      notes: [AIML_LANE_NOTE],
      startedAt,
      finishedAt,
    };
  },
};
