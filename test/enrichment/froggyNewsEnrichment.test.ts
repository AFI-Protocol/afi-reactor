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

    // Mock provider with new structure (headlines as strings, items as structured data)
    const mockNewsSummary: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "unknown",
      headlines: [
        "Bitcoin Surges Past $100K",
        "SEC Approves Bitcoin ETF",
      ],
      items: [
        {
          id: "news-1",
          title: "Bitcoin Surges Past $100K",
          source: "CoinDesk",
          url: "https://example.com/news-1",
          publishedAt: new Date(),
        },
        {
          id: "news-2",
          title: "SEC Approves Bitcoin ETF",
          source: "Bloomberg",
          url: "https://example.com/news-2",
          publishedAt: new Date(),
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

    // Verify legacy headlines array (strings only)
    expect(result.news?.headlines).toHaveLength(2);
    expect(result.news?.headlines?.[0]).toBe("Bitcoin Surges Past $100K");
    expect(result.news?.headlines?.[1]).toBe("SEC Approves Bitcoin ETF");

    // Verify structured items array
    expect(result.news?.items).toBeDefined();
    expect(result.news?.items).toHaveLength(2);
    expect(result.news?.items?.[0]).toMatchObject({
      title: "Bitcoin Surges Past $100K",
      source: "CoinDesk",
      url: "https://example.com/news-1",
    });

    // Verify USS news lens
    const lenses = (result as any).lenses;
    expect(lenses).toBeDefined();
    const newsLens = lenses.find((lens: any) => lens.type === "news");
    expect(newsLens).toBeDefined();
    expect(newsLens.version).toBe("v1");
    expect(newsLens.payload.hasShockEvent).toBe(true);
    expect(newsLens.payload.shockDirection).toBe("unknown");

    // Verify lens has both headlines and items
    expect(newsLens.payload.headlines).toHaveLength(2);
    expect(newsLens.payload.headlines[0]).toBe("Bitcoin Surges Past $100K");
    expect(newsLens.payload.items).toBeDefined();
    expect(newsLens.payload.items).toHaveLength(2);
    expect(newsLens.payload.items[0]).toMatchObject({
      title: "Bitcoin Surges Past $100K",
      source: "CoinDesk",
      url: "https://example.com/news-1",
    });

    // Verify newsFeatures is present (UWR-ready, not wired yet)
    expect(result.newsFeatures).toBeDefined();
    expect(result.newsFeatures?.hasNewsShock).toBe(true);
    expect(result.newsFeatures?.headlineCount).toBe(2);
    expect(result.newsFeatures?.mostRecentMinutesAgo).toBeGreaterThanOrEqual(0);
    expect(result.newsFeatures?.hasRegulatoryEvent).toBe(true); // "SEC" in headline
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

  it("should include newsFeatures when news enrichment is enabled", async () => {
    process.env.NEWS_PROVIDER = "newsdata";
    process.env.NEWSDATA_API_KEY = "test-key";

    // Mock provider with exchange and macro events
    const mockNewsSummary: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "unknown",
      headlines: [
        "Binance faces regulatory scrutiny",
        "Fed signals interest rate changes",
      ],
      items: [
        {
          id: "news-1",
          title: "Binance faces regulatory scrutiny",
          source: "Reuters",
          url: "https://example.com/news-1",
          publishedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
        },
        {
          id: "news-2",
          title: "Fed signals interest rate changes",
          source: "Bloomberg",
          url: "https://example.com/news-2",
          publishedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
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

    const inputSignal = {
      signalId: "test-news-features-001",
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

    // Verify newsFeatures is present
    expect(result.newsFeatures).toBeDefined();
    expect(result.newsFeatures?.hasNewsShock).toBe(true);
    expect(result.newsFeatures?.headlineCount).toBe(2);

    // Verify timing features
    expect(result.newsFeatures?.mostRecentMinutesAgo).toBeGreaterThanOrEqual(4);
    expect(result.newsFeatures?.mostRecentMinutesAgo).toBeLessThanOrEqual(6);
    expect(result.newsFeatures?.oldestMinutesAgo).toBeGreaterThanOrEqual(14);
    expect(result.newsFeatures?.oldestMinutesAgo).toBeLessThanOrEqual(16);

    // Verify categorical flags
    expect(result.newsFeatures?.hasExchangeEvent).toBe(true);  // "Binance"
    expect(result.newsFeatures?.hasRegulatoryEvent).toBe(false);
    expect(result.newsFeatures?.hasMacroEvent).toBe(true);     // "Fed"
  });

  it("should set newsFeatures to undefined when news enrichment is disabled", async () => {
    const inputSignal = {
      signalId: "test-news-features-002",
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
          news: { enabled: false },  // News disabled
          aiMl: { enabled: false },
        },
      },
    };

    const result = await froggyEnrichmentPlugin.run(inputSignal);

    // Verify newsFeatures is undefined when news is disabled
    expect(result.newsFeatures).toBeUndefined();
    expect(result.news).toBeUndefined();
  });
});

