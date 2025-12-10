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
 * Calculate technical indicators from real OHLCV data
 *
 * Computes EMA, RSI, and other indicators from actual price candles.
 */
function calculateTechnicalIndicators(candles: OHLCVCandle[]) {
  if (candles.length < 50) {
    throw new Error("Need at least 50 candles for technical indicators");
  }

  // Calculate EMA-20 and EMA-50
  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);

  // Get latest candle
  const latestCandle = candles[candles.length - 1];
  const currentPrice = latestCandle.close;

  // Calculate EMA distance percentage
  const emaDistancePct = ((currentPrice - ema20) / ema20) * 100;

  // Check if in "sweet spot" (within 1% of EMA-20)
  const isInValueSweetSpot = Math.abs(emaDistancePct) <= 1;

  // Check if price broke EMA with body (close below EMA for uptrend)
  const brokeEmaWithBody = latestCandle.close < ema20 && latestCandle.open > ema20;

  // Calculate RSI (simplified 14-period)
  const rsi = calculateRSI(candles, 14);

  // Calculate volume ratio (current vs average)
  const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
  const volumeRatio = latestCandle.volume / avgVolume;

  return {
    emaDistancePct,
    isInValueSweetSpot,
    brokeEmaWithBody,
    indicators: {
      rsi,
      ema_20: ema20,
      ema_50: ema50,
      volume_ratio: volumeRatio,
    },
  };
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
function calculateEMA(candles: OHLCVCandle[], period: number): number {
  const multiplier = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;

  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate Relative Strength Index (RSI)
 */
function calculateRSI(candles: OHLCVCandle[], period: number = 14): number {
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
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

/**
 * Generate plausible technical indicators for demo purposes.
 *
 * Fallback when real data is not available.
 */
function generateDemoTechnicalIndicators() {
  // Generate plausible EMA distance (pullback scenario: -2% to +2%)
  const emaDistancePct = (Math.random() - 0.5) * 4;

  // Determine if in "sweet spot" (within 1% of EMA)
  const isInValueSweetSpot = Math.abs(emaDistancePct) <= 1;

  // Random chance of breaking EMA with body
  const brokeEmaWithBody = Math.random() < 0.3;

  return {
    emaDistancePct,
    isInValueSweetSpot,
    brokeEmaWithBody,
    indicators: {
      rsi: 30 + Math.random() * 40, // RSI between 30-70 (typical range)
      ema_20: 50000 + Math.random() * 1000,
      ema_50: 49500 + Math.random() * 1000,
      volume_ratio: 0.8 + Math.random() * 0.4, // 0.8-1.2x average
    },
  };
}

/**
 * Generate plausible pattern analysis for demo purposes.
 */
function generateDemoPatternAnalysis() {
  const patterns = [
    { name: "bullish engulfing", confidence: 75 },
    { name: "hammer", confidence: 65 },
    { name: "liquidity sweep", confidence: 80 },
    { name: "morning star", confidence: 70 },
    { name: "none", confidence: 0 },
  ];
  
  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  
  return {
    patternName: pattern.name !== "none" ? pattern.name : undefined,
    patternConfidence: pattern.confidence || undefined,
  };
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

  // Determine price source (BloFin or demo)
  // This may be overridden to "demo" if real data fetch fails
  let actualPriceSource = getDefaultPriceSource();

  // Fetch real price data if using BloFin, otherwise use demo data
  let technical: any = undefined;
  if (isCategoryEnabled(effectiveProfile, "technical")) {
    if (actualPriceSource !== "demo") {
      try {
        // Fetch real OHLCV data from exchange
        const adapter = getPriceFeedAdapter(actualPriceSource);
        const candles = await adapter.getOHLCV({
          symbol: validatedInput.meta.symbol,
          timeframe: validatedInput.meta.timeframe,
          limit: 100, // Need enough candles for EMA-50
        });

        // Calculate technical indicators from real data
        technical = calculateTechnicalIndicators(candles);
        enrichedCategories.push("technical");

        console.log(`✅ Enrichment: Fetched real price data from ${actualPriceSource} for ${validatedInput.meta.symbol}`);
      } catch (error) {
        // Fall back to demo data if real data fetch fails
        console.warn(`⚠️  Enrichment: Failed to fetch real price data from ${actualPriceSource}, falling back to demo data:`, error);
        actualPriceSource = "demo";  // Update to reflect actual source used
        technical = generateDemoTechnicalIndicators();
        enrichedCategories.push("technical");
      }
    } else {
      // Use demo data
      technical = generateDemoTechnicalIndicators();
      enrichedCategories.push("technical");
    }
  }

  const pattern = isCategoryEnabled(effectiveProfile, "pattern")
    ? generateDemoPatternAnalysis()
    : undefined;
  if (pattern) enrichedCategories.push("pattern");

  const sentiment = isCategoryEnabled(effectiveProfile, "sentiment")
    ? {
        score: 0.5 + (Math.random() - 0.5) * 0.4, // 0.3-0.7 range
        tags: ["bullish", "trending"],
      }
    : undefined;
  if (sentiment) enrichedCategories.push("sentiment");

  const news = isCategoryEnabled(effectiveProfile, "news")
    ? {
        hasShockEvent: false,
        shockDirection: "none" as const,
        headlines: [],
      }
    : undefined;
  if (news) enrichedCategories.push("news");

  const aiMl = isCategoryEnabled(effectiveProfile, "aiMl")
    ? {
        ensembleScore: 0.6 + Math.random() * 0.2, // 0.6-0.8 range
        modelTags: ["trend-following", "pullback"],
      }
    : undefined;
  if (aiMl) enrichedCategories.push("aiMl");

  // Normalize market type and determine venue type
  const normalizedMarketType = normalizeMarketType(validatedInput.meta.market);
  const venueType = mapMarketTypeToVenueType(normalizedMarketType, actualPriceSource === "demo");

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

  // Attach price source metadata as a separate property (not part of afi-core's FroggyEnrichedView)
  // This will be read by froggyDemoService for TSSD vault persistence
  // PROVENANCE REQUIREMENT: These fields are REQUIRED for TSSD vault writes
  (enriched as any)._priceFeedMetadata = {
    priceSource: actualPriceSource,  // Use actual source (may be "demo" if fallback occurred)
    venueType,
    marketType: normalizedMarketType,  // Include normalized market type for TSSD
  };

  return enriched;
}

export default {
  run,
  inputSchema,
};

