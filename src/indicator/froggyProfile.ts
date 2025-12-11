/**
 * Froggy Indicator Profile
 *
 * Strategy-specific indicator configuration for Froggy's trend-pullback pipeline.
 * This profile defines which indicators Froggy needs and provides a typed wrapper
 * over the generic Indicator Kernel.
 *
 * This is NOT a universal definition of "technical indicators" - it's tailored
 * specifically for Froggy's trend-pullback strategy (froggy_trend_pullback_v1).
 *
 * Future Froggy strategies may define different profiles with different indicators.
 *
 * @module froggyProfile
 */

import type { AfiCandle } from "../types/AfiCandle.js";
import {
  type IndicatorBundle,
  type IndicatorBundleConfig,
  computeIndicatorBundle,
} from "./indicatorKernel.js";

/**
 * Froggy's indicator configuration for trend-pullback strategy.
 *
 * Current indicators:
 * - EMA-20, EMA-50: Trend identification and pullback detection
 * - RSI-14: Momentum and overbought/oversold conditions
 * - ATR-14: Volatility measurement for position sizing
 *
 * Future indicators (Phase 2+):
 * - MACD (12, 26, 9): Trend + momentum confirmation
 * - Bollinger Bands (20, 2): Volatility bands for entry/exit
 * - ADX (14): Trend strength filter
 * - Stochastic (14, 3, 3): Additional momentum confirmation
 *
 * NOTE: Adding new indicators here does NOT require changes to the Indicator Kernel.
 * The kernel is generic; this profile is strategy-specific.
 */
export const FROGGY_INDICATOR_CONFIG: IndicatorBundleConfig = {
  ema: [20, 50],
  rsi: [14],
  atr: [14],
  // NOTE: Future Froggy indicators (MACD, Bollinger, ADX, etc.)
  // can be added here later without touching the kernel itself.
};

/**
 * Froggy-specific indicator bundle.
 *
 * This is a typed subset of the generic IndicatorBundle,
 * containing only the indicators Froggy's strategy needs.
 */
export interface FroggyIndicatorBundle {
  /** Exponential Moving Average (20-period) - fast trend line */
  ema20: number;
  /** Exponential Moving Average (50-period) - slow trend line */
  ema50: number;
  /** Relative Strength Index (14-period) - momentum oscillator */
  rsi14: number;
  /** Average True Range (14-period) - volatility measure */
  atr14: number;
}

/**
 * Compute Froggy's indicator bundle from OHLCV candles.
 *
 * This is a convenience wrapper over the generic Indicator Kernel
 * that returns a strongly-typed bundle specific to Froggy's needs.
 *
 * Requires at least 50 candles for EMA-50 calculation.
 * Returns null if insufficient data or if any required indicator is missing.
 *
 * @param candles - Array of OHLCV candles (oldest first)
 * @returns FroggyIndicatorBundle or null
 */
export function computeFroggyBundle(
  candles: AfiCandle[]
): FroggyIndicatorBundle | null {
  // Delegate to generic Indicator Kernel
  const bundle = computeIndicatorBundle(candles, FROGGY_INDICATOR_CONFIG);

  if (!bundle) {
    return null;
  }

  // Extract Froggy-specific indicators
  const ema20 = bundle.ema?.[20];
  const ema50 = bundle.ema?.[50];
  const rsi14 = bundle.rsi?.[14];
  const atr14 = bundle.atr?.[14];

  // Validate all required indicators are present
  if (
    ema20 == null ||
    ema50 == null ||
    rsi14 == null ||
    atr14 == null
  ) {
    return null;
  }

  return { ema20, ema50, rsi14, atr14 };
}

