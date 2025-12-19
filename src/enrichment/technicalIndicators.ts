/**
 * Technical Indicators - Deterministic Computation
 *
 * Computes technical indicators from OHLCV candle data using the AFI Indicator Kernel.
 * All functions are deterministic and fail-soft (return null on insufficient data).
 *
 * The Indicator Kernel wraps the `trading-signals` library for battle-tested implementations:
 * - EMA: Exponential Moving Average
 * - RSI: Relative Strength Index (Wilder's smoothed - more accurate than simple averaging)
 * - ATR: Average True Range (Wilder's smoothed - more accurate than SMA)
 *
 * @module technicalIndicators
 */

import type { TechnicalLensV1 } from "../types/UssLenses.js";
import type { AfiCandle } from "../types/AfiCandle.js";
import { computeFroggyBundle } from "../indicator/froggyProfile.js";

/**
 * Compute technical enrichment from OHLCV candles.
 *
 * Uses Froggy's indicator profile (powered by AFI Indicator Kernel + `trading-signals`):
 * - EMA-20, EMA-50: Exponential Moving Averages
 * - RSI-14: Relative Strength Index (Wilder's smoothed method)
 * - ATR-14: Average True Range (Wilder's smoothed method)
 *
 * Requires at least 50 candles for EMA-50 calculation.
 * Returns null if insufficient data.
 *
 * @param candles - Array of OHLCV candles (oldest first)
 * @returns TechnicalLensV1 payload or null
 */
export function computeTechnicalEnrichment(
  candles: AfiCandle[]
): TechnicalLensV1["payload"] | null {
  // Require at least 50 candles for EMA-50
  if (candles.length < 50) {
    console.debug(
      `⚠️  Technical enrichment: Need at least 50 candles, got ${candles.length}. Skipping.`
    );
    return null;
  }

  try {
    // Compute indicators using Froggy's indicator profile
    const bundle = computeFroggyBundle(candles);

    if (!bundle) {
      console.debug(
        "⚠️  Technical enrichment: Froggy indicator bundle computation failed. Skipping."
      );
      return null;
    }

    // Extract indicator values from Froggy bundle
    const { ema20, ema50, rsi14, atr14 } = bundle;

    // Get latest candle
    const latestCandle = candles[candles.length - 1];
    const currentPrice = latestCandle.close;

    // Calculate EMA distance percentage
    const emaDistancePct = ((currentPrice - ema20) / ema20) * 100;

    // Check if in "sweet spot" (within 1% of EMA-20)
    const isInValueSweetSpot = Math.abs(emaDistancePct) <= 1;

    // Determine trend bias based on EMA relationship
    let trendBias: "bullish" | "bearish" | "range";
    if (ema20 > ema50 * 1.005) {
      // EMA-20 > EMA-50 by at least 0.5%
      trendBias = "bullish";
    } else if (ema20 < ema50 * 0.995) {
      // EMA-20 < EMA-50 by at least 0.5%
      trendBias = "bearish";
    } else {
      trendBias = "range";
    }

    // Calculate volume ratio (current vs 20-period average)
    const avgVolume =
      candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const volumeRatio = latestCandle.volume / avgVolume;

    return {
      ema20,
      ema50,
      rsi14,
      atr14,
      trendBias,
      volumeRatio,
      emaDistancePct,
      isInValueSweetSpot,
    };
  } catch (error) {
    console.error("❌ Technical enrichment failed:", error);
    return null;
  }
}

// ============================================================================
// DEPRECATED: Hand-rolled indicator functions (kept for validation only)
// ============================================================================
//
// These functions are no longer used in production code.
// They are kept for validation/testing purposes to compare against
// the Indicator Kernel's `trading-signals` library implementations.
//
// TODO: Move these to a separate validation test file.
// ============================================================================

/**
 * @deprecated Use `computeIndicatorBundle()` from Indicator Kernel instead.
 * Calculate Exponential Moving Average (EMA)
 *
 * @param candles - Array of candles
 * @param period - EMA period (e.g., 20, 50)
 * @returns EMA value
 */
export function calculateEMA(candles: AfiCandle[], period: number): number {
  const multiplier = 2 / (period + 1);

  // Start with SMA for first period
  let ema =
    candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;

  // Apply EMA formula for remaining candles
  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * @deprecated Use `computeIndicatorBundle()` from Indicator Kernel instead.
 * Calculate Relative Strength Index (RSI)
 *
 * NOTE: This is a simplified implementation using simple averaging.
 * The Indicator Kernel uses Wilder's smoothed method, which is more accurate.
 *
 * @param candles - Array of candles
 * @param period - RSI period (typically 14)
 * @returns RSI value (0-100)
 */
export function calculateRSI(
  candles: AfiCandle[],
  period: number = 14
): number {
  if (candles.length < period + 1) return 50; // Default neutral

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

/**
 * @deprecated Use `computeIndicatorBundle()` from Indicator Kernel instead.
 * Calculate Average True Range (ATR)
 *
 * NOTE: This is a simplified implementation using simple moving average.
 * The Indicator Kernel uses Wilder's smoothed method, which is more accurate.
 *
 * Measures volatility using high/low/close data.
 *
 * @param candles - Array of candles
 * @param period - ATR period (typically 14)
 * @returns ATR value
 */
export function calculateATR(
  candles: AfiCandle[],
  period: number = 14
): number {
  if (candles.length < period + 1) return 0;

  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trueRanges.push(tr);
  }

  // Calculate ATR as simple moving average of true ranges
  const atr =
    trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;

  return atr;
}

