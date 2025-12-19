/**
 * Coinalyze API Client
 *
 * Fetches perp market metrics (funding rates, open interest, long/short ratios)
 * from Coinalyze API for sentiment enrichment.
 *
 * API Documentation: https://github.com/ivarurdalen/coinalyze
 * Rate Limit: 40 requests per minute
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

/**
 * Fetch perp metrics from Coinalyze API
 *
 * @param symbol - Coinalyze symbol (e.g. "BTCUSDT_PERP.A" for Binance BTC perp)
 * @param timeframe - Timeframe for history ("1h" or "1d")
 * @returns CoinalyzePerpMetrics or throws error
 */
export async function fetchCoinalyzePerpMetrics(
  symbol: string,
  timeframe: "1h" | "1d" = "1h"
): Promise<CoinalyzePerpMetrics> {
  const apiKey = process.env.COINALYZE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "COINALYZE_API_KEY environment variable is required for Coinalyze sentiment enrichment. " +
      "Get your API key from https://coinalyze.net and set it in your .env file."
    );
  }

  const baseUrl = "https://api.coinalyze.net/v1";

  try {
    // Fetch funding rate history (last 24 data points)
    const fundingUrl = `${baseUrl}/funding-rate?symbols=${symbol}&interval=${timeframe}&limit=24`;
    const fundingResponse = await fetch(fundingUrl, {
      headers: {
        "api-key": apiKey,
      },
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
    const oiResponse = await fetch(oiUrl, {
      headers: {
        "api-key": apiKey,
      },
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

