/**
 * Integration tests for /test/enrichment HTTP endpoint
 *
 * Tests the enrichment endpoint with both minimal and full payloads,
 * validating that technical and sentiment lenses are properly generated.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import testEndpoints from "../src/routes/testEndpoints.js";
import type { CoinalyzePerpMetrics } from "../src/adapters/coinalyze/coinalyzeClient.js";
import { fetchCoinalyzePerpMetrics } from "../src/adapters/coinalyze/coinalyzeClient.js";

// Mock Coinalyze client to avoid real API calls in tests
jest.mock("../src/adapters/coinalyze/coinalyzeClient.js", () => ({
  fetchCoinalyzePerpMetrics: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use("/test", testEndpoints);

describe("POST /test/enrichment", () => {
  beforeEach(() => {
    // Ensure we use demo price feed in tests
    process.env.AFI_PRICE_FEED_SOURCE = "demo";

    // Clear all mocks before each test
    jest.clearAllMocks();

    // Set up default mock response for Coinalyze
    const mockMetrics: CoinalyzePerpMetrics = {
      fundingRate: 0.0005, // 0.05% - normal regime
      fundingHistory: [0.0004, 0.0005, 0.0006],
      oiUsd: 1000000000,
      oiHistoryUsd: [980000000, 990000000, 1000000000], // +2% change
      longShortRatio: 1.05,
    };

    (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);
  });

  it("should accept minimal payload and return enriched signal with technical and sentiment lenses", async () => {
    const response = await request(app)
      .post("/test/enrichment")
      .send({
        signalId: "froggy-sentiment-smoke-001",
        symbol: "BTCUSDT",
        timeframe: "1h",
      })
      .expect(200);

    const result = response.body;

    // Verify response structure
    expect(result.stage).toBe("enrichment");
    expect(result.input).toBeDefined();
    expect(result.output).toBeDefined();
    expect(result.timestamp).toBeDefined();

    // Verify input was auto-structured
    expect(result.input.signalId).toBe("froggy-sentiment-smoke-001");
    expect(result.input.meta.symbol).toBe("BTCUSDT");
    expect(result.input.meta.timeframe).toBe("1h");
    expect(result.input.score).toBeDefined();
    expect(result.input.confidence).toBeDefined();
    expect(result.input.timestamp).toBeDefined();

    // Verify enriched output
    const enriched = result.output;
    expect(enriched.signalId).toBe("froggy-sentiment-smoke-001");
    expect(enriched.symbol).toBe("BTCUSDT");
    expect(enriched.timeframe).toBe("1h");

    // Verify enrichment metadata
    expect(enriched.enrichmentMeta).toBeDefined();
    expect(enriched.enrichmentMeta.categories).toContain("technical");
    expect(enriched.enrichmentMeta.categories).toContain("sentiment");
    expect(enriched.enrichmentMeta.enrichedBy).toBe("froggy-enrichment-adapter");

    // Verify technical enrichment (legacy format)
    expect(enriched.technical).toBeDefined();
    expect(enriched.technical.indicators).toBeDefined();
    expect(enriched.technical.indicators.rsi).toBeDefined();
    expect(enriched.technical.indicators.ema_20).toBeDefined();
    expect(enriched.technical.indicators.ema_50).toBeDefined();

    // Verify sentiment enrichment (legacy format)
    expect(enriched.sentiment).toBeDefined();
    expect(enriched.sentiment.score).toBeDefined();
    expect(enriched.sentiment.tags).toBeDefined();

    // Verify USS lenses
    expect(enriched.lenses).toBeDefined();
    expect(Array.isArray(enriched.lenses)).toBe(true);

    // Find technical lens
    const technicalLens = enriched.lenses.find((l: any) => l.type === "technical");
    expect(technicalLens).toBeDefined();
    expect(technicalLens.version).toBe("v1");
    expect(technicalLens.payload).toBeDefined();
    expect(technicalLens.payload.rsi14).toBeDefined();
    expect(technicalLens.payload.ema20).toBeDefined();
    expect(technicalLens.payload.ema50).toBeDefined();
    expect(technicalLens.payload.trendBias).toBeDefined();

    // Find sentiment lens
    const sentimentLens = enriched.lenses.find((l: any) => l.type === "sentiment");
    expect(sentimentLens).toBeDefined();
    expect(sentimentLens.version).toBe("v1");
    expect(sentimentLens.payload).toBeDefined();
    expect(sentimentLens.payload.perpSentimentScore).toBeDefined();
    expect(sentimentLens.payload.fundingRegime).toBeDefined();
    expect(sentimentLens.payload.positioningBias).toBeDefined();
    expect(sentimentLens.payload.oiTrend).toBeDefined();
    expect(sentimentLens.payload.providerMeta).toBeDefined();
    expect(sentimentLens.payload.providerMeta.primary).toBe("coinalyze");
  });

  it("should accept full structured signal payload", async () => {
    const response = await request(app)
      .post("/test/enrichment")
      .send({
        signalId: "test-002",
        score: 0.7,
        confidence: 0.8,
        timestamp: "2025-12-10T12:00:00Z",
        meta: {
          symbol: "ETHUSDT",
          market: "perp",
          timeframe: "4h",
          strategy: "froggy_trend_pullback_v1",
          direction: "long",
          source: "test",
        },
      })
      .expect(200);

    const result = response.body;
    expect(result.output.signalId).toBe("test-002");
    expect(result.output.symbol).toBe("ETHUSDT");
    expect(result.output.timeframe).toBe("4h");
  });

  it("should return 400 if signalId is missing", async () => {
    const response = await request(app)
      .post("/test/enrichment")
      .send({
        symbol: "BTCUSDT",
        timeframe: "1h",
      })
      .expect(400);

    expect(response.body.error).toBe("Missing signalId");
  });

  it("should use FROGGY_MAX_ENRICHMENT_PROFILE when useMaxEnrichment is true", async () => {
    const response = await request(app)
      .post("/test/enrichment")
      .send({
        signalId: "froggy-max-001",
        symbol: "BTCUSDT",
        timeframe: "1h",
        useMaxEnrichment: true,
      })
      .expect(200);

    const result = response.body;

    // Verify enrichment profile was applied
    expect(result.input.meta.enrichmentProfile).toBeDefined();
    expect(result.input.meta.enrichmentProfile.technical).toEqual({ enabled: true });
    expect(result.input.meta.enrichmentProfile.pattern).toEqual({ enabled: true });
    expect(result.input.meta.enrichmentProfile.sentiment).toEqual({ enabled: true });
    expect(result.input.meta.enrichmentProfile.news).toEqual({ enabled: true });
    expect(result.input.meta.enrichmentProfile.aiMl).toEqual({ enabled: false });

    // Verify enriched output has expected categories
    const enriched = result.output;
    expect(enriched.enrichmentMeta.categories).toContain("technical");
    expect(enriched.enrichmentMeta.categories).toContain("pattern");
    expect(enriched.enrichmentMeta.categories).toContain("sentiment");

    // News category is included if NEWS_PROVIDER is set, otherwise skipped
    // This is expected behavior - news enrichment requires NEWS_PROVIDER env var
    if (process.env.NEWS_PROVIDER && process.env.NEWS_PROVIDER !== "none") {
      expect(enriched.enrichmentMeta.categories).toContain("news");
      expect(enriched.news).toBeDefined();
      expect(enriched.newsFeatures).toBeDefined();
    }

    // aiMl is explicitly disabled in FROGGY_MAX_ENRICHMENT_PROFILE
    expect(enriched.enrichmentMeta.categories).not.toContain("aiMl");

    // Verify technical enrichment is present
    expect(enriched.technical).toBeDefined();
    expect(enriched.technical.indicators).toBeDefined();

    // Verify pattern enrichment is present
    expect(enriched.pattern).toBeDefined();

    // Verify sentiment enrichment is present
    expect(enriched.sentiment).toBeDefined();
  });

  it("should prioritize explicit enrichmentProfile over useMaxEnrichment flag", async () => {
    // Custom profile that disables all categories
    const customProfile = {
      technical: { enabled: false },
      pattern: { enabled: false },
      sentiment: { enabled: false },
      news: { enabled: false },
      aiMl: { enabled: false },
    };

    const response = await request(app)
      .post("/test/enrichment")
      .send({
        signalId: "froggy-custom-001",
        symbol: "BTCUSDT",
        timeframe: "1h",
        useMaxEnrichment: true,  // This should be ignored
        enrichmentProfile: customProfile,
      })
      .expect(200);

    const result = response.body;

    // Verify custom profile was used (not FROGGY_MAX_ENRICHMENT_PROFILE)
    expect(result.input.meta.enrichmentProfile).toEqual(customProfile);

    // Verify enriched output has NO categories (all disabled)
    const enriched = result.output;
    expect(enriched.enrichmentMeta.categories).toHaveLength(0);
    expect(enriched.technical).toBeUndefined();
    expect(enriched.pattern).toBeUndefined();
    expect(enriched.sentiment).toBeUndefined();
    expect(enriched.news).toBeUndefined();
    expect(enriched.newsFeatures).toBeUndefined();
  });

  it("should use default profile when neither enrichmentProfile nor useMaxEnrichment is provided", async () => {
    const response = await request(app)
      .post("/test/enrichment")
      .send({
        signalId: "froggy-default-001",
        symbol: "BTCUSDT",
        timeframe: "1h",
        // No enrichmentProfile, no useMaxEnrichment
      })
      .expect(200);

    const result = response.body;

    // Verify no enrichment profile was set in input (falls back to default in adapter)
    expect(result.input.meta.enrichmentProfile).toBeUndefined();

    // Verify enriched output has all categories (default profile enables all)
    const enriched = result.output;
    expect(enriched.enrichmentMeta.categories).toContain("technical");
    expect(enriched.enrichmentMeta.categories).toContain("pattern");
    expect(enriched.enrichmentMeta.categories).toContain("sentiment");
    expect(enriched.enrichmentMeta.categories).toContain("news");
    expect(enriched.enrichmentMeta.categories).toContain("aiMl");
  });
});

