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
 * Pattern Regime Summary - Multi-day/multi-week market state context
 *
 * Provides regime-level context for pattern interpretation, including:
 * - Cycle phase (early/mid/late bull, bear, sideways, etc.)
 * - Trend state and volatility regime
 * - Top/bottom risk assessment
 * - External sentiment indicators (Fear & Greed)
 */
export interface PatternRegimeSummary {
  /** Overall multi-day / multi-week "state of the market" */
  cyclePhase?:
    | "early_bull"
    | "mid_bull"
    | "late_bull"
    | "bear"
    | "sideways"
    | "capitulation"
    | "accumulation"
    | "euphoria"
    | "unknown";

  /** Current trend state based on price action */
  trendState?: "uptrend" | "downtrend" | "range" | "choppy";

  /** Volatility regime classification */
  volRegime?: "low" | "normal" | "high" | "extreme";

  /** Top/bottom risk assessment */
  topBottomRisk?:
    | "top_risk"        // elevated probability we're in a late-stage top or overheated zone
    | "bottom_risk"     // elevated probability of capitulation / bottoming conditions
    | "neutral";

  /** Optional labels from external indicators (Fear & Greed, etc.) */
  externalLabels?: {
    /** Fear & Greed index value (0-100) from Alternative.me */
    fearGreedValue?: number;
    /** Fear & Greed classification */
    fearGreedLabel?:
      | "extreme_fear"
      | "fear"
      | "neutral"
      | "greed"
      | "extreme_greed"
      | "unknown";
    /** Short human-readable explanation */
    notes?: string;
  };
}

/**
 * Pattern Lens V1 - Governed pattern lane observations (FLPR-GOV).
 *
 * The lens payload is the governed afi.enrichment.pattern.v1 result minus the
 * category marker: bounded normalized kernel observations (motifs, discords,
 * change points, pivots over the analyzed series frame) plus the optional
 * candlestick/structure observation block.
 */
export interface PatternLensV1 extends UssLens {
  type: "pattern";
  version: "v1";
  payload: {
    /** Identity + shape of the analyzed series frame. */
    series: { seriesId: string; length: number; indexBasis: "position" | "epochMs" };
    /** Bounded normalized motif observations. */
    motifs: unknown[];
    /** Bounded normalized discord (anomaly) observations. */
    discords: unknown[];
    /** Bounded normalized change-point observations. */
    changePoints: unknown[];
    /** Bounded normalized support/resistance pivot observations. */
    pivots: unknown[];
    /** Optional candlestick/structure observation (D-FLPR-3 block). */
    candlestick?: {
      patternName: "bullish engulfing" | "bearish engulfing" | "pin bar" | "inside bar";
      patternConfidence: number;
      flags?: {
        bullishEngulfing?: boolean;
        bearishEngulfing?: boolean;
        pinBar?: boolean;
        insideBar?: boolean;
      };
      structureBias?: "higher-highs" | "lower-lows" | "choppy";
      trendPullbackConfirmed?: boolean;
    };
  };
}

/**
 * Funding regime classification for perp markets
 */
export type FundingRegime =
  | "elevated_positive"
  | "normal"
  | "elevated_negative";

/**
 * Positioning bias based on funding and open interest
 */
export type PositioningBias =
  | "crowded_long"
  | "crowded_short"
  | "balanced";

/**
 * Sentiment Lens V1 - Governed sentiment lane observations (FLPR-GOV).
 *
 * The lens payload carries the governed afi.enrichment.sentiment.v1 axes:
 * derived, bounded positioning/funding/open-interest readings from the
 * selected sentiment ProviderInstance.
 */
export interface SentimentLensV1 extends UssLens {
  type: "sentiment";
  version: "v1";
  payload: {
    /**
     * Governed sentiment axis observations (afi.enrichment.sentiment.v1):
     * each item is one bounded axis reading in [-1, 1].
     */
    axes: {
      axis: "positioning" | "funding" | "openInterest" | "longShort" | "impliedVolatility" | "narrative";
      score: number;
      confidence?: number;
      horizon?: "intraday" | "daily" | "weekly" | "swing";
    }[];
  };
}

/**
 * News Lens V1 - News & Events
 *
 * Provides news and event analysis.
 *
 * BACKWARD COMPATIBILITY:
 * - headlines: string[] - Legacy format (title-only strings)
 * - items: NewsItem[] - New structured format with full metadata (optional)
 */
export interface NewsLensV1 extends UssLens {
  type: "news";
  version: "v1";
  payload: {
    /** Whether a shock event was detected */
    hasShockEvent: boolean;
    /** Direction of shock (if any) */
    shockDirection: "bullish" | "bearish" | "none" | "unknown";
    /** Recent headlines (legacy format - title strings only) */
    headlines?: string[];
    /** Structured news items with full metadata (optional, v2 format) */
    items?: {
      title: string;
      source: string;
      url: string;
      publishedAt: string; // ISO 8601 string at lens level
    }[];
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

