/**
 * WIRED Technical Indicators lane (Decision Record DR-002).
 *
 * Computes real EMA-20/50, RSI-14, ATR-14 (+ derived `trendBias` /
 * `emaDistancePct`) over committed fixture OHLCV using the self-contained
 * OFFLINE helper in `./technicalIndicators.js`. It is genuinely WIRED
 * (`provisional: false`, real deterministic math) but self-labels its
 * indicators as a self-contained / non-canonical OFFLINE computation that is
 * NOT the canonical AFI indicator kernel (see DR-002): the canonical chain
 * hard-imports `trading-signals`, which is unavailable offline, so this lane
 * deliberately does not import `computeTechnicalEnrichment` /
 * `src/enrichment/technicalIndicators.ts` / `src/indicator/*`. Downstream
 * scoring stays 100% in afi-core.
 *
 * Pure & deterministic given the candle input: no `Math.random`, no
 * `Date.now`, no network, no filesystem. Timestamps come from `ctx.clock()`
 * and never affect the payload.
 *
 * ESM: relative imports use `.js`.
 */

import type { AfiCandle } from "../../types/AfiCandle.js";
import type {
  AnalysisLaneId,
  AnalysisLaneResult,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "../types.js";
import {
  computeOfflineTechnicalIndicators,
  type OfflineIndicatorEngine,
} from "./technicalIndicators.js";

export const TECHNICAL_LANE_ID: AnalysisLaneId = "technical-indicators";
export const TECHNICAL_LANE_PIPEHEAD_ID = "technical-lane";

/**
 * Self-label attached to every technical lane result. Makes the
 * self-contained / non-canonical / offline nature explicit and points at the
 * deferred canonical-indicator-kernel work (DR-002).
 */
export const TECHNICAL_INDICATOR_NOTE =
  "Self-contained OFFLINE indicator computation (EMA/RSI/ATR), NOT the canonical " +
  "AFI indicator kernel. The canonical kernel (src/enrichment/technicalIndicators.ts " +
  "-> src/indicator/*) hard-imports `trading-signals`, which is unavailable offline; " +
  "restoring the canonical indicator kernel is deferred to future work (DR-002). " +
  "Downstream scoring remains 100% afi-core.";

export interface TechnicalLanePayload {
  ema20: number;
  ema50: number;
  rsi14: number;
  atr14: number;
  trendBias: "bullish" | "bearish" | "range";
  emaDistancePct: number;
  /** Marks the indicator source as the self-contained offline helper. */
  indicatorSource: "self-contained-offline";
  /** Explicitly NOT the canonical AFI indicator kernel. */
  canonicalIndicatorKernel: false;
  /** Human-readable self-label (DR-002). */
  note: string;
}

/**
 * Pure technical-lane computation. Produces a well-formed
 * {@link AnalysisLaneResult} with `provisional: false`. The `engine` parameter
 * is the CLEAN SEAM: a future mission can pass the canonical indicator kernel
 * instead of the offline helper without changing this lane.
 */
export function runTechnicalLane(
  candles: AfiCandle[],
  engine: OfflineIndicatorEngine = computeOfflineTechnicalIndicators
): AnalysisLaneResult<TechnicalLanePayload> {
  const indicators = engine(candles);
  if (indicators === null) {
    throw new Error(
      `technicalLane: insufficient OHLCV (need >=50 candles for EMA-50, got ${candles.length})`
    );
  }

  const payload: TechnicalLanePayload = {
    ema20: indicators.ema20,
    ema50: indicators.ema50,
    rsi14: indicators.rsi14,
    atr14: indicators.atr14,
    trendBias: indicators.trendBias,
    emaDistancePct: indicators.emaDistancePct,
    indicatorSource: "self-contained-offline",
    canonicalIndicatorKernel: false,
    note: TECHNICAL_INDICATOR_NOTE,
  };

  return {
    lane: TECHNICAL_LANE_ID,
    provisional: false,
    payload,
    notes: [TECHNICAL_INDICATOR_NOTE],
  };
}

/**
 * The technical lane as a typed pipehead. `execute(candles, ctx)` returns a
 * `PipeheadExecutionResult` wrapping the `AnalysisLaneResult`. Timestamps come
 * from `ctx.clock()` and are excluded from every hash.
 */
export const technicalLane: Pipehead<AfiCandle[], AnalysisLaneResult<TechnicalLanePayload>> = {
  id: TECHNICAL_LANE_PIPEHEAD_ID,
  kind: "analysis-lane",
  lane: TECHNICAL_LANE_ID,
  async execute(
    candles: AfiCandle[],
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<AnalysisLaneResult<TechnicalLanePayload>>> {
    const startedAt = ctx.clock();
    const result = runTechnicalLane(candles);
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: "ok",
      provisional: false,
      output: result,
      notes: [TECHNICAL_INDICATOR_NOTE],
      startedAt,
      finishedAt,
    };
  },
};
