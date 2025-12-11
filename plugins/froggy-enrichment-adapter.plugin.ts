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
import { computeTechnicalEnrichment } from "../src/enrichment/technicalIndicators.js";
import { detectPatterns } from "../src/enrichment/patternRecognition.js";
import { computeFroggySentiment } from "../src/indicator/froggySentimentProfile.js";
import { computePatternRegimeSummary } from "../src/indicator/patternRegimeProfile.js";
import type { AfiCandle } from "../src/types/AfiCandle.js";
import type { TechnicalLensV1, PatternLensV1, SentimentLensV1, NewsLensV1, AiMlLensV1, SupportedLens } from "../src/types/UssLenses.js";
import type { NewsProvider, NewsShockSummary } from "../src/news/newsProvider.js";
import { DEFAULT_NEWS_SUMMARY } from "../src/news/newsProvider.js";
import { createNewsDataProvider } from "../src/news/newsdataNewsProvider.js";
import { computeNewsFeatures, type NewsFeatures } from "../src/news/newsFeatures.js";

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
 * Create a NewsProvider based on environment configuration
 *
 * Supports:
 * - NEWS_PROVIDER=newsdata → NewsData.io provider
 * - NEWS_PROVIDER=none or unset → null (news enrichment disabled)
 *
 * Returns null if provider is disabled or configuration is invalid.
 */
function createNewsProvider(): NewsProvider | null {
  const providerType = process.env.NEWS_PROVIDER?.toLowerCase();
  const debugNews = process.env.AFI_DEBUG_NEWS === "1";

  if (debugNews) {
    console.log(`[NewsProvider] DEBUG: NEWS_PROVIDER="${providerType}"`);
    const apiKey = process.env.NEWSDATA_API_KEY;
    console.log(`[NewsProvider] DEBUG: NEWSDATA_API_KEY=${apiKey ? `${apiKey.slice(0, 3)}...${apiKey.slice(-3)}` : "NOT SET"}`);
  }

  if (!providerType || providerType === "none") {
    console.log("[NewsProvider] News enrichment disabled (NEWS_PROVIDER not set or 'none')");
    return null;
  }

  if (providerType === "newsdata") {
    const provider = createNewsDataProvider();
    if (debugNews) {
      console.log(`[NewsProvider] DEBUG: Created NewsDataProvider: ${provider ? "SUCCESS" : "FAILED (null)"}`);
    }
    return provider;
  }

  console.warn(`[NewsProvider] Unknown NEWS_PROVIDER: ${providerType}. News enrichment disabled.`);
  return null;
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
  const debugNews = process.env.AFI_DEBUG_NEWS === "1";

  if (debugNews) {
    process.stderr.write(`[FroggyEnrichment] ⚡ Starting enrichment for signal ${signal.signalId}\n`);
  }

  // Validate input
  const validatedInput = inputSchema.parse(signal);

  // Read enrichment profile from signal meta (or use default)
  const profile = validatedInput.meta.enrichmentProfile as EnrichmentProfile | undefined;
  const effectiveProfile = profile || getDefaultEnrichmentProfile();

  if (debugNews) {
    process.stderr.write(`[FroggyEnrichment] effectiveProfile: ${JSON.stringify(effectiveProfile)}\n`);
  }

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
    try {
      // Fetch OHLCV data from exchange (or demo adapter)
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

        // Compute regime-level context (async, from external APIs)
        // This adds multi-day market state context to the pattern lens
        const regimeSummary = await computePatternRegimeSummary(
          validatedInput.meta.symbol,
          validatedInput.meta.timeframe
        ).catch((err) => {
          console.warn(`⚠️  Pattern Regime: Failed to compute regime:`, err.message);
          return null;
        });

        // Merge regime into pattern payload if available
        if (regimeSummary && patternLensPayload) {
          patternLensPayload.regime = regimeSummary;
        }

        if (patternLensPayload) {
          // Add USS lens
          lenses.push({
            type: "pattern",
            version: "v1",
            payload: patternLensPayload,
          });

          // Keep legacy format for afi-core compatibility
          // Mirror regime data to top-level pattern object when available
          pattern = {
            patternName: patternLensPayload.patternName,
            patternConfidence: patternLensPayload.patternConfidence,
          };

          // Add regime if available
          if (patternLensPayload.regime) {
            (pattern as any).regime = patternLensPayload.regime;
          }

          enrichedCategories.push("pattern");
        }
      }

      console.log(`✅ Enrichment: Fetched price data from ${actualPriceSource} for ${validatedInput.meta.symbol}`);
    } catch (error) {
      // Fail-soft: skip technical/pattern enrichment if price data unavailable
      console.warn(`⚠️  Enrichment: Failed to fetch price data from ${actualPriceSource}:`, error);
      console.warn(`⚠️  Enrichment: Skipping technical and pattern enrichment`);
    }
  }

  // Sentiment lens (Coinalyze perp sentiment)
  let sentiment: any = undefined;
  if (isCategoryEnabled(effectiveProfile, "sentiment")) {
    // Fetch real perp sentiment from Coinalyze
    // Default to BTC perp, but could be parameterized per signal in the future
    const sentimentPayload = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

    if (sentimentPayload) {
      // Add USS lens
      lenses.push({
        type: "sentiment",
        version: "v1",
        payload: sentimentPayload,
      });

      // Keep legacy format for afi-core compatibility
      // Map perpSentimentScore (0-100) to legacy score (0.0-1.0)
      const legacyScore = sentimentPayload.perpSentimentScore
        ? sentimentPayload.perpSentimentScore / 100
        : 0.5;

      sentiment = {
        score: legacyScore,
        tags: [
          sentimentPayload.positioningBias || "balanced",
          sentimentPayload.fundingRegime || "normal",
        ],
      };
      enrichedCategories.push("sentiment");
    } else {
      // Fallback to null if Coinalyze is unavailable
      console.warn("⚠️  Sentiment enrichment: Coinalyze data unavailable, skipping sentiment lens");
    }
  }

  // News lens - pluggable provider (NewsData.io, etc.)
  let news: any = undefined;
  let newsFeatures: NewsFeatures | null | undefined = undefined;  // Declare outside block for FroggyEnrichedView
  if (isCategoryEnabled(effectiveProfile, "news")) {
    const debugNews = process.env.AFI_DEBUG_NEWS === "1";

    // Create provider (cached singleton would be better for production)
    const newsProvider = createNewsProvider();

    if (debugNews) {
      console.log(`[NewsEnrichment] Provider created: ${newsProvider ? newsProvider.constructor.name : "null"}`);
    }

    let newsSummary: NewsShockSummary | null = null;

    if (newsProvider) {
      try {
        const windowHours = process.env.NEWS_WINDOW_HOURS
          ? parseInt(process.env.NEWS_WINDOW_HOURS, 10)
          : 4;

        if (debugNews) {
          console.log(`[NewsEnrichment] DEBUG: Calling fetchRecentNews for symbol="${validatedInput.meta.symbol}", windowHours=${windowHours}`);
        }

        newsSummary = await newsProvider.fetchRecentNews({
          symbol: validatedInput.meta.symbol ?? "BTCUSDT",
          windowHours,
        });

        if (debugNews) {
          console.log(`[NewsEnrichment] DEBUG: fetchRecentNews returned:`, JSON.stringify(newsSummary, null, 2));
        }
      } catch (err) {
        console.warn(`[NewsEnrichment] Error fetching news for ${validatedInput.meta.symbol}:`, err);
        newsSummary = null;
      }
    }

    // Use provider data if available, otherwise fall back to default
    const effectiveNews = newsSummary ?? DEFAULT_NEWS_SUMMARY;

    if (debugNews) {
      console.log(`[NewsEnrichment] DEBUG: effectiveNews (after fallback):`, JSON.stringify(effectiveNews, null, 2));
    }

    // Map to NewsLensV1 payload format (with structured items)
    const newsPayload: NewsLensV1["payload"] = {
      hasShockEvent: effectiveNews.hasShockEvent,
      shockDirection: effectiveNews.shockDirection,
      headlines: effectiveNews.headlines, // Already string[] from provider
      items: effectiveNews.items?.map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt.toISOString(),
      })),
    };

    lenses.push({
      type: "news",
      version: "v1",
      payload: newsPayload,
    });

    // Mirror to top-level news object (for afi-core compatibility)
    news = {
      hasShockEvent: newsPayload.hasShockEvent,
      shockDirection: newsPayload.shockDirection,
      headlines: newsPayload.headlines,
      items: newsPayload.items,
    };

    // Compute NewsFeatures from news enrichment (UWR-ready, not wired yet)
    // This is an additive layer that doesn't affect current UWR scoring
    newsFeatures = computeNewsFeatures(newsSummary);

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
  if (patternLensPayload?.regime) {
    const regime = patternLensPayload.regime;
    enrichmentSummary += `. Regime: ${regime.cyclePhase || "unknown"} (${regime.trendState || "?"}, ${regime.volRegime || "?"} vol`;
    if (regime.externalLabels?.fearGreedLabel) {
      enrichmentSummary += `, ${regime.externalLabels.fearGreedLabel}`;
    }
    enrichmentSummary += `)`;
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
    newsFeatures: newsFeatures || undefined,  // Add newsFeatures (UWR-ready, not wired yet)
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

