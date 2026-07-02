/**
 * WIRED Technical Indicators lane (Decision Record DR-002 RESOLVED).
 *
 * Computes real EMA-20/50, RSI-14, ATR-14 (+ derived `trendBias` /
 * `emaDistancePct`) over committed fixture OHLCV using the CANONICAL AFI
 * indicator kernel: `computeTechnicalEnrichment`
 * (`src/enrichment/technicalIndicators.ts` -> `src/indicator/froggyProfile.ts`
 * -> `src/indicator/indicatorKernel.ts` -> `trading-signals` v7). The former
 * self-contained offline EMA/RSI/ATR helper has been swapped out through the
 * injectable engine seam DR-002 reserved for exactly this purpose — the lane
 * contract, payload field names/types, and >=50-candle semantics are
 * unchanged. Canonical streaming EMA and Wilder-smoothed RSI/ATR differ
 * numerically from the offline helper, so lane goldens and the committed
 * bundleHash were re-pinned (inputHash / outputHash / uwrScore unchanged).
 *
 * The engine seam remains injectable: `runTechnicalLane(candles, engine)`
 * accepts any {@link OfflineIndicatorEngine}-conforming engine (the offline
 * helper in `./technicalIndicators.js` is retained solely as a non-default,
 * injectable alternative for seam tests). Downstream scoring stays 100% in
 * afi-core.
 *
 * Pure & deterministic given the candle input: no `Math.random`, no
 * `Date.now`, no network, no filesystem. Timestamps come from `ctx.clock()`
 * and never affect the payload.
 *
 * ESM: relative imports use `.js`.
 */

import { computeTechnicalEnrichment } from "../../enrichment/technicalIndicators.js";
import type { AfiCandle } from "../../types/AfiCandle.js";
import type {
  AnalysisLaneId,
  AnalysisLaneResult,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "../types.js";
import type {
  OfflineIndicatorEngine,
  OfflineTechnicalIndicators,
} from "./technicalIndicators.js";

export const TECHNICAL_LANE_ID: AnalysisLaneId = "technical-indicators";
export const TECHNICAL_LANE_PIPEHEAD_ID = "technical-lane";

/**
 * Self-label attached to every technical lane result. States that the
 * indicators come from the canonical AFI indicator kernel (DR-002 resolved).
 */
export const TECHNICAL_INDICATOR_NOTE =
  "Canonical AFI indicator kernel (DR-002 resolved): computeTechnicalEnrichment " +
  "(src/enrichment/technicalIndicators.ts -> src/indicator/froggyProfile.ts -> " +
  "src/indicator/indicatorKernel.ts) powered by trading-signals v7 — streaming EMA " +
  "and Wilder-smoothed RSI-14/ATR-14. Downstream scoring remains 100% afi-core.";

export interface TechnicalLanePayload {
  ema20: number;
  ema50: number;
  rsi14: number;
  atr14: number;
  trendBias: "bullish" | "bearish" | "range";
  emaDistancePct: number;
  /** Marks the indicator source as the canonical kernel (trading-signals). */
  indicatorSource: "canonical-kernel-trading-signals";
  /** The canonical AFI indicator kernel is live (DR-002 resolved). */
  canonicalIndicatorKernel: true;
  /** Human-readable self-label (DR-002). */
  note: string;
}

/**
 * The CANONICAL indicator engine (DR-002 resolved), expressed in the existing
 * injectable engine-seam signature. Wraps `computeTechnicalEnrichment` and
 * projects exactly the six seam fields (`ema20`/`ema50`/`rsi14`/`atr14`/
 * `trendBias`/`emaDistancePct`); the kernel's extra fields (`volumeRatio`,
 * `isInValueSweetSpot`) are intentionally NOT surfaced so the lane payload —
 * and everything `normalizePipehead.projectTechnical` consumes — keeps its
 * exact shape. Returns `null` on insufficient data (<50 candles), mirroring
 * the seam contract.
 */
export const canonicalIndicatorEngine: OfflineIndicatorEngine = (
  candles: AfiCandle[]
): OfflineTechnicalIndicators | null => {
  const enriched = computeTechnicalEnrichment(candles);
  if (enriched === null) {
    return null;
  }
  return {
    ema20: enriched.ema20,
    ema50: enriched.ema50,
    rsi14: enriched.rsi14,
    atr14: enriched.atr14,
    trendBias: enriched.trendBias,
    emaDistancePct: enriched.emaDistancePct,
  };
};

/**
 * Pure technical-lane computation. Produces a well-formed
 * {@link AnalysisLaneResult} with `provisional: false`. The `engine` parameter
 * is the CLEAN SEAM through which DR-002 was resolved: the canonical kernel is
 * now the default, and tests can still inject an alternative engine without
 * changing this lane.
 */
export function runTechnicalLane(
  candles: AfiCandle[],
  engine: OfflineIndicatorEngine = canonicalIndicatorEngine
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
    indicatorSource: "canonical-kernel-trading-signals",
    canonicalIndicatorKernel: true,
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
