/**
 * Froggy Enrichment: Technical + Pattern Plugin
 *
 * Purpose: First stage of Froggy enrichment - computes technical indicators and pattern recognition.
 *
 * This plugin is part of the modular enrichment pipeline where enrichment is split into:
 * 1. Tech + Pattern (this plugin) - OHLCV-based analysis
 * 2. Sentiment + News + AI/ML (froggy-enrichment-adapter) - External API enrichment
 *
 * Input: USS v1.1 signal from context.rawUss (via uss-telemetry-deriver)
 * Output: Signal with technical and pattern enrichment attached
 *
 * Part of: froggy-trend-pullback-v1 pipeline (DAG-aware)
 */

import { z } from "zod";
import { getPriceFeedAdapter, getDefaultPriceSource } from "../src/adapters/exchanges/priceFeedRegistry.js";
import type { OHLCVCandle } from "../src/adapters/exchanges/types.js";
import { computeTechnicalEnrichment } from "../src/enrichment/technicalIndicators.js";
import { detectPatterns } from "../src/enrichment/patternRecognition.js";
import { computePatternRegimeSummary } from "../src/indicator/patternRegimeProfile.js";
import type { AfiCandle } from "../src/types/AfiCandle.js";
import type { TechnicalLensV1, PatternLensV1 } from "../src/types/UssLenses.js";

/**
 * Input schema: USS v1.1 signal from context.rawUss (via uss-telemetry-deriver).
 */
const inputSchema = z.object({
  signalId: z.string(),
  score: z.number(),
  confidence: z.number(),
  timestamp: z.string(),
  meta: z.object({
    symbol: z.string(),
    market: z.string(),
    timeframe: z.string(),
    strategy: z.string(),
    direction: z.enum(["long", "short", "neutral"]),
  }),
});

type StructuredSignal = z.infer<typeof inputSchema>;

/**
 * Output type: Signal with technical and pattern enrichment attached.
 * This is an intermediate type used between enrichment stages.
 */
export interface TechPatternEnrichedSignal extends StructuredSignal {
  _techPatternEnrichment?: {
    technical?: TechnicalLensV1["payload"];
    pattern?: PatternLensV1["payload"];
    priceSource: string;
    enrichedAt: string;
  };
}

/**
 * Convert OHLCVCandle to AfiCandle format
 */
function toAfiCandles(candles: OHLCVCandle[]): AfiCandle[] {
  return candles.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

/**
 * Enrich structured signal with technical indicators and pattern recognition.
 * 
 * Fetches OHLCV data from configured price source and computes:
 * - Technical indicators (EMA, RSI, ATR, volume, trend bias)
 * - Pattern recognition (candlestick patterns, structure bias)
 * - Pattern regime (cycle phase, trend state, volatility regime)
 * 
 * Fail-soft: Returns signal with empty enrichment if price data unavailable.
 * 
 * @param signal - USS v1.1 signal from context.rawUss (via uss-telemetry-deriver)
 * @returns Signal with technical and pattern enrichment attached
 */
async function run(signal: StructuredSignal): Promise<TechPatternEnrichedSignal> {
  // Validate input
  const validatedInput = inputSchema.parse(signal);

  // Determine price source
  const priceSource = getDefaultPriceSource();

  let technicalPayload: TechnicalLensV1["payload"] | undefined;
  let patternPayload: PatternLensV1["payload"] | undefined;

  try {
    // Fetch OHLCV data from exchange (or demo adapter)
    const adapter = getPriceFeedAdapter(priceSource);
    const candles = await adapter.getOHLCV({
      symbol: validatedInput.meta.symbol,
      timeframe: validatedInput.meta.timeframe,
      limit: 100, // Need enough candles for EMA-50
    });

    // Convert to AfiCandle format
    const afiCandles = toAfiCandles(candles);

    // Compute technical indicators
    technicalPayload = computeTechnicalEnrichment(afiCandles);

    // Compute pattern recognition
    patternPayload = detectPatterns(afiCandles);

    // Compute regime-level context (async, from external APIs)
    if (patternPayload) {
      const regimeSummary = await computePatternRegimeSummary(
        validatedInput.meta.symbol,
        validatedInput.meta.timeframe
      ).catch((err) => {
        console.warn(`⚠️  Pattern Regime: Failed to compute regime:`, err.message);
        return null;
      });

      // Merge regime into pattern payload if available
      if (regimeSummary) {
        patternPayload.regime = regimeSummary;
      }
    }

    console.log(`✅ Tech+Pattern Enrichment: Fetched price data from ${priceSource} for ${validatedInput.meta.symbol}`);
  } catch (error) {
    // Fail-soft: skip technical/pattern enrichment if price data unavailable
    console.warn(`⚠️  Tech+Pattern Enrichment: Failed to fetch price data from ${priceSource}:`, error);
    console.warn(`⚠️  Tech+Pattern Enrichment: Returning signal without tech/pattern data`);
  }

  // Attach enrichment to signal
  const enriched: TechPatternEnrichedSignal = {
    ...validatedInput,
    _techPatternEnrichment: {
      technical: technicalPayload,
      pattern: patternPayload,
      priceSource,
      enrichedAt: new Date().toISOString(),
    },
  };

  return enriched;
}

export default {
  run,
  inputSchema,
};

