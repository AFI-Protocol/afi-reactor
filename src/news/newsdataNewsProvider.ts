/**
 * NewsData.io News Provider
 *
 * Fetches crypto news from NewsData.io's crypto news API.
 * API Docs: https://newsdata.io/crypto-news-api
 *
 * Endpoint: https://newsdata.io/api/1/crypto
 * Parameters:
 * - apikey: API key (required)
 * - coin: Coin filter (btc, eth, etc.)
 * - q: Search query
 * - language: Language filter (default: en)
 * - from_date: Start date filter (YYYY-MM-DD)
 */

import type {
  NewsProvider,
  NewsProviderParams,
  NewsShockSummary,
  NewsHeadline,
  NewsShockDirection,
} from "./newsProvider.js";

/**
 * NewsData.io API response structure
 */
interface NewsDataResponse {
  status: string;
  totalResults?: number;
  results?: NewsDataArticle[];
  nextPage?: string;
}

interface NewsDataArticle {
  article_id: string;
  title: string;
  link?: string;
  source_id?: string;
  source_name?: string;
  pubDate?: string;
  description?: string;
  content?: string;
}

/**
 * Map AFI trading symbols to NewsData.io coin codes and search queries
 */
function mapSymbolToCoinQuery(symbol: string): { coin?: string; query?: string } {
  const upper = symbol.toUpperCase();

  if (upper.includes("BTC")) {
    return { coin: "btc", query: "Bitcoin OR BTC" };
  }
  if (upper.includes("ETH")) {
    return { coin: "eth", query: "Ethereum OR ETH" };
  }
  if (upper.includes("SOL")) {
    return { coin: "sol", query: "Solana OR SOL" };
  }
  if (upper.includes("AVAX")) {
    return { coin: "avax", query: "Avalanche OR AVAX" };
  }

  // Default fallback: generic crypto news
  return { query: "cryptocurrency" };
}

/**
 * NewsData.io provider implementation
 */
export class NewsDataProvider implements NewsProvider {
  private readonly apiKey: string;
  private readonly baseUrl = "https://newsdata.io/api/1/crypto";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchRecentNews(params: NewsProviderParams): Promise<NewsShockSummary | null> {
    const { symbol, windowHours = 4 } = params;

    try {
      // Map symbol to coin/query
      const { coin, query } = mapSymbolToCoinQuery(symbol);

      // Build query params
      const queryParams = new URLSearchParams({
        apikey: this.apiKey,
        language: "en",
      });

      if (coin) {
        queryParams.set("coin", coin);
      }
      if (query) {
        queryParams.set("q", query);
      }

      // Fetch from NewsData.io
      const url = `${this.baseUrl}?${queryParams.toString()}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        console.warn(
          `[NewsDataProvider] API error: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const data: NewsDataResponse = await response.json();

      if (data.status !== "success" || !data.results || data.results.length === 0) {
        console.log(`[NewsDataProvider] No news results for ${symbol}`);
        return {
          hasShockEvent: false,
          shockDirection: "none",
          headlines: [],
        };
      }

      // Filter by time window and convert to NewsHeadline[]
      const cutoffTime = Date.now() - windowHours * 60 * 60 * 1000;
      const headlines: NewsHeadline[] = data.results
        .map((article) => ({
          id: article.article_id,
          title: article.title,
          source: article.source_name || article.source_id || "Unknown",
          url: article.link,
          publishedAt: article.pubDate || new Date().toISOString(),
        }))
        .filter((headline) => {
          const pubTime = new Date(headline.publishedAt).getTime();
          return pubTime >= cutoffTime;
        })
        .sort((a, b) => {
          // Sort descending (newest first)
          return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        })
        .slice(0, 5); // Limit to top 5 headlines

      // Compute shock summary
      const hasShockEvent = headlines.length > 0;
      const shockDirection: NewsShockDirection = hasShockEvent ? "unknown" : "none";

      return {
        hasShockEvent,
        shockDirection,
        headlines,
      };
    } catch (error) {
      console.warn(`[NewsDataProvider] Error fetching news for ${symbol}:`, error);
      return null;
    }
  }
}

/**
 * Factory function to create NewsData provider from environment config
 */
export function createNewsDataProvider(): NewsDataProvider | null {
  const apiKey = process.env.NEWSDATA_API_KEY;

  if (!apiKey) {
    console.warn(
      "[NewsDataProvider] NEWSDATA_API_KEY not configured. News enrichment disabled."
    );
    return null;
  }

  return new NewsDataProvider(apiKey);
}

