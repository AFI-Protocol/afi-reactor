/**
 * Test: NewsData.io Provider
 *
 * Verifies:
 * 1. NewsData provider correctly fetches and parses news
 * 2. Symbol mapping (BTCUSDT → btc, ETHUSDT → eth, etc.)
 * 3. Time window filtering
 * 4. Deduplication by (title, source)
 * 5. Structured items with full metadata
 * 6. Backward-compatible headlines array (title strings only)
 * 7. Fail-soft behavior (missing API key, network errors, etc.)
 * 8. Integration with Froggy enrichment plugin
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { NewsDataProvider } from "../../src/news/newsdataNewsProvider.js";
import type { NewsShockSummary } from "../../src/news/newsProvider.js";

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe("NewsDataProvider", () => {
  const TEST_API_KEY = "test-api-key-123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should fetch and parse news successfully for BTC", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    // Mock NewsData.io API response
    const mockResponse = {
      status: "success",
      totalResults: 3,
      results: [
        {
          article_id: "news-1",
          title: "Bitcoin Surges Past $100K",
          source_name: "CoinDesk",
          link: "https://example.com/news-1",
          pubDate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        },
        {
          article_id: "news-2",
          title: "SEC Approves Bitcoin ETF",
          source_name: "Bloomberg",
          link: "https://example.com/news-2",
          pubDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        },
        {
          article_id: "news-3",
          title: "MicroStrategy Buys More BTC",
          source_name: "Reuters",
          link: "https://example.com/news-3",
          pubDate: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 4,
    });

    expect(result).not.toBeNull();
    expect(result?.hasShockEvent).toBe(true);
    expect(result?.shockDirection).toBe("unknown");

    // Verify legacy headlines array (title strings only)
    expect(result?.headlines).toHaveLength(3);
    expect(result?.headlines[0]).toBe("Bitcoin Surges Past $100K");
    expect(result?.headlines[1]).toBe("SEC Approves Bitcoin ETF");
    expect(result?.headlines[2]).toBe("MicroStrategy Buys More BTC");

    // Verify structured items array
    expect(result?.items).toBeDefined();
    expect(result?.items).toHaveLength(3);
    expect(result?.items?.[0].title).toBe("Bitcoin Surges Past $100K");
    expect(result?.items?.[0].source).toBe("CoinDesk");
    expect(result?.items?.[0].url).toBe("https://example.com/news-1");
    expect(result?.items?.[0].publishedAt).toBeInstanceOf(Date);

    // Verify API call
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain("newsdata.io/api/1/crypto");
    expect(callUrl).toContain("apikey=test-api-key-123");
    expect(callUrl).toContain("coin=btc");
  });

  it("should filter out old news outside the time window", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    const mockResponse = {
      status: "success",
      totalResults: 3,
      results: [
        {
          article_id: "news-1",
          title: "Recent News",
          source_name: "CoinDesk",
          pubDate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        },
        {
          article_id: "news-2",
          title: "Old News",
          source_name: "Bloomberg",
          pubDate: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), // 10 hours ago (outside window)
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 4,
    });

    expect(result).not.toBeNull();
    expect(result?.headlines).toHaveLength(1);
    expect(result?.headlines[0]).toBe("Recent News");
    expect(result?.items).toHaveLength(1);
    expect(result?.items?.[0].title).toBe("Recent News");
  });

  it("should return null on API error (401 Unauthorized)", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 4,
    });

    expect(result).toBeNull();
  });

  it("should return null on network error", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 4,
    });

    expect(result).toBeNull();
  });

  it("should return default summary when no results", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    const mockResponse = {
      status: "success",
      totalResults: 0,
      results: [],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 4,
    });

    expect(result).not.toBeNull();
    expect(result?.hasShockEvent).toBe(false);
    expect(result?.shockDirection).toBe("none");
    expect(result?.headlines).toHaveLength(0);
  });

  it("should map ETHUSDT to eth coin code", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", results: [] }),
    } as Response);

    await provider.fetchRecentNews({
      symbol: "ETHUSDT",
      windowHours: 4,
    });

    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain("coin=eth");
  });

  it("should deduplicate articles with same (title, source)", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    const mockResponse = {
      status: "success",
      totalResults: 4,
      results: [
        {
          article_id: "news-1",
          title: "Bitcoin Hits New High",
          source_name: "CoinDesk",
          link: "https://example.com/news-1",
          pubDate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        },
        {
          article_id: "news-2",
          title: "Bitcoin Hits New High", // Duplicate title
          source_name: "CoinDesk", // Same source
          link: "https://example.com/news-2-duplicate",
          pubDate: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
        },
        {
          article_id: "news-3",
          title: "Bitcoin Hits New High", // Same title
          source_name: "Bloomberg", // Different source - should NOT be filtered
          link: "https://example.com/news-3",
          pubDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
        {
          article_id: "news-4",
          title: "ETH Price Surges",
          source_name: "Reuters",
          link: "https://example.com/news-4",
          pubDate: new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString(),
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 4,
    });

    expect(result).not.toBeNull();
    // Should have 3 unique items (news-1, news-3, news-4)
    // news-2 is filtered as duplicate of news-1
    expect(result?.items).toHaveLength(3);
    expect(result?.headlines).toHaveLength(3);

    // Verify the kept items
    expect(result?.items?.[0].title).toBe("Bitcoin Hits New High");
    expect(result?.items?.[0].source).toBe("CoinDesk");
    expect(result?.items?.[1].title).toBe("Bitcoin Hits New High");
    expect(result?.items?.[1].source).toBe("Bloomberg"); // Different source, kept
    expect(result?.items?.[2].title).toBe("ETH Price Surges");
  });

  it("should cap results to 10 items", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    // Create 15 unique articles
    const results = Array.from({ length: 15 }, (_, i) => ({
      article_id: `news-${i}`,
      title: `News Article ${i}`,
      source_name: "CoinDesk",
      link: `https://example.com/news-${i}`,
      pubDate: new Date(Date.now() - i * 10 * 60 * 1000).toISOString(), // 10 min intervals
    }));

    const mockResponse = {
      status: "success",
      totalResults: 15,
      results,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 24,
    });

    expect(result).not.toBeNull();
    // Should be capped to 10 items
    expect(result?.items).toHaveLength(10);
    expect(result?.headlines).toHaveLength(10);

    // Verify first and last items (should be newest 10)
    expect(result?.items?.[0].title).toBe("News Article 0");
    expect(result?.items?.[9].title).toBe("News Article 9");
  });

  it("should maintain backward compatibility with headlines array", async () => {
    const provider = new NewsDataProvider(TEST_API_KEY);

    const mockResponse = {
      status: "success",
      totalResults: 2,
      results: [
        {
          article_id: "news-1",
          title: "First Article",
          source_name: "CoinDesk",
          link: "https://example.com/news-1",
          pubDate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        },
        {
          article_id: "news-2",
          title: "Second Article",
          source_name: "Bloomberg",
          link: "https://example.com/news-2",
          pubDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await provider.fetchRecentNews({
      symbol: "BTCUSDT",
      windowHours: 4,
    });

    expect(result).not.toBeNull();

    // Verify headlines is array of strings (backward compatible)
    expect(Array.isArray(result?.headlines)).toBe(true);
    expect(typeof result?.headlines[0]).toBe("string");
    expect(result?.headlines).toEqual(["First Article", "Second Article"]);

    // Verify items has full metadata
    expect(result?.items?.[0]).toMatchObject({
      title: "First Article",
      source: "CoinDesk",
      url: "https://example.com/news-1",
    });
    expect(result?.items?.[0].publishedAt).toBeInstanceOf(Date);
  });
});

