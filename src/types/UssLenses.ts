/**
 * Universal Signal Schema (USS) Lenses for AFI Reactor
 *
 * Lightweight USS lens system for enrichment data.
 * Designed to be forward-compatible with afi-config's full USS schema.
 *
 * Lenses are versioned, optional extensions that attach domain-specific
 * enrichment data to signals in a structured, composable way.
 *
 * @module UssLenses
 */

/**
 * Base lens interface.
 * All lenses must have a type and version for forward compatibility.
 */
export interface UssLens {
  /** Lens type identifier */
  type: string;
  /** Lens schema version */
  version: string;
  /** Lens-specific payload */
  payload: unknown;
}

/**
 * Technical Lens V1 - Technical Indicators
 *
 * Provides computed technical indicators from OHLCV data.
 * Includes trend bias, moving averages, momentum, and volatility metrics.
 */
export interface TechnicalLensV1 extends UssLens {
  type: "technical";
  version: "v1";
  payload: {
    /** Exponential Moving Average (20-period) */
    ema20: number;
    /** Exponential Moving Average (50-period) */
    ema50: number;
    /** Relative Strength Index (14-period) */
    rsi14: number;
    /** Average True Range (14-period) - volatility measure */
    atr14?: number;
    /** Trend bias based on EMA relationship */
    trendBias: "bullish" | "bearish" | "range";
    /** Volume ratio (current vs 20-period average) */
    volumeRatio?: number;
    /** Distance from EMA-20 as percentage */
    emaDistancePct?: number;
    /** Whether price is in "sweet spot" (within 1% of EMA-20) */
    isInValueSweetSpot?: boolean;
  };
}

/**
 * Pattern Lens V1 - Candlestick & Chart Patterns
 *
 * Provides detected candlestick patterns and structural analysis.
 * Includes classic patterns (engulfing, pin bar, etc.) and trend structure.
 */
export interface PatternLensV1 extends UssLens {
  type: "pattern";
  version: "v1";
  payload: {
    /** Bullish engulfing pattern detected */
    bullishEngulfing?: boolean;
    /** Bearish engulfing pattern detected */
    bearishEngulfing?: boolean;
    /** Pin bar (hammer/shooting star) detected */
    pinBar?: boolean;
    /** Inside bar pattern detected */
    insideBar?: boolean;
    /** Structural bias based on swing highs/lows */
    structureBias?: "higher-highs" | "lower-lows" | "choppy";
    /** Trend pullback pattern confirmed (Froggy-specific) */
    trendPullbackConfirmed?: boolean;
    /** Pattern name (if single dominant pattern) */
    patternName?: string;
    /** Pattern confidence score (0-100) */
    patternConfidence?: number;
  };
}

/**
 * Sentiment Lens V1 - Market Sentiment
 *
 * Provides sentiment analysis from social media, news, and on-chain data.
 */
export interface SentimentLensV1 extends UssLens {
  type: "sentiment";
  version: "v1";
  payload: {
    /** Sentiment score (0.0 = bearish, 0.5 = neutral, 1.0 = bullish) */
    score: number;
    /** Sentiment tags */
    tags?: string[];
    /** Source of sentiment data */
    source?: string;
  };
}

/**
 * News Lens V1 - News & Events
 *
 * Provides news and event analysis.
 */
export interface NewsLensV1 extends UssLens {
  type: "news";
  version: "v1";
  payload: {
    /** Whether a shock event was detected */
    hasShockEvent: boolean;
    /** Direction of shock (if any) */
    shockDirection: "bullish" | "bearish" | "none";
    /** Recent headlines */
    headlines?: string[];
  };
}

/**
 * AI/ML Lens V1 - AI/ML Model Predictions
 *
 * Provides AI/ML model predictions and ensemble scores.
 */
export interface AiMlLensV1 extends UssLens {
  type: "aiMl";
  version: "v1";
  payload: {
    /** Ensemble score from multiple models */
    ensembleScore: number;
    /** Model tags/identifiers */
    modelTags?: string[];
  };
}

/**
 * Union type of all supported lenses
 */
export type SupportedLens =
  | TechnicalLensV1
  | PatternLensV1
  | SentimentLensV1
  | NewsLensV1
  | AiMlLensV1;

/**
 * Helper: Add a lens to a lenses array
 */
export function addLens(
  existingLenses: SupportedLens[] | undefined,
  newLens: SupportedLens
): SupportedLens[] {
  const lenses = existingLenses || [];
  return [...lenses, newLens];
}

/**
 * Helper: Find a lens by type and version
 */
export function findLens<T extends SupportedLens>(
  lenses: SupportedLens[] | undefined,
  type: string,
  version: string
): T | undefined {
  return lenses?.find((l) => l.type === type && l.version === version) as T | undefined;
}

