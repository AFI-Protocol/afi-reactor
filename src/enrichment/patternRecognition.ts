/**
 * Pattern Recognition - Candlestick & Chart Patterns
 *
 * Detects candlestick patterns and structural analysis from OHLCV data.
 * All functions are deterministic and fail-soft (return null on insufficient data).
 *
 * @module patternRecognition
 */

import type { PatternLensV1 } from "../types/UssLenses.js";
import type { AfiCandle } from "../types/AfiCandle.js";

/**
 * Detect patterns from OHLCV candles.
 *
 * Requires at least 20 candles for pattern detection.
 * Returns null if insufficient data.
 *
 * @param candles - Array of OHLCV candles (oldest first)
 * @returns PatternLensV1 payload or null
 */
export function detectPatterns(
  candles: AfiCandle[]
): PatternLensV1["payload"] | null {
  // Require at least 20 candles for pattern detection
  if (candles.length < 20) {
    console.debug(
      `⚠️  Pattern detection: Need at least 20 candles, got ${candles.length}. Skipping.`
    );
    return null;
  }

  try {
    // Get last 3 candles for pattern detection
    const c1 = candles[candles.length - 3]; // 2 candles ago
    const c2 = candles[candles.length - 2]; // 1 candle ago
    const c3 = candles[candles.length - 1]; // Current candle

    // Detect bullish engulfing
    const bullishEngulfing = detectBullishEngulfing(c2, c3);

    // Detect bearish engulfing
    const bearishEngulfing = detectBearishEngulfing(c2, c3);

    // Detect pin bar (hammer or shooting star)
    const pinBar = detectPinBar(c3);

    // Detect inside bar
    const insideBar = detectInsideBar(c2, c3);

    // Analyze structure bias (higher-highs, lower-lows, choppy)
    const structureBias = analyzeStructureBias(candles.slice(-20));

    // Detect trend pullback confirmation (Froggy-specific)
    const trendPullbackConfirmed = detectTrendPullback(candles.slice(-20));

    // Determine dominant pattern (if any)
    let patternName: string | undefined;
    let patternConfidence: number | undefined;

    if (bullishEngulfing) {
      patternName = "bullish engulfing";
      patternConfidence = 75;
    } else if (bearishEngulfing) {
      patternName = "bearish engulfing";
      patternConfidence = 75;
    } else if (pinBar) {
      patternName = "pin bar";
      patternConfidence = 65;
    } else if (insideBar) {
      patternName = "inside bar";
      patternConfidence = 60;
    }

    return {
      bullishEngulfing,
      bearishEngulfing,
      pinBar,
      insideBar,
      structureBias,
      trendPullbackConfirmed,
      patternName,
      patternConfidence,
    };
  } catch (error) {
    console.error("❌ Pattern detection failed:", error);
    return null;
  }
}

/**
 * Detect bullish engulfing pattern.
 *
 * Bullish engulfing: Current candle is bullish and completely engulfs previous bearish candle.
 */
function detectBullishEngulfing(prev: AfiCandle, curr: AfiCandle): boolean {
  const prevBearish = prev.close < prev.open;
  const currBullish = curr.close > curr.open;
  const engulfs = curr.open <= prev.close && curr.close >= prev.open;

  return prevBearish && currBullish && engulfs;
}

/**
 * Detect bearish engulfing pattern.
 *
 * Bearish engulfing: Current candle is bearish and completely engulfs previous bullish candle.
 */
function detectBearishEngulfing(prev: AfiCandle, curr: AfiCandle): boolean {
  const prevBullish = prev.close > prev.open;
  const currBearish = curr.close < curr.open;
  const engulfs = curr.open >= prev.close && curr.close <= prev.open;

  return prevBullish && currBearish && engulfs;
}

/**
 * Detect pin bar (hammer or shooting star).
 *
 * Pin bar: Long wick (at least 2x body size) with small body.
 */
function detectPinBar(candle: AfiCandle): boolean {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  const longUpperWick = upperWick > body * 2;
  const longLowerWick = lowerWick > body * 2;

  return longUpperWick || longLowerWick;
}

/**
 * Detect inside bar.
 *
 * Inside bar: Current candle's high/low is completely within previous candle's range.
 */
function detectInsideBar(prev: AfiCandle, curr: AfiCandle): boolean {
  return curr.high <= prev.high && curr.low >= prev.low;
}

/**
 * Analyze structure bias (higher-highs, lower-lows, choppy).
 *
 * Looks at swing highs and lows over the last 20 candles.
 */
function analyzeStructureBias(
  candles: AfiCandle[]
): "higher-highs" | "lower-lows" | "choppy" {
  if (candles.length < 10) return "choppy";

  // Find swing highs and lows
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const firstHalf = candles.slice(0, Math.floor(candles.length / 2));
  const secondHalf = candles.slice(Math.floor(candles.length / 2));

  const firstHalfHigh = Math.max(...firstHalf.map((c) => c.high));
  const secondHalfHigh = Math.max(...secondHalf.map((c) => c.high));

  const firstHalfLow = Math.min(...firstHalf.map((c) => c.low));
  const secondHalfLow = Math.min(...secondHalf.map((c) => c.low));

  const higherHighs = secondHalfHigh > firstHalfHigh;
  const higherLows = secondHalfLow > firstHalfLow;
  const lowerHighs = secondHalfHigh < firstHalfHigh;
  const lowerLows = secondHalfLow < firstHalfLow;

  if (higherHighs && higherLows) return "higher-highs";
  if (lowerHighs && lowerLows) return "lower-lows";
  return "choppy";
}

/**
 * Detect trend pullback confirmation (Froggy-specific).
 *
 * Trend pullback: Price pulled back to support/resistance and is now resuming trend.
 */
function detectTrendPullback(candles: AfiCandle[]): boolean {
  if (candles.length < 10) return false;

  // Simple heuristic: Check if recent candles show a pullback followed by resumption
  const recentCandles = candles.slice(-5);
  const priorCandles = candles.slice(-10, -5);

  const recentAvg =
    recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const priorAvg =
    priorCandles.reduce((sum, c) => sum + c.close, 0) / priorCandles.length;

  // Pullback confirmed if recent average is higher than prior (uptrend resumption)
  // or lower than prior (downtrend resumption)
  const pullbackConfirmed = Math.abs(recentAvg - priorAvg) / priorAvg > 0.01; // 1% threshold

  return pullbackConfirmed;
}

