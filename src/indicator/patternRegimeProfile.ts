/**
 * Pattern Regime Profile
 *
 * Computes regime-level market context for pattern interpretation.
 * Uses CoinGecko OHLC data and Fear & Greed Index to classify:
 * - Cycle phase (early/mid/late bull, bear, sideways, etc.)
 * - Trend state and volatility regime
 * - Top/bottom risk assessment
 *
 * This is BTC-centric for now (global market context).
 */

import type { PatternRegimeSummary } from "../types/UssLenses.js";
import {
  fetchCoinGeckoOhlc,
  mapSymbolToCoinGeckoId,
  type CoinGeckoOhlcCandle,
} from "../adapters/coingecko/coingeckoClient.js";
import {
  fetchFearGreedHistory,
  mapFearGreedLabel,
  type FearGreedPoint,
} from "../adapters/external/fearGreedClient.js";

// Volatility thresholds (annualized daily volatility)
const VOL_LOW_THRESHOLD = 0.3; // 30% annualized
const VOL_NORMAL_THRESHOLD = 0.6; // 60% annualized
const VOL_HIGH_THRESHOLD = 1.0; // 100% annualized

// Price position thresholds (relative to 90d range)
const NEAR_HIGH_THRESHOLD = 0.85; // Within 15% of 90d high
const NEAR_LOW_THRESHOLD = 0.15; // Within 15% of 90d low

/**
 * Compute Simple Moving Average
 */
function sma(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Compute Exponential Moving Average
 */
function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      result.push(values[i]);
    } else if (i < period - 1) {
      // Use SMA for initial values
      const sum = values.slice(0, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / (i + 1));
    } else {
      const emaValue = (values[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(emaValue);
    }
  }
  return result;
}

/**
 * Compute daily returns (percentage change)
 */
function dailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns;
}

/**
 * Compute standard deviation
 */
function stdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length;
  return Math.sqrt(variance);
}

/**
 * Compute Pattern Regime Summary
 *
 * @param symbol - Trading symbol (e.g. "BTCUSDT")
 * @param timeframe - Timeframe (not used for daily regime, but kept for API consistency)
 * @returns Pattern regime summary or null if data unavailable
 */
export async function computePatternRegimeSummary(
  symbol: string,
  timeframe: string
): Promise<PatternRegimeSummary | null> {
  try {
    // Map symbol to CoinGecko coin ID
    const coinId = mapSymbolToCoinGeckoId(symbol);

    console.log(
      `🔍 Pattern Regime: Computing for ${symbol} (${coinId}) on ${timeframe}...`
    );

    // Fetch data in parallel
    const [ohlcData, fearGreedData] = await Promise.all([
      fetchCoinGeckoOhlc(coinId, "usd", 90).catch((err) => {
        console.warn(`⚠️  Pattern Regime: CoinGecko failed:`, err.message);
        return [];
      }),
      fetchFearGreedHistory(90).catch((err) => {
        console.warn(`⚠️  Pattern Regime: Fear & Greed failed:`, err.message);
        return [];
      }),
    ]);

    // Require at least OHLC data to proceed
    if (ohlcData.length < 20) {
      console.warn(
        `⚠️  Pattern Regime: Insufficient OHLC data (${ohlcData.length} candles). Need at least 20.`
      );
      return null;
    }

    // Continue in next part...
    return await computeRegimeFromData(ohlcData, fearGreedData, symbol);
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `❌ Pattern Regime: Failed to compute for ${symbol}:`,
        error.message
      );
    }
    return null;
  }
}

/**
 * Compute regime from OHLC and Fear & Greed data
 */
async function computeRegimeFromData(
  ohlcData: CoinGeckoOhlcCandle[],
  fearGreedData: FearGreedPoint[],
  symbol: string
): Promise<PatternRegimeSummary> {
  // Extract closes
  const closes = ohlcData.map((c) => c.close);
  const currentClose = closes[closes.length - 1];

  // Compute EMAs
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const currentEma20 = ema20[ema20.length - 1];
  const currentEma50 = ema50[ema50.length - 1];
  const prevEma20 = ema20[ema20.length - 2];

  // 1. Trend State
  let trendState: PatternRegimeSummary["trendState"] = "choppy";
  const ema20Slope = currentEma20 - prevEma20;

  if (currentClose > currentEma20 && currentClose > currentEma50 && ema20Slope > 0) {
    trendState = "uptrend";
  } else if (
    currentClose < currentEma20 &&
    currentClose < currentEma50 &&
    ema20Slope < 0
  ) {
    trendState = "downtrend";
  } else if (Math.abs(ema20Slope) < currentClose * 0.001) {
    // Less than 0.1% daily change
    trendState = "range";
  }

  // 2. Volatility Regime
  const returns = dailyReturns(closes.slice(-30)); // Last 30 days
  const volatility = stdDev(returns) * Math.sqrt(365); // Annualized

  let volRegime: PatternRegimeSummary["volRegime"] = "normal";
  if (volatility < VOL_LOW_THRESHOLD) {
    volRegime = "low";
  } else if (volatility > VOL_HIGH_THRESHOLD) {
    volRegime = "extreme";
  } else if (volatility > VOL_NORMAL_THRESHOLD) {
    volRegime = "high";
  }

  // 3. Price Position (relative to 90d range)
  const max90d = Math.max(...closes);
  const min90d = Math.min(...closes);
  const range90d = max90d - min90d;
  const pricePosition = range90d > 0 ? (currentClose - min90d) / range90d : 0.5;

  // 4. Fear & Greed
  const latestFearGreed = fearGreedData[fearGreedData.length - 1];
  const fearGreedValue = latestFearGreed?.value;
  const fearGreedLabel = latestFearGreed
    ? mapFearGreedLabel(latestFearGreed.classification)
    : undefined;

  // 5. Cycle Phase & Top/Bottom Risk
  let cyclePhase: PatternRegimeSummary["cyclePhase"] = "unknown";
  let topBottomRisk: PatternRegimeSummary["topBottomRisk"] = "neutral";

  // Late bull / top risk conditions
  if (
    pricePosition > NEAR_HIGH_THRESHOLD &&
    trendState === "uptrend" &&
    fearGreedValue &&
    fearGreedValue >= 70
  ) {
    cyclePhase = "late_bull";
    topBottomRisk = "top_risk";
  }
  // Euphoria conditions (extreme greed + very high prices)
  else if (
    pricePosition > 0.95 &&
    fearGreedValue &&
    fearGreedValue >= 85 &&
    volRegime === "high"
  ) {
    cyclePhase = "euphoria";
    topBottomRisk = "top_risk";
  }
  // Capitulation / bottom risk conditions
  else if (
    pricePosition < NEAR_LOW_THRESHOLD &&
    trendState === "downtrend" &&
    fearGreedValue &&
    fearGreedValue <= 30
  ) {
    cyclePhase = "capitulation";
    topBottomRisk = "bottom_risk";
  }
  // Accumulation (fear but stabilizing)
  else if (
    pricePosition < 0.3 &&
    trendState === "range" &&
    fearGreedValue &&
    fearGreedValue <= 40
  ) {
    cyclePhase = "accumulation";
    topBottomRisk = "bottom_risk";
  }
  // Mid bull (healthy uptrend)
  else if (
    trendState === "uptrend" &&
    pricePosition > 0.4 &&
    pricePosition < 0.8 &&
    volRegime !== "extreme"
  ) {
    cyclePhase = "mid_bull";
  }
  // Early bull (starting to trend up from lows)
  else if (
    trendState === "uptrend" &&
    pricePosition < 0.5 &&
    fearGreedValue &&
    fearGreedValue < 60
  ) {
    cyclePhase = "early_bull";
  }
  // Bear market
  else if (trendState === "downtrend" && pricePosition < 0.6) {
    cyclePhase = "bear";
  }
  // Sideways
  else if (trendState === "range" || trendState === "choppy") {
    cyclePhase = "sideways";
  }

  // 6. Build notes
  const notes = buildRegimeNotes(
    fearGreedValue,
    fearGreedLabel,
    pricePosition,
    topBottomRisk
  );

  const regime: PatternRegimeSummary = {
    cyclePhase,
    trendState,
    volRegime,
    topBottomRisk,
    externalLabels: fearGreedValue
      ? {
          fearGreedValue,
          fearGreedLabel,
          notes,
        }
      : undefined,
  };

  console.log(
    `✅ Pattern Regime: ${symbol} - ${cyclePhase} (${trendState}, ${volRegime} vol, ${topBottomRisk})`
  );

  return regime;
}

/**
 * Build human-readable notes about the regime
 */
function buildRegimeNotes(
  fearGreedValue: number | undefined,
  fearGreedLabel:
    | "extreme_fear"
    | "fear"
    | "neutral"
    | "greed"
    | "extreme_greed"
    | "unknown"
    | undefined,
  pricePosition: number,
  topBottomRisk: PatternRegimeSummary["topBottomRisk"]
): string {
  const parts: string[] = [];

  if (fearGreedValue !== undefined) {
    parts.push(`FG=${fearGreedValue} (${fearGreedLabel || "unknown"})`);
  }

  const positionPct = Math.round(pricePosition * 100);
  parts.push(`Price at ${positionPct}% of 90d range`);

  if (topBottomRisk === "top_risk") {
    parts.push("Elevated top risk");
  } else if (topBottomRisk === "bottom_risk") {
    parts.push("Elevated bottom risk");
  }

  return parts.join(". ");
}

