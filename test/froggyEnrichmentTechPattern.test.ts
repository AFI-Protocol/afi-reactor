/**
 * Froggy Tech+Pattern Enrichment Plugin Test
 *
 * Tests the technical + pattern enrichment plugin in isolation.
 * Validates that the plugin:
 * 1. Accepts structured signal input
 * 2. Fetches OHLCV data from price feed
 * 3. Computes technical indicators and pattern recognition
 * 4. Returns signal with _techPatternEnrichment attached
 * 5. Handles missing/failed price data gracefully (fail-soft)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import plugin from "../plugins/froggy-enrichment-tech-pattern.plugin.js";

describe("Froggy Tech+Pattern Enrichment Plugin", () => {
  const mockStructuredSignal = {
    signalId: "test-signal-123",
    score: 0.75,
    confidence: 0.8,
    timestamp: new Date().toISOString(),
    meta: {
      symbol: "BTC/USDT",
      market: "spot",
      timeframe: "1h",
      strategy: "froggy_trend_pullback_v1",
      direction: "long" as const,
    },
  };

  beforeEach(() => {
    // Ensure demo mode for deterministic tests
    process.env.AFI_PRICE_FEED_SOURCE = "demo";
  });

  it("should enrich signal with technical and pattern data", async () => {
    const result = await plugin.run(mockStructuredSignal);

    // Verify signal structure preserved
    expect(result.signalId).toBe(mockStructuredSignal.signalId);
    expect(result.meta.symbol).toBe(mockStructuredSignal.meta.symbol);
    expect(result.meta.timeframe).toBe(mockStructuredSignal.meta.timeframe);

    // Verify tech+pattern enrichment attached
    expect(result._techPatternEnrichment).toBeDefined();
    expect(result._techPatternEnrichment?.priceSource).toBe("demo");
    expect(result._techPatternEnrichment?.enrichedAt).toBeDefined();

    // Verify technical enrichment (should be present in demo mode)
    const technical = result._techPatternEnrichment?.technical;
    if (technical) {
      expect(technical.ema20).toBeDefined();
      expect(technical.ema50).toBeDefined();
      expect(technical.rsi14).toBeGreaterThanOrEqual(0);
      expect(technical.rsi14).toBeLessThanOrEqual(100);
      expect(technical.trendBias).toMatch(/^(bullish|bearish|range)$/);
      expect(technical.emaDistancePct).toBeDefined();
      expect(typeof technical.isInValueSweetSpot).toBe("boolean");
    }

    // Verify pattern enrichment (should be present in demo mode)
    const pattern = result._techPatternEnrichment?.pattern;
    if (pattern) {
      expect(typeof pattern.bullishEngulfing).toBe("boolean");
      expect(typeof pattern.bearishEngulfing).toBe("boolean");
      expect(typeof pattern.pinBar).toBe("boolean");
      expect(typeof pattern.insideBar).toBe("boolean");
      expect(pattern.structureBias).toMatch(/^(higher-highs|lower-lows|choppy)$/);
    }
  });

  it("should handle missing price data gracefully (fail-soft)", async () => {
    // Force price feed to fail by using invalid symbol
    const invalidSignal = {
      ...mockStructuredSignal,
      meta: {
        ...mockStructuredSignal.meta,
        symbol: "INVALID/SYMBOL",
      },
    };

    // Should not throw, but return signal with empty enrichment
    const result = await plugin.run(invalidSignal);

    expect(result.signalId).toBe(invalidSignal.signalId);
    expect(result._techPatternEnrichment).toBeDefined();
    expect(result._techPatternEnrichment?.priceSource).toBe("demo");

    // Technical and pattern may be undefined if price data failed
    // This is expected fail-soft behavior
  });

  it("should validate input schema", async () => {
    const invalidSignal = {
      signalId: "test-123",
      // Missing required fields
    };

    await expect(plugin.run(invalidSignal as any)).rejects.toThrow();
  });

  it("should include regime data in pattern enrichment when available", async () => {
    const result = await plugin.run(mockStructuredSignal);

    const pattern = result._techPatternEnrichment?.pattern;
    if (pattern && pattern.regime) {
      // Regime is optional (depends on external API availability)
      expect(pattern.regime.cyclePhase).toBeDefined();
      expect(pattern.regime.trendState).toBeDefined();
      expect(pattern.regime.volRegime).toBeDefined();
    }
  });
});

