/**
 * Test: Froggy News Enrichment Integration
 *
 * Verifies:
 * 1. News data is correctly integrated into Froggy enrichment
 * 2. News appears in both USS lens and top-level news object
 * 3. Fail-soft behavior when provider is disabled or fails
 * 4. Environment variable configuration (NEWS_PROVIDER, NEWSDATA_API_KEY)
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { NewsShockSummary, NewsProvider } from "../../src/news/newsProvider.js";

// Mock the NewsData provider
jest.mock("../../src/news/newsdataNewsProvider.js", () => ({
  createNewsDataProvider: jest.fn(),
}));

import { createNewsDataProvider } from "../../src/news/newsdataNewsProvider.js";
import froggyEnrichmentPlugin from "../../plugins/froggy-enrichment-adapter.plugin.js";

const mockCreateNewsDataProvider = createNewsDataProvider as jest.MockedFunction<typeof createNewsDataProvider>;

describe("Froggy News Enrichment", () => {
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

  it("should include news data in both lens and top-level object", async () => {
    // Set up environment
    process.env.NEWS_PROVIDER = "newsdata";
    process.env.NEWSDATA_API_KEY = "test-key";

    // Mock provider
    const mockNewsSummary: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "unknown",
      headlines: [
        {
          id: "news-1",
          title: "Bitcoin Surges Past $100K",
          source: "CoinDesk",
          url: "https://example.com/news-1",
          publishedAt: new Date().toISOString(),
        },
        {
          id: "news-2",
          title: "SEC Approves Bitcoin ETF",
          source: "Bloomberg",
          url: "https://example.com/news-2",
          publishedAt: new Date().toISOString(),
        },
      ],
    };

    const mockFetchRecentNews = jest.fn<() => Promise<NewsShockSummary | null>>();
    mockFetchRecentNews.mockResolvedValue(mockNewsSummary);

    const mockProvider = {
      apiKey: "test-key",
      baseUrl: "https://newsdata.io/api/1/crypto",
      fetchRecentNews: mockFetchRecentNews,
    } as any;

    mockCreateNewsDataProvider.mockReturnValue(mockProvider);

    // Minimal input signal
    const inputSignal = {
      signalId: "test-news-001",
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
          technical: { enabled: false },
          pattern: { enabled: false },
          sentiment: { enabled: false },
          news: { enabled: true },
          aiMl: { enabled: false },
        },
      },
    };

    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify top-level news object
    expect(result.news).toBeDefined();
    expect(result.news?.hasShockEvent).toBe(true);
    expect(result.news?.shockDirection).toBe("unknown");
    expect(result.news?.headlines).toHaveLength(2);
    expect(result.news?.headlines?.[0]).toBe("Bitcoin Surges Past $100K");

    // Verify USS news lens
    const lenses = (result as any).lenses;
    expect(lenses).toBeDefined();
    const newsLens = lenses.find((lens: any) => lens.type === "news");
    expect(newsLens).toBeDefined();
    expect(newsLens.version).toBe("v1");
    expect(newsLens.payload.hasShockEvent).toBe(true);
    expect(newsLens.payload.shockDirection).toBe("unknown");
    expect(newsLens.payload.headlines).toHaveLength(2);
    expect(newsLens.payload.headlines[0]).toBe("Bitcoin Surges Past $100K");
  });

  it("should fall back to default when NEWS_PROVIDER is not set", async () => {
    // No NEWS_PROVIDER set
    delete process.env.NEWS_PROVIDER;

    const inputSignal = {
      signalId: "test-news-002",
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
          technical: { enabled: false },
          pattern: { enabled: false },
          sentiment: { enabled: false },
          news: { enabled: true },
          aiMl: { enabled: false },
        },
      },
    };

    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify default news (no shock event)
    expect(result.news).toBeDefined();
    expect(result.news?.hasShockEvent).toBe(false);
    expect(result.news?.shockDirection).toBe("none");
    expect(result.news?.headlines).toHaveLength(0);

    // Verify USS news lens has default values
    const lenses = (result as any).lenses;
    const newsLens = lenses.find((lens: any) => lens.type === "news");
    expect(newsLens.payload.hasShockEvent).toBe(false);
    expect(newsLens.payload.shockDirection).toBe("none");
    expect(newsLens.payload.headlines).toHaveLength(0);
  });

  it("should fall back to default when provider returns null", async () => {
    process.env.NEWS_PROVIDER = "newsdata";
    process.env.NEWSDATA_API_KEY = "test-key";

    // Mock provider that returns null (simulating API error)
    const mockFetchRecentNews = jest.fn<() => Promise<NewsShockSummary | null>>();
    mockFetchRecentNews.mockResolvedValue(null);

    const mockProvider = {
      apiKey: "test-key",
      baseUrl: "https://newsdata.io/api/1/crypto",
      fetchRecentNews: mockFetchRecentNews,
    } as any;

    mockCreateNewsDataProvider.mockReturnValue(mockProvider);

    const inputSignal = {
      signalId: "test-news-003",
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
          technical: { enabled: false },
          pattern: { enabled: false },
          sentiment: { enabled: false },
          news: { enabled: true },
          aiMl: { enabled: false },
        },
      },
    };

    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify fallback to default
    expect(result.news?.hasShockEvent).toBe(false);
    expect(result.news?.shockDirection).toBe("none");
    expect(result.news?.headlines).toHaveLength(0);
  });

  it("should fall back to default when provider throws error", async () => {
    process.env.NEWS_PROVIDER = "newsdata";
    process.env.NEWSDATA_API_KEY = "test-key";

    // Mock provider that throws error
    const mockFetchRecentNews = jest.fn<() => Promise<NewsShockSummary | null>>();
    mockFetchRecentNews.mockRejectedValue(new Error("Network timeout"));

    const mockProvider = {
      apiKey: "test-key",
      baseUrl: "https://newsdata.io/api/1/crypto",
      fetchRecentNews: mockFetchRecentNews,
    } as any;

    mockCreateNewsDataProvider.mockReturnValue(mockProvider);

    const inputSignal = {
      signalId: "test-news-004",
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
          technical: { enabled: false },
          pattern: { enabled: false },
          sentiment: { enabled: false },
          news: { enabled: true },
          aiMl: { enabled: false },
        },
      },
    };

    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify fallback to default (enrichment should not crash)
    expect(result.news?.hasShockEvent).toBe(false);
    expect(result.news?.shockDirection).toBe("none");
    expect(result.news?.headlines).toHaveLength(0);
  });
});

