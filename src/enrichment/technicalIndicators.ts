/**
 * Technical Indicators - Deterministic Computation
 *
 * Computes technical indicators from OHLCV candle data.
 * All functions are deterministic and fail-soft (return null on insufficient data).
 *
 * @module technicalIndicators
 */

import type { TechnicalLensV1 } from "../types/UssLenses.js";

/**
 * Neutral candle type for AFI enrichment.
 * Compatible with any exchange adapter's OHLCV format.
 */
export interface AfiCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Compute technical enrichment from OHLCV candles.
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
    // Calculate EMAs
    const ema20 = calculateEMA(candles, 20);
    const ema50 = calculateEMA(candles, 50);

    // Calculate RSI
    const rsi14 = calculateRSI(candles, 14);

    // Calculate ATR (optional, requires high/low data)
    const atr14 = calculateATR(candles, 14);

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

/**
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
 * Calculate Relative Strength Index (RSI)
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
 * Calculate Average True Range (ATR)
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

