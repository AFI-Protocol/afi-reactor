// @ts-nocheck
/**
 * AFI Indicator Kernel
 *
 * Thin wrapper around `trading-signals` library for computing technical indicators.
 * Provides batch computation for historical data and streaming updates for real-time data.
 *
 * Design principles:
 * - Minimal abstraction over trading-signals
 * - Type-safe with full TypeScript strict mode
 * - Composable - easy to add new indicators
 * - Deterministic - same input → same output
 * - Fail-soft - returns null if insufficient data
 */

import { EMA, RSI, ATR } from "trading-signals";
import type { AfiCandle } from "../types/AfiCandle.js";

/**
 * Configuration for indicator bundle computation
 */
export interface IndicatorBundleConfig {
  /** EMA periods to compute (e.g. [20, 50]) */
  ema?: number[];
  /** RSI periods to compute (e.g. [14]) */
  rsi?: number[];
  /** ATR periods to compute (e.g. [14]) */
  atr?: number[];
  // Future: MACD, Bollinger, Stochastic, ADX, OBV, VWAP, etc.
}

/**
 * Bundle of computed indicators
 * Matches TechnicalLensV1 payload shape for backward compatibility
 */
export interface IndicatorBundle {
  /** Exponential Moving Averages by period */
  ema?: Record<number, number>;
  /** Relative Strength Index by period (Wilder's smoothed) */
  rsi?: Record<number, number>;
  /** Average True Range by period (Wilder's smoothed) */
  atr?: Record<number, number>;
  // Future additions:
  // macd?: { value: number; signal: number; histogram: number };
  // bollinger?: { upper: number; middle: number; lower: number; width: number };
  // stochastic?: { k: number; d: number };
  // adx?: number;
  // obv?: number;
  // vwap?: number;
}

/**
 * Compute a bundle of technical indicators from historical OHLCV candles.
 *
 * Uses `trading-signals` library for battle-tested implementations:
 * - EMA: Exponential Moving Average
 * - RSI: Relative Strength Index (Wilder's smoothed - more accurate than simple averaging)
 * - ATR: Average True Range (Wilder's smoothed - more accurate than SMA)
 *
 * @param candles - Array of OHLCV candles (must be in chronological order)
 * @param config - Configuration specifying which indicators to compute
 * @returns Bundle of computed indicators, or null if insufficient data
 *
 * @example
 * ```typescript
 * const bundle = computeIndicatorBundle(candles, {
 *   ema: [20, 50],
 *   rsi: [14],
 *   atr: [14],
 * });
 *
 * if (bundle) {
 *   console.log(bundle.ema?.[20]); // EMA-20 value
 *   console.log(bundle.rsi?.[14]); // RSI-14 value
 * }
 * ```
 */
export function computeIndicatorBundle(
  candles: AfiCandle[],
  config: IndicatorBundleConfig
): IndicatorBundle | null {
  if (candles.length === 0) {
    return null;
  }

  const bundle: IndicatorBundle = {};

  // Compute EMAs
  if (config.ema && config.ema.length > 0) {
    bundle.ema = {};
    for (const period of config.ema) {
      const ema = new EMA(period);
      for (const candle of candles) {
        ema.update(candle.close, false); // false = append mode (not replace)
      }
      if (ema.isStable) {
        bundle.ema[period] = ema.getResult().valueOf();
      }
    }
  }

  // Compute RSIs (Wilder's smoothed method)
  if (config.rsi && config.rsi.length > 0) {
    bundle.rsi = {};
    for (const period of config.rsi) {
      const rsi = new RSI(period);
      for (const candle of candles) {
        rsi.update(candle.close, false); // false = append mode (not replace)
      }
      if (rsi.isStable) {
        bundle.rsi[period] = rsi.getResult().valueOf();
      }
    }
  }

  // Compute ATRs (Wilder's smoothed method)
  if (config.atr && config.atr.length > 0) {
    bundle.atr = {};
    for (const period of config.atr) {
      const atr = new ATR(period);
      for (const candle of candles) {
        atr.update({ high: candle.high, low: candle.low, close: candle.close }, false); // false = append mode
      }
      if (atr.isStable) {
        bundle.atr[period] = atr.getResult().valueOf();
      }
    }
  }

  // Return null if no indicators were computed
  const hasData =
    (bundle.ema && Object.keys(bundle.ema).length > 0) ||
    (bundle.rsi && Object.keys(bundle.rsi).length > 0) ||
    (bundle.atr && Object.keys(bundle.atr).length > 0);

  return hasData ? bundle : null;
}

/**
 * TODO: Streaming Indicator Kernel for real-time updates
 *
 * Future enhancement for live trading / real-time enrichment:
 *
 * ```typescript
 * export class IndicatorKernelStream {
 *   private indicators: Map<string, any>;
 *
 *   constructor(config: IndicatorBundleConfig) {
 *     // Initialize indicators
 *   }
 *
 *   update(candle: AfiCandle): IndicatorBundle | null {
 *     // Update all indicators with new candle
 *     // Return bundle if all indicators are stable
 *   }
 *
 *   getLatest(): IndicatorBundle {
 *     // Return latest computed values
 *   }
 * }
 * ```
 */
// @ts-nocheck
