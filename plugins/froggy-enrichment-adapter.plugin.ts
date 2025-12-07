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
 * Generate plausible technical indicators for demo purposes.
 * 
 * In production, these would come from real market data sources.
 * For demo, we generate realistic-looking values that Froggy can process.
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
 * - Still uses demo/mocked data, but shaped according to the profile
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

  // Generate demo enrichment data only for enabled categories
  const technical = isCategoryEnabled(effectiveProfile, "technical")
    ? generateDemoTechnicalIndicators()
    : undefined;
  if (technical) enrichedCategories.push("technical");

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

  // Build FroggyEnrichedView
  const enriched: FroggyEnrichedView = {
    signalId: validatedInput.signalId,
    symbol: validatedInput.meta.symbol,
    market: validatedInput.meta.market,
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

  return enriched;
}

export default {
  run,
  inputSchema,
};

