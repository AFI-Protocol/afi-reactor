/**
 * PROVISIONAL News lane.
 *
 * Returns a committed, clearly-labeled fixture payload. There is NO network,
 * NO external news adapter, and NO Tiny Brains: the payload is a hard-coded,
 * deterministic fixture (mirrored by the committed
 * `test/pipeheads/fixtures/lanes/news.json`). The result is `provisional: true`
 * and the payload itself carries an in-payload provisional flag + human-readable
 * note, so it is self-identifying as provisional independent of the bundle-level
 * `provisionalLanes` list (VAL-LANES-005, VAL-LANES-012).
 *
 * The payload is shaped to map onto afi-core `FroggyEnrichedView.news`
 * (`hasShockEvent`, `shockDirection`, `headlines`, `items`) so a future
 * normalization step can project it directly.
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

export const NEWS_LANE_ID: AnalysisLaneId = "news";
export const NEWS_LANE_PIPEHEAD_ID = "news-lane";

/** Human-readable self-label attached to every news lane result. */
export const NEWS_LANE_NOTE =
  "PROVISIONAL committed news fixture: non-canonical, demo-only, NO network and " +
  "NO external news adapter. Self-identifying as provisional; restoring a wired " +
  "news lane is deferred to future work.";

export interface NewsLaneItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

export interface NewsLanePayload {
  /** In-payload provisional flag (self-labeled, independent of the bundle). */
  provisional: true;
  fixtureSource: "committed-fixture";
  /** Human-readable provisional note. */
  note: string;
  hasShockEvent: boolean;
  shockDirection: "bullish" | "bearish" | "mixed" | "none" | "unknown";
  headlines: string[];
  items: NewsLaneItem[];
}

/**
 * Committed news fixture (mirrors test/pipeheads/fixtures/lanes/news.json).
 */
export const DEFAULT_NEWS_FIXTURE: NewsLanePayload = {
  provisional: true,
  fixtureSource: "committed-fixture",
  note:
    "PROVISIONAL committed news fixture for BTC/USDT perp 4h. Non-canonical, " +
    "demo-only, NO network and NO external news adapter; restoring a wired news " +
    "lane is deferred to future work.",
  hasShockEvent: false,
  shockDirection: "none",
  headlines: [
    "BTC holds above the 4h trend EMA as the pullback resolves higher",
    "Spot inflows remain steady with no major macro catalysts in the window",
  ],
  items: [
    {
      title: "BTC holds above the 4h trend EMA as the pullback resolves higher",
      source: "fixture-wire",
      url: "https://example.invalid/news/btc-trend-ema",
      publishedAt: "2024-12-31T12:00:00.000Z",
    },
    {
      title:
        "Spot inflows remain steady with no major macro catalysts in the window",
      source: "fixture-wire",
      url: "https://example.invalid/news/spot-inflows-steady",
      publishedAt: "2024-12-31T10:30:00.000Z",
    },
  ],
};

/**
 * Pure news-lane computation. Returns a well-formed {@link AnalysisLaneResult}
 * with `provisional: true`. The `fixture` parameter is the CLEAN SEAM: a future
 * mission can pass a wired payload instead of the committed fixture without
 * changing this lane. A fresh deep copy is returned so callers cannot mutate
 * the shared default.
 */
export function runNewsLane(
  fixture: NewsLanePayload = DEFAULT_NEWS_FIXTURE
): AnalysisLaneResult<NewsLanePayload> {
  return {
    lane: NEWS_LANE_ID,
    provisional: true,
    payload: structuredClone(fixture),
    notes: [NEWS_LANE_NOTE],
  };
}

/**
 * The news lane as a typed pipehead. `execute(_, ctx)` returns a
 * `PipeheadExecutionResult` wrapping the `AnalysisLaneResult`. Timestamps come
 * from `ctx.clock()` and are excluded from every hash.
 */
export const newsLane: Pipehead<void, AnalysisLaneResult<NewsLanePayload>> = {
  id: NEWS_LANE_PIPEHEAD_ID,
  kind: "analysis-lane",
  lane: NEWS_LANE_ID,
  async execute(
    _input: void,
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<AnalysisLaneResult<NewsLanePayload>>> {
    const startedAt = ctx.clock();
    const result = runNewsLane();
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: "ok",
      provisional: true,
      output: result,
      notes: [NEWS_LANE_NOTE],
      startedAt,
      finishedAt,
    };
  },
};
