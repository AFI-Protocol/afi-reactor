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
  NewsItem,
  NewsShockDirection,
} from "../../news/newsProvider.js";
import { redactSecrets } from "../redaction.js";

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
 * Combine an optional caller abort signal with an internal timeout deadline
 * into one signal that aborts when EITHER fires. Avoids AbortSignal.any() for
 * older Node 20.x compatibility.
 */
function combineAbort(caller: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timer = AbortSignal.timeout(timeoutMs);
  if (!caller) return timer;
  const controller = new AbortController();
  if (caller.aborted) {
    controller.abort(caller.reason);
    return controller.signal;
  }
  caller.addEventListener("abort", () => controller.abort(caller.reason), { once: true });
  timer.addEventListener("abort", () => controller.abort(timer.reason), { once: true });
  return controller.signal;
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
 * Injectable options for the NewsData.io provider. `fetchImpl` enables offline
 * BYOK proofs (a deterministic fake transport) without a live key.
 */
export interface NewsDataProviderOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * NewsData.io provider implementation.
 *
 * The API key is carried in the X-ACCESS-KEY request HEADER — never in the URL
 * query string (PBF-GOV §8.1: closes the key-in-URL leak). The transport is
 * injectable and error logs are redacted, so the credential cannot escape
 * through a request URL, trace, or thrown error.
 */
export class NewsDataProvider implements NewsProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(apiKey: string, options: NewsDataProviderOptions = {}) {
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? "https://newsdata.io/api/1/crypto";
    // Bind to the CURRENT global fetch at call time so a test's global.fetch
    // mock (set after construction) is still honoured.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async fetchRecentNews(params: NewsProviderParams): Promise<NewsShockSummary | null> {
    const { symbol, windowHours = 4, abort } = params;
    const debugNews = process.env.AFI_DEBUG_NEWS === "1";

    try {
      // Map symbol to coin/query
      const { coin, query } = mapSymbolToCoinQuery(symbol);

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: symbol="${symbol}" → coin="${coin}", query="${query}"`);
        console.log(`[NewsDataProvider] DEBUG: windowHours=${windowHours}`);
      }

      // Build query params — the credential rides in the X-ACCESS-KEY HEADER,
      // NEVER in the query string (PBF-GOV §8.1: no key-in-URL leak).
      const queryParams = new URLSearchParams({ language: "en" });
      if (coin) {
        queryParams.set("coin", coin);
      }
      if (query) {
        queryParams.set("q", query);
      }

      // The request URL is credential-free and therefore safe to log/trace.
      const url = `${this.baseUrl}?${queryParams.toString()}`;

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: Fetching ${url}`);
      }

      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-ACCESS-KEY": this.apiKey,
        },
        // Cancel on EITHER the caller's abort (executor timeout / cancellation)
        // OR the provider's own deadline, whichever fires first.
        signal: combineAbort(abort, this.timeoutMs),
      });

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: Response status=${response.status} ${response.statusText}`);
      }

      if (!response.ok) {
        console.warn(
          `[NewsDataProvider] API error: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const data: NewsDataResponse = await response.json();

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: Response status="${data.status}", totalResults=${data.totalResults}, results.length=${data.results?.length ?? 0}`);
      }

      if (data.status !== "success" || !data.results || data.results.length === 0) {
        console.log(`[NewsDataProvider] No news results for ${symbol}`);
        return {
          hasShockEvent: false,
          shockDirection: "none",
          headlines: [],
        };
      }

      // Filter by time window and convert to NewsItem[]
      const cutoffTime = Date.now() - windowHours * 60 * 60 * 1000;
      const MAX_ITEMS = 10;

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: cutoffTime=${new Date(cutoffTime).toISOString()}, now=${new Date().toISOString()}`);
        console.log(`[NewsDataProvider] DEBUG: Articles before filtering: ${data.results.length}`);
        // Log first 3 article timestamps
        data.results.slice(0, 3).forEach((article, i) => {
          console.log(`[NewsDataProvider] DEBUG: Article ${i + 1}: pubDate="${article.pubDate}", title="${article.title.slice(0, 50)}..."`);
        });
      }

      // Step 1: Filter by time window and convert to NewsItem[]
      const recentItems: NewsItem[] = data.results
        .map((article) => {
          const pubDate = article.pubDate ? new Date(article.pubDate) : new Date();
          return {
            id: article.article_id,
            title: article.title,
            source: article.source_name || article.source_id || "Unknown",
            url: article.link || "",
            publishedAt: pubDate,
          };
        })
        .filter((item) => {
          const pubTime = item.publishedAt.getTime();
          const isRecent = pubTime >= cutoffTime;
          if (debugNews && !isRecent) {
            const ageHours = ((Date.now() - pubTime) / (1000 * 60 * 60)).toFixed(1);
            console.log(`[NewsDataProvider] DEBUG: Filtered out article (${ageHours}h old): "${item.title.slice(0, 40)}..."`);
          }
          return isRecent;
        })
        .sort((a, b) => {
          // Sort descending (newest first)
          return b.publishedAt.getTime() - a.publishedAt.getTime();
        });

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: Items after time filtering: ${recentItems.length}`);
      }

      // Step 2: Deduplicate by normalized (title, source)
      const seen = new Set<string>();
      const dedupedItems: NewsItem[] = [];

      for (const item of recentItems) {
        const titleNormalized = item.title.trim().toLowerCase();
        const sourceNormalized = item.source.trim().toLowerCase();
        const key = `${titleNormalized}::${sourceNormalized}`;

        if (!seen.has(key)) {
          seen.add(key);
          dedupedItems.push(item);
        } else if (debugNews) {
          console.log(`[NewsDataProvider] DEBUG: Duplicate filtered: "${item.title.slice(0, 40)}..." from ${item.source}`);
        }
      }

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: Items after deduplication: ${dedupedItems.length}`);
      }

      // Step 3: Cap to MAX_ITEMS
      const items = dedupedItems.slice(0, MAX_ITEMS);

      if (debugNews) {
        console.log(`[NewsDataProvider] DEBUG: Final items (capped to ${MAX_ITEMS}): ${items.length}`);
        if (items.length > 0) {
          console.log(`[NewsDataProvider] DEBUG: Sample item: "${items[0].title}" from ${items[0].source} (${items[0].publishedAt.toISOString()})`);
        }
      }

      // Step 4: Build legacy headlines array (title strings only)
      const headlines = items.map((item) => item.title);

      // Compute shock summary
      const hasShockEvent = items.length > 0;
      const shockDirection: NewsShockDirection = hasShockEvent ? "unknown" : "none";

      return {
        hasShockEvent,
        shockDirection,
        headlines,
        items,
      };
    } catch (error) {
      // Redact any secret material before logging the error (defense in depth:
      // the URL is already key-free, but a transport error could carry request
      // config with the header value).
      console.warn(
        `[NewsDataProvider] Error fetching news for ${symbol}:`,
        redactSecrets(error, [this.apiKey])
      );
      return null;
    }
  }
}

