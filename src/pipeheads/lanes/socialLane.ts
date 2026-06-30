/**
 * PROVISIONAL Social lane.
 *
 * Returns a committed, clearly-labeled fixture payload. There is NO network,
 * NO external social adapter, and NO Tiny Brains: the payload is a hard-coded,
 * deterministic fixture (mirrored by the committed
 * `test/pipeheads/fixtures/lanes/social.json`). The result is `provisional: true`
 * and the payload itself carries an in-payload provisional flag + human-readable
 * note, so it is self-identifying as provisional independent of the bundle-level
 * `provisionalLanes` list (VAL-LANES-006, VAL-LANES-012).
 *
 * The payload is shaped to map onto afi-core `FroggyEnrichedView.sentiment`
 * (`{ score, tags }`) so a future normalization step can project it directly
 * onto `enrichedView.sentiment` (VAL-BUNDLE-004).
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

export const SOCIAL_LANE_ID: AnalysisLaneId = "social";
export const SOCIAL_LANE_PIPEHEAD_ID = "social-lane";

/** Human-readable self-label attached to every social lane result. */
export const SOCIAL_LANE_NOTE =
  "PROVISIONAL committed social/sentiment fixture: non-canonical, demo-only, NO " +
  "network and NO external social adapter. Shaped to map onto afi-core " +
  "enriched.sentiment ({score, tags}); self-identifying as provisional. Restoring " +
  "a wired social lane is deferred to future work.";

export interface SocialLanePayload {
  /** In-payload provisional flag (self-labeled, independent of the bundle). */
  provisional: true;
  fixtureSource: "committed-fixture";
  /** Human-readable provisional note. */
  note: string;
  /** Maps to enriched.sentiment.score. */
  score: number;
  /** Maps to enriched.sentiment.tags. */
  tags: string[];
}

/**
 * Committed social fixture (mirrors test/pipeheads/fixtures/lanes/social.json).
 */
export const DEFAULT_SOCIAL_FIXTURE: SocialLanePayload = {
  provisional: true,
  fixtureSource: "committed-fixture",
  note:
    "PROVISIONAL committed social/sentiment fixture for BTC/USDT perp 4h. " +
    "Non-canonical, demo-only, NO network and NO external social adapter. Shaped " +
    "to map onto afi-core enriched.sentiment ({score, tags}); restoring a wired " +
    "social lane is deferred to future work.",
  score: 0.42,
  tags: ["bullish-bias", "accumulation", "fixture"],
};

/**
 * Pure social-lane computation. Returns a well-formed {@link AnalysisLaneResult}
 * with `provisional: true`. The `fixture` parameter is the CLEAN SEAM for a
 * future wired implementation. A fresh deep copy is returned so callers cannot
 * mutate the shared default.
 */
export function runSocialLane(
  fixture: SocialLanePayload = DEFAULT_SOCIAL_FIXTURE
): AnalysisLaneResult<SocialLanePayload> {
  return {
    lane: SOCIAL_LANE_ID,
    provisional: true,
    payload: structuredClone(fixture),
    notes: [SOCIAL_LANE_NOTE],
  };
}

/**
 * The social lane as a typed pipehead. Timestamps come from `ctx.clock()` and
 * are excluded from every hash.
 */
export const socialLane: Pipehead<void, AnalysisLaneResult<SocialLanePayload>> = {
  id: SOCIAL_LANE_PIPEHEAD_ID,
  kind: "analysis-lane",
  lane: SOCIAL_LANE_ID,
  async execute(
    _input: void,
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<AnalysisLaneResult<SocialLanePayload>>> {
    const startedAt = ctx.clock();
    const result = runSocialLane();
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: "ok",
      provisional: true,
      output: result,
      notes: [SOCIAL_LANE_NOTE],
      startedAt,
      finishedAt,
    };
  },
};
