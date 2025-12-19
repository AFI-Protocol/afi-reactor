/**
 * Enrichment Profile Presets
 * 
 * Pre-defined enrichment profiles for common use cases and demo scenarios.
 * These profiles configure which enrichment categories are enabled for signal processing.
 * 
 * @module enrichmentProfiles
 */

import type { EnrichmentProfile } from "afi-core/analysts/froggy.enrichment_adapter.js";

/**
 * FROGGY_MAX_ENRICHMENT_PROFILE
 * 
 * Maximum enrichment profile for Froggy's trend-pullback strategy.
 * Enables all currently wired enrichment categories except aiMl (reserved lane).
 * 
 * Use this profile for:
 * - Full-featured demos showing all enrichment capabilities
 * - Testing complete enrichment pipeline
 * - Showcasing newsFeatures, sentiment, pattern, and technical analysis together
 * 
 * Categories:
 * - technical: ✅ Enabled - EMA, RSI, ATR, volume analysis
 * - pattern: ✅ Enabled - Chart patterns, regime detection, Fear & Greed
 * - sentiment: ✅ Enabled - Funding rates, OI, positioning bias
 * - news: ✅ Enabled - News headlines, shock detection, newsFeatures
 * - aiMl: ❌ Disabled - Reserved for future ML ensemble models
 * 
 * @example
 * ```typescript
 * // Use in test endpoint
 * const signal = {
 *   signalId: "demo-001",
 *   symbol: "BTCUSDT",
 *   timeframe: "1h",
 *   useMaxEnrichment: true  // Uses FROGGY_MAX_ENRICHMENT_PROFILE
 * };
 * ```
 */
export const FROGGY_MAX_ENRICHMENT_PROFILE: EnrichmentProfile = {
  technical: { enabled: true },
  pattern: { enabled: true },
  sentiment: { enabled: true },
  news: { enabled: true },
  aiMl: { enabled: false },  // Reserved lane - not yet wired
};

/**
 * Default enrichment profile (all categories enabled).
 * Used when no profile is specified.
 */
export const DEFAULT_ENRICHMENT_PROFILE: EnrichmentProfile = {
  technical: { enabled: true, preset: "default" },
  pattern: { enabled: true, preset: "default" },
  sentiment: { enabled: true, preset: "default" },
  news: { enabled: true, preset: "default" },
  aiMl: { enabled: true, preset: "default" },
};

/**
 * TA-only profile (technical analysis only, no sentiment/news/aiMl).
 * Useful for pure price-action strategies.
 */
export const TA_ONLY_PROFILE: EnrichmentProfile = {
  technical: { enabled: true, preset: "full_suite" },
  pattern: { enabled: true, preset: "reversal_patterns" },
  sentiment: { enabled: false },
  news: { enabled: false },
  aiMl: { enabled: false },
};

