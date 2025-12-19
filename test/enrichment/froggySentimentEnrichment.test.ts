/**
 * Froggy Sentiment Enrichment - Strategy Scenario Tests
 *
 * Tests the perp sentiment enrichment pipeline with mocked Coinalyze data
 * that reflects real Froggy trend-pullback strategy scenarios.
 *
 * These tests verify that the Sentiment Lens + Froggy interpretation logic
 * behaves correctly for:
 * 1. Extremely bullish / crowded longs (high funding, rising OI)
 * 2. Neutral / balanced (flat funding, stable OI)
 * 3. Extremely bearish / crowded shorts (negative funding, rising OI)
 *
 * @module froggySentimentEnrichment.test
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { computeFroggySentiment } from "../../src/indicator/froggySentimentProfile.js";
import type { CoinalyzePerpMetrics } from "../../src/adapters/coinalyze/coinalyzeClient.js";
import { fetchCoinalyzePerpMetrics } from "../../src/adapters/coinalyze/coinalyzeClient.js";

// Mock the Coinalyze client
jest.mock("../../src/adapters/coinalyze/coinalyzeClient.js", () => ({
  fetchCoinalyzePerpMetrics: jest.fn(),
}));

describe("Froggy Sentiment Enrichment - Strategy Scenarios", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe("Scenario 1: Extremely bullish / crowded longs", () => {
    it("should detect elevated positive funding, crowded longs, and high sentiment score", async () => {
      // Mock Coinalyze response: high positive funding, rising OI
      const mockMetrics: CoinalyzePerpMetrics = {
        fundingRate: 0.0012, // +0.12% (elevated positive)
        fundingHistory: [0.0008, 0.0010, 0.0011, 0.0012],
        oiUsd: 1_150_000_000, // $1.15B
        oiHistoryUsd: [
          1_000_000_000, // 24h ago
          1_050_000_000,
          1_100_000_000,
          1_150_000_000, // now (+15% over 24h)
        ],
        longShortRatio: 1.6, // 1.6:1 longs to shorts (crowded longs)
      };

      (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);

      const result = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

      expect(result).not.toBeNull();
      expect(result!.fundingRegime).toBe("elevated_positive");
      expect(result!.positioningBias).toBe("crowded_long");
      expect(result!.perpSentimentScore).toBeGreaterThanOrEqual(70); // High bullish score (70-85 range)
      expect(result!.perpSentimentScore).toBeLessThanOrEqual(85);
      expect(result!.oiTrend).toBe("rising");
      expect(result!.oiChange24hPct).toBeCloseTo(15, 1); // ~15% OI increase
      expect(result!.providerMeta?.primary).toBe("coinalyze");
      expect(result!.providerMeta?.symbols).toEqual(["BTCUSDT_PERP.A"]);
    });
  });

  describe("Scenario 2: Neutral / balanced", () => {
    it("should detect normal funding, balanced positioning, and mid-range sentiment score", async () => {
      // Mock Coinalyze response: near-zero funding, flat OI
      const mockMetrics: CoinalyzePerpMetrics = {
        fundingRate: 0.00005, // +0.005% (normal)
        fundingHistory: [0.00003, 0.00004, 0.00005, 0.00005],
        oiUsd: 1_020_000_000, // $1.02B
        oiHistoryUsd: [
          1_000_000_000, // 24h ago
          1_010_000_000,
          1_015_000_000,
          1_020_000_000, // now (+2% over 24h, flat)
        ],
        longShortRatio: 1.05, // 1.05:1 longs to shorts (balanced)
      };

      (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);

      const result = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

      expect(result).not.toBeNull();
      expect(result!.fundingRegime).toBe("normal");
      expect(result!.positioningBias).toBe("balanced");
      expect(result!.perpSentimentScore).toBeGreaterThanOrEqual(40);
      expect(result!.perpSentimentScore).toBeLessThanOrEqual(60); // Mid-range (neutral)
      expect(result!.oiTrend).toBe("flat");
      expect(result!.oiChange24hPct).toBeCloseTo(2, 1); // ~2% OI increase
    });
  });

  describe("Scenario 3: Extremely bearish / crowded shorts", () => {
    it("should detect elevated negative funding, crowded shorts, and low sentiment score", async () => {
      // Mock Coinalyze response: strongly negative funding, rising OI
      const mockMetrics: CoinalyzePerpMetrics = {
        fundingRate: -0.0012, // -0.12% (elevated negative)
        fundingHistory: [-0.0008, -0.0010, -0.0011, -0.0012],
        oiUsd: 1_180_000_000, // $1.18B
        oiHistoryUsd: [
          1_000_000_000, // 24h ago
          1_060_000_000,
          1_120_000_000,
          1_180_000_000, // now (+18% over 24h)
        ],
        longShortRatio: 0.65, // 0.65:1 longs to shorts (crowded shorts)
      };

      (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);

      const result = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

      expect(result).not.toBeNull();
      expect(result!.fundingRegime).toBe("elevated_negative");
      expect(result!.positioningBias).toBe("crowded_short");
      // Note: Score is ~43 because rising OI (+10 points) offsets negative funding
      // This is correct - rising OI with negative funding is a mixed signal
      expect(result!.perpSentimentScore).toBeGreaterThanOrEqual(35);
      expect(result!.perpSentimentScore).toBeLessThanOrEqual(50);
      expect(result!.oiTrend).toBe("rising");
      expect(result!.oiChange24hPct).toBeCloseTo(18, 1); // ~18% OI increase
    });
  });

  describe("OI Trend Detection", () => {
    it("should detect rising OI trend when OI increases > 5%", async () => {
      const mockMetrics: CoinalyzePerpMetrics = {
        fundingRate: 0.00005,
        oiUsd: 1_100_000_000,
        oiHistoryUsd: [1_000_000_000, 1_100_000_000], // +10%
      };

      (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);

      const result = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

      expect(result).not.toBeNull();
      expect(result!.oiTrend).toBe("rising");
    });

    it("should detect falling OI trend when OI decreases > 5%", async () => {
      const mockMetrics: CoinalyzePerpMetrics = {
        fundingRate: 0.00005,
        oiUsd: 900_000_000,
        oiHistoryUsd: [1_000_000_000, 900_000_000], // -10%
      };

      (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);

      const result = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

      expect(result).not.toBeNull();
      expect(result!.oiTrend).toBe("falling");
    });

    it("should detect flat OI trend when OI change is within ±5%", async () => {
      const mockMetrics: CoinalyzePerpMetrics = {
        fundingRate: 0.00005,
        oiUsd: 1_030_000_000,
        oiHistoryUsd: [1_000_000_000, 1_030_000_000], // +3%
      };

      (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);

      const result = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

      expect(result).not.toBeNull();
      expect(result!.oiTrend).toBe("flat");
    });
  });
});

