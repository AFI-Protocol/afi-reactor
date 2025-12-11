/**
 * NewsProvider - Pluggable news data source for Froggy enrichment
 *
 * Provides a unified interface for fetching crypto news from various providers
 * (NewsData.io, CryptoCompare, CoinFeeds, CryptoPanic, etc.)
 *
 * All providers must implement fail-soft behavior:
 * - Return null on configuration errors (missing API key, etc.)
 * - Return null on network/API errors
 * - Never throw exceptions that would break enrichment
 */

/**
 * A single news headline from any provider (legacy format)
 */
export interface NewsHeadline {
  /** Unique identifier for this headline */
  id: string;
  /** Headline title/text */
  title: string;
  /** News source name */
  source: string;
  /** Optional URL to full article */
  url?: string;
  /** Publication timestamp (ISO 8601 string) */
  publishedAt: string;
}

/**
 * Structured news item with full metadata (v2 format)
 */
export interface NewsItem {
  /** Unique identifier for this news item */
  id: string;
  /** Article title */
  title: string;
  /** News source name */
  source: string;
  /** URL to full article */
  url: string;
  /** Publication timestamp as Date object */
  publishedAt: Date;
}

/**
 * Direction of a news shock event
 */
export type NewsShockDirection = "bullish" | "bearish" | "none" | "unknown";

/**
 * Summary of recent news and shock events
 *
 * This maps directly to the NewsLensV1 payload and top-level news object
 * in FroggyEnrichedView.
 *
 * BACKWARD COMPATIBILITY:
 * - headlines: string[] - Legacy format (title-only strings)
 * - items: NewsItem[] - New structured format with full metadata (optional)
 */
export interface NewsShockSummary {
  /** Whether a shock event was detected */
  hasShockEvent: boolean;
  /** Direction of shock (if any) */
  shockDirection: NewsShockDirection;
  /** Recent headlines (legacy format - title strings only) */
  headlines: string[];
  /** Structured news items with full metadata (optional, v2 format) */
  items?: NewsItem[];
}

/**
 * Parameters for fetching news
 */
export interface NewsProviderParams {
  /** Trading symbol (e.g. "BTCUSDT", "ETHUSDT") */
  symbol: string;
  /** Lookback window in hours (default: 4) */
  windowHours?: number;
}

/**
 * NewsProvider interface
 *
 * All implementations must:
 * 1. Return null on any error (fail-soft)
 * 2. Filter news to the specified time window
 * 3. Return at most 5-10 headlines to avoid noise
 * 4. Sort headlines by publishedAt descending (newest first)
 */
export interface NewsProvider {
  /**
   * Fetch recent news for a given symbol
   *
   * @param params - Symbol and time window
   * @returns NewsShockSummary or null on error
   */
  fetchRecentNews(params: NewsProviderParams): Promise<NewsShockSummary | null>;
}

/**
 * Default news summary when no provider is configured or provider fails
 */
export const DEFAULT_NEWS_SUMMARY: NewsShockSummary = {
  hasShockEvent: false,
  shockDirection: "none",
  headlines: [],
  items: [],
};

