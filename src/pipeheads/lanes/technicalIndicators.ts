/**
 * Self-contained OFFLINE technical-indicator helper (Decision Record DR-002).
 *
 * This is NOT the canonical AFI indicator kernel. The canonical chain
 * (`src/enrichment/technicalIndicators.ts` -> `src/indicator/froggyProfile.ts`
 * -> `src/indicator/indicatorKernel.ts`) hard-imports the `trading-signals`
 * package, which is not installed and is uninstallable offline (a RUNTIME-only
 * landmine invisible to scoped `tsc`, since `indicatorKernel.ts` is
 * `@ts-nocheck`). So this module re-implements EMA/RSI/ATR with deterministic,
 * dependency-free arithmetic that mirrors the repo's OWN deprecated pure
 * `calculateEMA` / `calculateRSI` / `calculateATR` formulas (read as a blueprint
 * only; that module is never imported).
 *
 * CLEAN SEAM: `computeOfflineTechnicalIndicators` conforms to the
 * {@link OfflineIndicatorEngine} signature so a future mission can swap in the
 * canonical indicator kernel once `trading-signals` is available, without
 * changing the technical lane.
 *
 * Pure & deterministic: output is a function of the candle input only. No
 * `Math.random`, no `Date.now`, no network, no filesystem.
 *
 * ESM: relative imports use `.js`.
 */

import type { AfiCandle } from "../../types/AfiCandle.js";

export interface OfflineTechnicalIndicators {
  /** Exponential Moving Average (20-period). */
  ema20: number;
  /** Exponential Moving Average (50-period). */
  ema50: number;
  /** Relative Strength Index (14-period), 0..100. */
  rsi14: number;
  /** Average True Range (14-period). */
  atr14: number;
  /** Trend bias derived from the EMA-20 / EMA-50 relationship. */
  trendBias: "bullish" | "bearish" | "range";
  /** Distance of the latest close from EMA-20, as a percentage. */
  emaDistancePct: number;
}

/**
 * The seam a future mission can re-implement with the canonical kernel.
 * Returns `null` on insufficient data (mirrors the canonical helper contract).
 */
export type OfflineIndicatorEngine = (
  candles: AfiCandle[]
) => OfflineTechnicalIndicators | null;

/**
 * Minimum candles required so EMA-50 is well-defined.
 */
export const MIN_CANDLES_FOR_INDICATORS = 50;

/**
 * Exponential Moving Average, seeded with the simple average of the first
 * `period` closes (mirrors the repo's deprecated pure `calculateEMA`).
 */
export function calculateEMA(candles: AfiCandle[], period: number): number {
  const multiplier = 2 / (period + 1);
  let ema =
    candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }
  return ema;
}

/**
 * Relative Strength Index using simple averaging over the final `period`
 * changes (mirrors the repo's deprecated pure `calculateRSI`). Returns 100 when
 * there are no losses in the window.
 */
export function calculateRSI(candles: AfiCandle[], period = 14): number {
  if (candles.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range as the simple mean of the final `period` true ranges
 * (mirrors the repo's deprecated pure `calculateATR`).
 */
export function calculateATR(candles: AfiCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trueRanges.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    );
  }

  return trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
}

/**
 * Compute the offline indicator bundle (EMA-20/50, RSI-14, ATR-14 + derived
 * `trendBias` / `emaDistancePct`). Returns `null` when fewer than
 * {@link MIN_CANDLES_FOR_INDICATORS} candles are supplied. Deterministic.
 */
export const computeOfflineTechnicalIndicators: OfflineIndicatorEngine = (
  candles: AfiCandle[]
): OfflineTechnicalIndicators | null => {
  if (candles.length < MIN_CANDLES_FOR_INDICATORS) {
    return null;
  }

  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);
  const rsi14 = calculateRSI(candles, 14);
  const atr14 = calculateATR(candles, 14);

  const currentPrice = candles[candles.length - 1].close;
  const emaDistancePct = ((currentPrice - ema20) / ema20) * 100;

  let trendBias: "bullish" | "bearish" | "range";
  if (ema20 > ema50 * 1.005) {
    trendBias = "bullish";
  } else if (ema20 < ema50 * 0.995) {
    trendBias = "bearish";
  } else {
    trendBias = "range";
  }

  return { ema20, ema50, rsi14, atr14, trendBias, emaDistancePct };
};
