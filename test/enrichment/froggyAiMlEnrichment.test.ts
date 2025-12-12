/**
 * Test: Froggy AI/ML Enrichment Integration (Tiny Brains)
 *
 * Verifies:
 * 1. AI/ML data is correctly integrated into Froggy enrichment when enabled
 * 2. Enrichment succeeds without aiMl when category is disabled
 * 3. Fail-soft behavior when Tiny Brains service is unavailable
 * 4. Environment variable configuration (TINY_BRAINS_URL)
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { TinyBrainsAiMl } from "../../src/aiMl/tinyBrainsClient.js";

// Mock the Tiny Brains client
jest.mock("../../src/aiMl/tinyBrainsClient.js", () => ({
  fetchAiMlForFroggy: jest.fn(),
}));

import { fetchAiMlForFroggy } from "../../src/aiMl/tinyBrainsClient.js";
import froggyEnrichmentPlugin from "../../plugins/froggy-enrichment-adapter.plugin.js";

const mockFetchAiMlForFroggy = fetchAiMlForFroggy as jest.MockedFunction<typeof fetchAiMlForFroggy>;

describe("Froggy AI/ML Enrichment (Tiny Brains)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("should skip AI/ML enrichment when category is disabled", async () => {
    // Set up environment (service available but category disabled)
    process.env.TINY_BRAINS_URL = "http://localhost:8090";

    // Minimal input signal with aiMl disabled
    const input = {
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
        enrichmentProfile: {
          technical: { enabled: true },
          pattern: { enabled: true },
          sentiment: { enabled: false },
          news: { enabled: false },
          aiMl: { enabled: false }, // Disabled
        },
      },
      payload: {},
    };

    const enriched = await froggyEnrichmentPlugin.run(input);

    // Verify enrichment succeeded
    expect(enriched).toBeDefined();
    expect(enriched.signalId).toBe("test-signal-001");

    // Verify aiMl is undefined (category disabled)
    expect(enriched.aiMl).toBeUndefined();

    // Verify enrichmentMeta does not include "aiMl"
    expect(enriched.enrichmentMeta?.categories).not.toContain("aiMl");

    // Verify Tiny Brains client was NOT called
    expect(mockFetchAiMlForFroggy).not.toHaveBeenCalled();
  });

  it("should include AI/ML data when category is enabled and service returns prediction", async () => {
    // Set up environment
    process.env.TINY_BRAINS_URL = "http://localhost:8090";

    // Mock Tiny Brains response
    const mockAiMlPrediction: TinyBrainsAiMl = {
      convictionScore: 0.85,
      direction: "long",
      regime: "bull",
      riskFlag: false,
      notes: "Strong uptrend detected by ensemble model",
    };

    mockFetchAiMlForFroggy.mockResolvedValue(mockAiMlPrediction);

    // Minimal input signal with aiMl enabled
    const input = {
      signalId: "test-signal-002",
      score: 0.75,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "BTCUSDT",
        market: "spot",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "long" as const,
        enrichmentProfile: {
          technical: { enabled: true },
          pattern: { enabled: true },
          sentiment: { enabled: false },
          news: { enabled: false },
          aiMl: { enabled: true }, // Enabled
        },
      },
      payload: {},
    };

    const enriched = await froggyEnrichmentPlugin.run(input);

    // Verify enrichment succeeded
    expect(enriched).toBeDefined();
    expect(enriched.signalId).toBe("test-signal-002");

    // Verify aiMl is populated with Tiny Brains prediction
    expect(enriched.aiMl).toBeDefined();
    expect(enriched.aiMl?.convictionScore).toBe(0.85);
    expect(enriched.aiMl?.direction).toBe("long");
    expect(enriched.aiMl?.regime).toBe("bull");
    expect(enriched.aiMl?.riskFlag).toBe(false);
    expect(enriched.aiMl?.notes).toBe("Strong uptrend detected by ensemble model");

    // Verify enrichmentMeta includes "aiMl"
    expect(enriched.enrichmentMeta?.categories).toContain("aiMl");

    // Verify Tiny Brains client was called with correct input
    expect(mockFetchAiMlForFroggy).toHaveBeenCalledTimes(1);
    const callArgs = mockFetchAiMlForFroggy.mock.calls[0][0];
    expect(callArgs.signalId).toBe("test-signal-002");
    expect(callArgs.symbol).toBe("BTCUSDT");
    expect(callArgs.timeframe).toBe("1h");
  });

  it("should succeed without aiMl when Tiny Brains service is unavailable", async () => {
    // Set up environment (service URL set but returns undefined - simulating unavailable service)
    process.env.TINY_BRAINS_URL = "http://localhost:8090";

    // Mock Tiny Brains client to return undefined (service unavailable)
    mockFetchAiMlForFroggy.mockResolvedValue(undefined);

    // Minimal input signal with aiMl enabled
    const input = {
      signalId: "test-signal-003",
      score: 0.75,
      confidence: 0.8,
      timestamp: new Date().toISOString(),
      meta: {
        symbol: "BTCUSDT",
        market: "spot",
        timeframe: "1h",
        strategy: "trend_pullback_v1",
        direction: "long" as const,
        enrichmentProfile: {
          technical: { enabled: true },
          pattern: { enabled: true },
          sentiment: { enabled: false },
          news: { enabled: false },
          aiMl: { enabled: true }, // Enabled but service unavailable
        },
      },
      payload: {},
    };

    const enriched = await froggyEnrichmentPlugin.run(input);

    // Verify enrichment succeeded (fail-soft)
    expect(enriched).toBeDefined();
    expect(enriched.signalId).toBe("test-signal-003");

    // Verify aiMl is undefined (service unavailable)
    expect(enriched.aiMl).toBeUndefined();

    // Verify enrichmentMeta does NOT include "aiMl" (no data received)
    expect(enriched.enrichmentMeta?.categories).not.toContain("aiMl");

    // Verify Tiny Brains client was called (but returned undefined)
    expect(mockFetchAiMlForFroggy).toHaveBeenCalledTimes(1);
  });
});

