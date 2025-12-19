/**
 * CoinGecko API Client
 *
 * Provides access to CoinGecko's free public API for OHLC data.
 * No API key required for basic usage.
 *
 * API Docs: https://www.coingecko.com/en/api/documentation
 *
 * Rate limits (free tier):
 * - 10-50 calls/minute depending on endpoint
 * - We use fail-soft behavior to handle rate limits gracefully
 */

const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

/**
 * CoinGecko OHLC candle data point
 */
export interface CoinGeckoOhlcCandle {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Map trading symbol to CoinGecko coin ID
 *
 * @param symbol - Trading symbol (e.g. "BTCUSDT", "ETHUSDT")
 * @returns CoinGecko coin ID (e.g. "bitcoin", "ethereum")
 */
export function mapSymbolToCoinGeckoId(symbol: string): string {
  const normalized = symbol.toUpperCase().replace(/USDT|USD|PERP|_PERP\.A/g, "");

  const mapping: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    SOL: "solana",
    BNB: "binancecoin",
    XRP: "ripple",
    ADA: "cardano",
    DOGE: "dogecoin",
    MATIC: "matic-network",
    DOT: "polkadot",
    AVAX: "avalanche-2",
  };

  const coinId = mapping[normalized];
  if (!coinId) {
    console.warn(
      `⚠️  CoinGecko: Unknown symbol "${symbol}", defaulting to "bitcoin"`
    );
    return "bitcoin";
  }

  return coinId;
}

/**
 * Fetch OHLC data from CoinGecko
 *
 * @param coinId - CoinGecko coin ID (e.g. "bitcoin", "ethereum")
 * @param vsCurrency - Quote currency (e.g. "usd")
 * @param days - Number of days of history (1, 7, 14, 30, 90, 180, 365, max)
 * @returns Array of OHLC candles
 *
 * @throws Error if API call fails or returns invalid data
 */
export async function fetchCoinGeckoOhlc(
  coinId: string,
  vsCurrency: string = "usd",
  days: number = 90
): Promise<CoinGeckoOhlcCandle[]> {
  const url = `${COINGECKO_BASE_URL}/coins/${coinId}/ohlc?vs_currency=${vsCurrency}&days=${days}`;

  try {
    console.log(`🔍 CoinGecko: Fetching ${days}d OHLC for ${coinId}...`);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          `CoinGecko rate limit exceeded (429). Please retry later.`
        );
      }
      throw new Error(
        `CoinGecko API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Validate response format
    if (!Array.isArray(data)) {
      throw new Error(
        `CoinGecko API returned invalid data. Expected array, got: ${typeof data}`
      );
    }

    if (data.length === 0) {
      console.warn(`⚠️  CoinGecko: No OHLC data returned for ${coinId}`);
      return [];
    }

    // Map response to our format
    // CoinGecko returns: [timestamp, open, high, low, close]
    const candles: CoinGeckoOhlcCandle[] = data.map((item: any) => {
      if (!Array.isArray(item) || item.length !== 5) {
        throw new Error(
          `CoinGecko: Invalid candle format. Expected [timestamp, o, h, l, c], got: ${JSON.stringify(item)}`
        );
      }

      return {
        timestampMs: item[0],
        open: item[1],
        high: item[2],
        low: item[3],
        close: item[4],
      };
    });

    console.log(
      `✅ CoinGecko: Fetched ${candles.length} candles for ${coinId}`
    );

    return candles;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ CoinGecko API error for ${coinId}:`, error.message);
      throw error;
    }
    throw new Error(`Unknown error fetching CoinGecko OHLC for ${coinId}`);
  }
}

