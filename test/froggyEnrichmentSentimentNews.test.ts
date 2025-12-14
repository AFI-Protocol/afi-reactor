/**
 * Test: Froggy Enrichment Sentiment+News Plugin
 *
 * Validates that the sentiment+news plugin:
 * - Computes sentiment and news enrichment
 * - Attaches enrichment to _sentimentNewsEnrichment field
 * - Handles fail-soft behavior when data is unavailable
 */

import { describe, it, expect } from "@jest/globals";
import froggyEnrichmentSentimentNews from "../plugins/froggy-enrichment-sentiment-news.plugin.js";

describe("Froggy Enrichment: Sentiment+News Plugin", () => {
  it("should compute sentiment+news enrichment for valid signal", async () => {
    const signal = {
      signalId: "test-signal-001",
      score: 0.75,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "BTCUSDT",
        market: "spot",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "long" as const,
      },
    };

    const result = await froggyEnrichmentSentimentNews.run(signal);

    // Verify enrichment field exists
    expect(result._sentimentNewsEnrichment).toBeDefined();

    const enrichment = result._sentimentNewsEnrichment;

    // Verify enrichment metadata
    expect(enrichment.enrichedAt).toBeDefined();
    expect(enrichment.sources).toBeDefined();
    expect(Array.isArray(enrichment.sources)).toBe(true);

    // Verify sentiment structure (may be undefined if Coinalyze unavailable)
    if (enrichment.sentiment) {
      expect(enrichment.sentiment.score).toBeGreaterThanOrEqual(0);
      expect(enrichment.sentiment.score).toBeLessThanOrEqual(1);
      expect(Array.isArray(enrichment.sentiment.tags)).toBe(true);
    }

    // Verify news structure (should always exist with fallback)
    expect(enrichment.news).toBeDefined();
    if (enrichment.news) {
      expect(typeof enrichment.news.hasShockEvent).toBe("boolean");
      expect(enrichment.news.shockDirection).toMatch(/bullish|bearish|neutral|none|unknown/);
      expect(Array.isArray(enrichment.news.headlines)).toBe(true);
    }

    // Verify original signal fields are preserved
    expect(result.signalId).toBe(signal.signalId);
    expect(result.meta.symbol).toBe(signal.meta.symbol);
  });

  it("should handle fail-soft behavior with invalid symbol", async () => {
    const signal = {
      signalId: "test-signal-002",
      score: 0.5,
      confidence: 0.6,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "INVALID_SYMBOL_XYZ",
        market: "spot",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "neutral" as const,
      },
    };

    // Should not throw
    const result = await froggyEnrichmentSentimentNews.run(signal);

    // Enrichment field should exist even if data is unavailable
    expect(result._sentimentNewsEnrichment).toBeDefined();

    const enrichment = result._sentimentNewsEnrichment;

    // Should have enrichedAt timestamp
    expect(enrichment.enrichedAt).toBeDefined();

    // News should exist (fallback to DEFAULT_NEWS_SUMMARY)
    expect(enrichment.news).toBeDefined();

    // Original signal should be preserved
    expect(result.signalId).toBe(signal.signalId);
  });

  it("should preserve tech-pattern enrichment from previous stage", async () => {
    const signal = {
      signalId: "test-signal-003",
      score: 0.7,
      confidence: 0.75,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "ETHUSDT",
        market: "spot",
        timeframe: "4h",
        strategy: "trend_pullback_v1",
        direction: "short" as const,
      },
      _techPatternEnrichment: {
        technical: {
          ema20: 2500,
          rsi14: 45,
        },
        pattern: {
          patternName: "bearish_engulfing",
        },
        priceSource: "binance",
        enrichedAt: new Date().toISOString(),
      },
    };

    const result = await froggyEnrichmentSentimentNews.run(signal);

    // Tech-pattern enrichment should be preserved
    expect(result._techPatternEnrichment).toBeDefined();
    expect(result._techPatternEnrichment?.technical?.ema20).toBe(2500);

    // Sentiment+news enrichment should be added
    expect(result._sentimentNewsEnrichment).toBeDefined();

    // Both enrichments should coexist
    expect(result._techPatternEnrichment).toBeDefined();
    expect(result._sentimentNewsEnrichment).toBeDefined();
  });

  it("should include sources array in enrichment", async () => {
    const signal = {
      signalId: "test-signal-004",
      score: 0.6,
      confidence: 0.7,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "BTCUSDT",
        market: "spot",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "long" as const,
      },
    };

    const result = await froggyEnrichmentSentimentNews.run(signal);

    const enrichment = result._sentimentNewsEnrichment;

    // Sources should be an array
    expect(Array.isArray(enrichment.sources)).toBe(true);

    // If sentiment was computed, sources should include "coinalyze"
    if (enrichment.sentiment) {
      expect(enrichment.sources).toContain("coinalyze");
    }
  });
});

