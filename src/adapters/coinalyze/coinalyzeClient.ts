/**
 * Coinalyze API Client
 *
 * Fetches perp market metrics (funding rates, open interest, long/short ratios)
 * from Coinalyze API for sentiment enrichment.
 *
 * API Documentation: https://github.com/ivarurdalen/coinalyze
 * Rate Limit: 40 requests per minute
 *
 * Hardening (W3 spec section 5, bounded + behavior-preserving):
 *  - every request carries an AbortSignal timeout (default 10s);
 *  - a module-level TTL cache (default 60s) keyed by symbol+timeframe
 *    absorbs repeated reads within a scoring burst (rate-limit friendly);
 *  - simple in-flight de-duplication: concurrent calls for the same key
 *    share one upstream request. Errors are NEVER cached.
 * Tests inject a fetch implementation / clock through the options bag; the
 * production call sites keep the exact same two-argument call shape.
 *
 * @module coinalyzeClient
 */

/**
 * Coinalyze perp metrics for a single symbol
 */
export interface CoinalyzePerpMetrics {
  /** Latest funding rate (per period, in decimal, e.g. 0.0001 = 0.01%) */
  fundingRate: number;
  /** Funding rate history (last N periods, optional) */
  fundingHistory?: number[];
  /** Latest open interest in USD */
  oiUsd: number;
  /** Open interest history in USD (last 24h or recent window) */
  oiHistoryUsd: number[];
  /** Long/short ratio (if available from Coinalyze) */
  longShortRatio?: number;
}

/**
 * Coinalyze API response for funding rate (actual format from API)
 */
interface CoinalyzeFundingRateResponse extends Array<{
  symbol: string;
  value: number;  // funding rate (decimal)
  update: number; // timestamp (ms)
}> {}

/**
 * Coinalyze API response for open interest (actual format from API)
 */
interface CoinalyzeOIResponse extends Array<{
  symbol: string;
  value: number;  // open interest (USD)
  update: number; // timestamp (ms)
}> {}

/** Injectable knobs (tests); production callers omit this bag entirely. */
export interface CoinalyzeClientOptions {
  /** Per-request abort timeout in ms (default 10_000). */
  timeoutMs?: number;
  /** Cache TTL in ms (default 60_000). */
  ttlMs?: number;
  /** Fetch implementation (default: global fetch). */
  fetchImpl?: typeof fetch;
  /** Clock (default: Date.now). */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  metrics: CoinalyzePerpMetrics;
}

/** Module-level TTL cache + in-flight de-dup, keyed by symbol|timeframe. */
const metricsCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CoinalyzePerpMetrics>>();

/** Test hook: clears the module-level cache and in-flight table. */
export function __resetCoinalyzeClientStateForTests(): void {
  metricsCache.clear();
  inFlight.clear();
}

/**
 * Fetch perp metrics from Coinalyze API
 *
 * @param symbol - Coinalyze symbol ('<BASE><QUOTE>_PERP.A' convention, Binance perp aggregate)
 * @param timeframe - Timeframe for history ("1h" or "1d")
 * @param options - Injectable timeout/TTL/fetch/clock (tests)
 * @returns CoinalyzePerpMetrics or throws error
 */
export async function fetchCoinalyzePerpMetrics(
  symbol: string,
  timeframe: "1h" | "1d" = "1h",
  options: CoinalyzeClientOptions = {}
): Promise<CoinalyzePerpMetrics> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const key = `${symbol}|${timeframe}`;

  const cached = metricsCache.get(key);
  if (cached && cached.expiresAt > now()) {
    return cached.metrics;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const request = fetchFresh(symbol, timeframe, options)
    .then((metrics) => {
      metricsCache.set(key, { expiresAt: now() + ttlMs, metrics });
      inFlight.delete(key);
      return metrics;
    })
    .catch((error) => {
      // Errors are never cached; the next call retries upstream.
      inFlight.delete(key);
      throw error;
    });
  inFlight.set(key, request);
  return request;
}

async function fetchFresh(
  symbol: string,
  timeframe: "1h" | "1d",
  options: CoinalyzeClientOptions
): Promise<CoinalyzePerpMetrics> {
  const apiKey = process.env.COINALYZE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "COINALYZE_API_KEY environment variable is required for Coinalyze sentiment enrichment. " +
      "Get your API key from https://coinalyze.net and set it in your .env file."
    );
  }

  const baseUrl = "https://api.coinalyze.net/v1";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    // Fetch funding rate history (last 24 data points)
    const fundingUrl = `${baseUrl}/funding-rate?symbols=${symbol}&interval=${timeframe}&limit=24`;
    const fundingResponse = await fetchImpl(fundingUrl, {
      headers: {
        "api-key": apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!fundingResponse.ok) {
      throw new Error(
        `Coinalyze funding rate API error: ${fundingResponse.status} ${fundingResponse.statusText}`
      );
    }

    const fundingData: CoinalyzeFundingRateResponse = await fundingResponse.json();

    // Validate funding data structure
    if (!Array.isArray(fundingData) || fundingData.length === 0) {
      console.error(`❌ Coinalyze funding data invalid for ${symbol}:`, JSON.stringify(fundingData).substring(0, 200));
      throw new Error(
        `Coinalyze funding rate API returned invalid data. Expected array with at least one element, got: ${typeof fundingData}`
      );
    }

    // Fetch open interest history (last 24 data points)
    const oiUrl = `${baseUrl}/open-interest?symbols=${symbol}&interval=${timeframe}&limit=24`;
    const oiResponse = await fetchImpl(oiUrl, {
      headers: {
        "api-key": apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!oiResponse.ok) {
      throw new Error(
        `Coinalyze OI API error: ${oiResponse.status} ${oiResponse.statusText}`
      );
    }

    const oiData: CoinalyzeOIResponse = await oiResponse.json();

    // Validate OI data structure
    if (!Array.isArray(oiData) || oiData.length === 0) {
      console.error(`❌ Coinalyze OI data invalid for ${symbol}:`, JSON.stringify(oiData).substring(0, 200));
      throw new Error(
        `Coinalyze OI API returned invalid data. Expected array with at least one element, got: ${typeof oiData}`
      );
    }

    // Extract funding rate history (map from API format to our format)
    // Note: Coinalyze returns array of {symbol, value, update}, we need just the values
    const fundingHistory = fundingData.map((item) => item.value);
    const fundingRate = fundingHistory[fundingHistory.length - 1] || 0;

    // Extract OI history
    const oiHistoryUsd = oiData.map((item) => item.value);
    const oiUsd = oiHistoryUsd[oiHistoryUsd.length - 1] || 0;

    // TODO: Fetch long/short ratio if Coinalyze provides it
    // For now, we'll derive it from funding rate as a proxy
    const longShortRatio = undefined;

    return {
      fundingRate,
      fundingHistory,
      oiUsd,
      oiHistoryUsd,
      longShortRatio,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ Coinalyze API error for ${symbol}:`, error.message);
      throw error;
    }
    throw new Error(`Unknown error fetching Coinalyze metrics for ${symbol}`);
  }
}
