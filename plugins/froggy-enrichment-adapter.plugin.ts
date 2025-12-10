/**
 * Froggy Enrichment Adapter Plugin - Dev/Demo Only
 * 
 * Purpose: Bridge reactor structured signal → Froggy enrichment input shape.
 * 
 * This plugin imports and uses afi-core's FroggyEnrichedView type to ensure
 * compatibility with Froggy's analyst logic.
 * 
 * For demo purposes, we generate plausible technical indicators (RSI, MA, etc.)
 * that Froggy can consume. In production, these would come from real market data.
 * 
 * Part of: froggy-trend-pullback-v1 pipeline (Alpha → Pixel Rick → Froggy → Val Dook → Execution Sim)
 */

import { z } from "zod";
import type {
  FroggyEnrichedView,
  EnrichmentProfile
} from "afi-core/analysts/froggy.enrichment_adapter.js";
import { getPriceFeedAdapter, getDefaultPriceSource } from "../src/adapters/exchanges/priceFeedRegistry.js";
import type { OHLCVCandle } from "../src/adapters/exchanges/types.js";
import { normalizeMarketType, mapMarketTypeToVenueType } from "../src/utils/marketUtils.js";
import { computeTechnicalEnrichment, type AfiCandle } from "../src/enrichment/technicalIndicators.js";
import { detectPatterns } from "../src/enrichment/patternRecognition.js";
import type { TechnicalLensV1, PatternLensV1, SentimentLensV1, NewsLensV1, AiMlLensV1, SupportedLens } from "../src/types/UssLenses.js";

/**
 * Input schema: structured signal from signal-structurer.
 * Now includes optional enrichmentProfile in meta.
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
    enrichmentProfile: z.any().optional(), // EnrichmentProfile from afi-core
  }),
});

type StructuredSignal = z.infer<typeof inputSchema>;

/**
 * Compute default enrichment profile if none is provided.
 * Default: all categories enabled with "default" preset.
 */
function getDefaultEnrichmentProfile(): EnrichmentProfile {
  return {
    technical: { enabled: true, preset: "default" },
    pattern: { enabled: true, preset: "default" },
    sentiment: { enabled: true, preset: "default" },
    news: { enabled: true, preset: "default" },
    aiMl: { enabled: true, preset: "default" },
  };
}

/**
 * Check if a category is enabled in the enrichment profile.
 * Missing categories default to enabled.
 */
function isCategoryEnabled(
  profile: EnrichmentProfile | undefined,
  category: keyof EnrichmentProfile
): boolean {
  if (!profile) return true; // No profile = all enabled
  const categoryConfig = profile[category];
  if (!categoryConfig) return true; // Missing category = enabled
  return categoryConfig.enabled !== false; // Explicit false = disabled
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
 * Enrich structured signal with Froggy-compatible data.
 *
 * Now honors EnrichmentProfile from signal.meta.enrichmentProfile:
 * - Only populates enrichment sections that are enabled in the profile
 * - Uses default profile (all enabled) if no profile is provided
 * - Fetches real price data from configured exchange (BloFin) when AFI_PRICE_FEED_SOURCE is set
 * - Falls back to demo/mocked data when price source is "demo" or fetch fails
 *
 * @param signal - Structured signal from Pixel Rick
 * @returns FroggyEnrichedView ready for Froggy analyst
 */
async function run(signal: StructuredSignal): Promise<FroggyEnrichedView> {
  // Validate input
  const validatedInput = inputSchema.parse(signal);

  // Read enrichment profile from signal meta (or use default)
  const profile = validatedInput.meta.enrichmentProfile as EnrichmentProfile | undefined;
  const effectiveProfile = profile || getDefaultEnrichmentProfile();

  // Track which categories were actually enriched
  const enrichedCategories: string[] = [];

  // USS Lenses array
  const lenses: SupportedLens[] = [];

  // Determine price source (BloFin/Coinbase or demo)
  // This may be overridden to "demo" if real data fetch fails
  let actualPriceSource = getDefaultPriceSource();

  // Fetch real OHLCV data and compute USS lenses
  let technical: any = undefined;
  let pattern: any = undefined;
  let technicalLensPayload: TechnicalLensV1["payload"] | null = null;
  let patternLensPayload: PatternLensV1["payload"] | null = null;

  if (isCategoryEnabled(effectiveProfile, "technical") || isCategoryEnabled(effectiveProfile, "pattern")) {
    if (actualPriceSource !== "demo") {
      try {
        // Fetch real OHLCV data from exchange
        const adapter = getPriceFeedAdapter(actualPriceSource);
        const candles = await adapter.getOHLCV({
          symbol: validatedInput.meta.symbol,
          timeframe: validatedInput.meta.timeframe,
          limit: 100, // Need enough candles for EMA-50
        });

        // Convert to AfiCandle format
        const afiCandles = toAfiCandles(candles);

        // Compute technical lens (if enabled)
        if (isCategoryEnabled(effectiveProfile, "technical")) {
          technicalLensPayload = computeTechnicalEnrichment(afiCandles);
          if (technicalLensPayload) {
            // Add USS lens
            lenses.push({
              type: "technical",
              version: "v1",
              payload: technicalLensPayload,
            });

            // Keep legacy format for afi-core compatibility
            technical = {
              emaDistancePct: technicalLensPayload.emaDistancePct,
              isInValueSweetSpot: technicalLensPayload.isInValueSweetSpot,
              brokeEmaWithBody: false, // Not computed in new version
              indicators: {
                rsi: technicalLensPayload.rsi14,
                ema_20: technicalLensPayload.ema20,
                ema_50: technicalLensPayload.ema50,
                volume_ratio: technicalLensPayload.volumeRatio,
              },
            };
            enrichedCategories.push("technical");
          }
        }

        // Compute pattern lens (if enabled)
        if (isCategoryEnabled(effectiveProfile, "pattern")) {
          patternLensPayload = detectPatterns(afiCandles);
          if (patternLensPayload) {
            // Add USS lens
            lenses.push({
              type: "pattern",
              version: "v1",
              payload: patternLensPayload,
            });

            // Keep legacy format for afi-core compatibility
            pattern = {
              patternName: patternLensPayload.patternName,
              patternConfidence: patternLensPayload.patternConfidence,
            };
            enrichedCategories.push("pattern");
          }
        }

        console.log(`✅ Enrichment: Fetched real price data from ${actualPriceSource} for ${validatedInput.meta.symbol}`);
      } catch (error) {
        // Fall back to demo/null if real data fetch fails
        console.warn(`⚠️  Enrichment: Failed to fetch real price data from ${actualPriceSource}:`, error);
        actualPriceSource = "demo";  // Update to reflect actual source used
      }
    }
  }

  // Sentiment lens (demo data for now)
  let sentiment: any = undefined;
  if (isCategoryEnabled(effectiveProfile, "sentiment")) {
    const sentimentPayload: SentimentLensV1["payload"] = {
      score: 0.5 + (Math.random() - 0.5) * 0.4, // 0.3-0.7 range
      tags: ["bullish", "trending"],
      source: "demo",
    };

    lenses.push({
      type: "sentiment",
      version: "v1",
      payload: sentimentPayload,
    });

    sentiment = {
      score: sentimentPayload.score,
      tags: sentimentPayload.tags,
    };
    enrichedCategories.push("sentiment");
  }

  // News lens (demo data for now)
  let news: any = undefined;
  if (isCategoryEnabled(effectiveProfile, "news")) {
    const newsPayload: NewsLensV1["payload"] = {
      hasShockEvent: false,
      shockDirection: "none",
      headlines: [],
    };

    lenses.push({
      type: "news",
      version: "v1",
      payload: newsPayload,
    });

    news = {
      hasShockEvent: newsPayload.hasShockEvent,
      shockDirection: newsPayload.shockDirection,
      headlines: newsPayload.headlines,
    };
    enrichedCategories.push("news");
  }

  // AI/ML lens (demo data for now)
  let aiMl: any = undefined;
  if (isCategoryEnabled(effectiveProfile, "aiMl")) {
    const aiMlPayload: AiMlLensV1["payload"] = {
      ensembleScore: 0.6 + Math.random() * 0.2, // 0.6-0.8 range
      modelTags: ["trend-following", "pullback"],
    };

    lenses.push({
      type: "aiMl",
      version: "v1",
      payload: aiMlPayload,
    });

    aiMl = {
      ensembleScore: aiMlPayload.ensembleScore,
      modelTags: aiMlPayload.modelTags,
    };
    enrichedCategories.push("aiMl");
  }

  // Normalize market type and determine venue type
  const normalizedMarketType = normalizeMarketType(validatedInput.meta.market);
  const venueType = mapMarketTypeToVenueType(normalizedMarketType, actualPriceSource === "demo");

  // Build enrichment stage summary (human-readable hint from lenses)
  let enrichmentSummary = `Applied enrichment legos: ${enrichedCategories.join(", ")}`;
  if (technicalLensPayload) {
    enrichmentSummary += `. Trend: ${technicalLensPayload.trendBias} (EMA20=${technicalLensPayload.ema20.toFixed(2)}, RSI=${technicalLensPayload.rsi14.toFixed(0)})`;
  }
  if (patternLensPayload?.patternName) {
    enrichmentSummary += `. Pattern: ${patternLensPayload.patternName}`;
  }

  // Build FroggyEnrichedView
  const enriched: FroggyEnrichedView = {
    signalId: validatedInput.signalId,
    symbol: validatedInput.meta.symbol,
    market: normalizedMarketType,  // Use normalized market type
    timeframe: validatedInput.meta.timeframe,
    technical,
    pattern,
    sentiment,
    news,
    aiMl,
    enrichmentMeta: {
      categories: enrichedCategories,
      enrichedBy: "froggy-enrichment-adapter",
      enrichedAt: new Date().toISOString(),
    },
  };

  // Attach USS lenses (Phase 2: Enrichment Data)
  (enriched as any).lenses = lenses;

  // Attach price source metadata as a separate property (not part of afi-core's FroggyEnrichedView)
  // This will be read by froggyDemoService for TSSD vault persistence
  // PROVENANCE REQUIREMENT: These fields are REQUIRED for TSSD vault writes
  (enriched as any)._priceFeedMetadata = {
    priceSource: actualPriceSource,  // Use actual source (may be "demo" if fallback occurred)
    venueType,
    marketType: normalizedMarketType,  // Include normalized market type for TSSD
    // Mirror enrichment data for debugging/provenance
    technicalIndicators: technicalLensPayload || undefined,
    patternSignals: patternLensPayload || undefined,
  };

  // Attach enrichment summary for stage summaries
  (enriched as any)._enrichmentSummary = enrichmentSummary;

  return enriched;
}

export default {
  run,
  inputSchema,
};

