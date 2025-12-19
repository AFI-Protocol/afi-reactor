/**
 * Test: Pattern Regime Mirroring
 *
 * Verifies that regime data is correctly mirrored to both:
 * 1. The pattern lens payload (.lenses[] | select(.type=="pattern") | .payload.regime)
 * 2. The top-level pattern object (.pattern.regime)
 *
 * This ensures backward compatibility and consistent access patterns.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { PatternRegimeSummary } from "../../src/types/UssLenses.js";

// Mock computePatternRegimeSummary
jest.mock("../../src/indicator/patternRegimeProfile.js", () => ({
  computePatternRegimeSummary: jest.fn(),
}));

import { computePatternRegimeSummary } from "../../src/indicator/patternRegimeProfile.js";
import froggyEnrichmentPlugin from "../../plugins/froggy-enrichment-adapter.plugin.js";

const mockComputePatternRegimeSummary = computePatternRegimeSummary as jest.MockedFunction<typeof computePatternRegimeSummary>;

describe("Pattern Regime Mirroring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should mirror regime to both lens payload and top-level pattern object", async () => {
    // Mock regime data
    const mockRegime: PatternRegimeSummary = {
      cyclePhase: "late_bull",
      trendState: "uptrend",
      volRegime: "high",
      topBottomRisk: "top_risk",
      externalLabels: {
        fearGreedValue: 85,
        fearGreedLabel: "extreme_greed",
        notes: "FG=85 (extreme_greed). Price at 92% of 90d range.",
      },
    };

    mockComputePatternRegimeSummary.mockResolvedValue(mockRegime);

    // Minimal input signal
    const inputSignal = {
      signalId: "test-regime-mirror-001",
      score: 0.75,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "BTCUSDT",
        market: "perp",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "long" as const,
        enrichmentProfile: {
          technical: { enabled: false },
          pattern: { enabled: true },
          sentiment: { enabled: false },
          news: { enabled: false },
          aiMl: { enabled: false },
        },
      },
    };

    // Run enrichment
    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify regime computation was called
    expect(mockComputePatternRegimeSummary).toHaveBeenCalledWith("BTCUSDT", "1h");

    // Verify top-level pattern object includes regime
    expect(result.pattern).toBeDefined();
    expect(result.pattern?.regime).toEqual(mockRegime);

    // Verify lens payload includes regime
    const lenses = (result as any).lenses;
    expect(lenses).toBeDefined();
    const patternLens = lenses.find((lens: any) => lens.type === "pattern");
    expect(patternLens).toBeDefined();
    expect(patternLens.payload.regime).toEqual(mockRegime);

    // Verify both references point to the same data
    expect(result.pattern?.regime).toBe(patternLens.payload.regime);
  });

  it("should work without regime when computePatternRegimeSummary returns null", async () => {
    // Mock regime computation failure
    mockComputePatternRegimeSummary.mockResolvedValue(null);

    const inputSignal = {
      signalId: "test-no-regime-001",
      score: 0.75,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "BTCUSDT",
        market: "perp",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "long" as const,
        enrichmentProfile: {
          technical: { enabled: false },
          pattern: { enabled: true },
          sentiment: { enabled: false },
          news: { enabled: false },
          aiMl: { enabled: false },
        },
      },
    };

    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify enrichment completed
    expect(result.signalId).toBe("test-no-regime-001");

    // Pattern may or may not be defined depending on whether detectPatterns found any patterns
    // The key is that regime is undefined when computePatternRegimeSummary returns null
    if (result.pattern) {
      expect(result.pattern.regime).toBeUndefined();
    }

    // Verify lens payload also has no regime (if pattern lens exists)
    const lenses = (result as any).lenses;
    const patternLens = lenses?.find((lens: any) => lens.type === "pattern");
    if (patternLens) {
      expect(patternLens.payload.regime).toBeUndefined();
    }
  });

  it("should work without regime when computePatternRegimeSummary throws error", async () => {
    // Mock regime computation error
    mockComputePatternRegimeSummary.mockRejectedValue(new Error("CoinGecko API unavailable"));

    const inputSignal = {
      signalId: "test-regime-error-001",
      score: 0.75,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "BTCUSDT",
        market: "perp",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "long" as const,
        enrichmentProfile: {
          technical: { enabled: false },
          pattern: { enabled: true },
          sentiment: { enabled: false },
          news: { enabled: false },
          aiMl: { enabled: false },
        },
      },
    };

    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify pattern enrichment still works (fail-soft)
    // Pattern may or may not be defined depending on whether detectPatterns found any patterns
    // The key is that regime computation failure doesn't crash the enrichment
    if (result.pattern) {
      // If pattern exists, verify regime is undefined
      expect(result.pattern.regime).toBeUndefined();
    }

    // Verify lens payload also has no regime (if pattern lens exists)
    const lenses = (result as any).lenses;
    const patternLens = lenses?.find((lens: any) => lens.type === "pattern");
    if (patternLens) {
      expect(patternLens.payload.regime).toBeUndefined();
    }

    // The important assertion: enrichment completed without crashing
    expect(result.signalId).toBe("test-regime-error-001");
  });
});

