/**
 * Coinbase Price Feed Adapter
 * 
 * Provides real-time price data from Coinbase exchange using ccxt.
 * 
 * Coinbase is a major US-based cryptocurrency exchange.
 * This adapter is READ-ONLY (no order placement).
 * 
 * Supported Markets:
 * - Spot markets only (no perpetual futures or derivatives)
 * 
 * Environment Variables:
 * - COINBASE_API_BASE_URL (optional): Custom API base URL for Coinbase
 * 
 * @see https://docs.ccxt.com/
 */

import ccxt from "ccxt";
import type { PriceFeedAdapter, OHLCVCandle, TickerSnapshot } from "./types.js";
import { toVenueSymbol } from "../symbolRegistry.js";

/**
 * Coinbase Price Feed Adapter
 *
 * Uses ccxt to fetch OHLCV and ticker data from Coinbase.
 * Supports spot markets only (Coinbase does not offer perpetual futures).
 */
class CoinbasePriceFeedAdapter implements PriceFeedAdapter {
  public readonly id = "coinbase";
  public readonly name = "Coinbase";
  public readonly supportsPerps = false;  // Coinbase spot only
  public readonly supportsSpot = true;

  private exchange: any; // ccxt.Exchange type

  constructor() {
    // Initialize ccxt Coinbase exchange
    // Note: ccxt uses lowercase 'coinbase' as the exchange ID
    this.exchange = new ccxt.coinbase({
      enableRateLimit: true, // Respect rate limits
      // No API keys needed for public endpoints (OHLCV, ticker)
    });

    // Apply custom base URL if provided
    const customBaseUrl = process.env.COINBASE_API_BASE_URL;
    if (customBaseUrl) {
      this.exchange.urls.api = customBaseUrl;
    }

    console.info(`✅ Coinbase price feed adapter initialized (spot markets only)`);
  }

  /**
   * Fetch OHLCV candles from Coinbase
   * 
   * @param params - OHLCV fetch parameters
   * @returns Array of OHLCV candles, sorted by timestamp ascending
   */
  async getOHLCV(params: {
    symbol: string;
    timeframe: string;
    since?: number;
    limit?: number;
  }): Promise<OHLCVCandle[]> {
    const { symbol, timeframe, since, limit } = params;

    try {
      // Convert AFI canonical symbol to Coinbase format using centralized registry
      // Coinbase uses "BASE-QUOTE" format (e.g., "BTC-USDT")
      const coinbaseSymbol = toVenueSymbol({
        venue: 'coinbase',
        canonical: symbol,
        marketType: 'spot',  // Coinbase spot only
      });

      console.info(`📊 Coinbase: Fetching OHLCV for ${coinbaseSymbol} (${timeframe})`);

      // Fetch OHLCV from Coinbase via ccxt
      // ccxt returns: [[timestamp, open, high, low, close, volume], ...]
      const ohlcvData = await this.exchange.fetchOHLCV(
        coinbaseSymbol,
        timeframe,
        since,
        limit
      );

      // Transform ccxt format to our OHLCVCandle type
      const candles: OHLCVCandle[] = ohlcvData.map((candle) => ({
        timestamp: candle[0],
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5],
      }));

      console.info(`✅ Coinbase: Fetched ${candles.length} candles for ${symbol}`);

      return candles;
    } catch (error) {
      // Provide clear error messages
      if (error instanceof Error) {
        throw new Error(
          `Coinbase OHLCV fetch failed for ${symbol} ${timeframe}: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Fetch current ticker snapshot from Coinbase
   * 
   * @param symbol - Trading pair symbol (e.g., "BTC/USDT")
   * @returns Current ticker snapshot
   */
  async getTicker(symbol: string): Promise<TickerSnapshot> {
    try {
      // Convert AFI canonical symbol to Coinbase format using centralized registry
      const coinbaseSymbol = toVenueSymbol({
        venue: 'coinbase',
        canonical: symbol,
        marketType: 'spot',
      });

      console.info(`📊 Coinbase: Fetching ticker for ${coinbaseSymbol}`);

      // Fetch ticker from Coinbase via ccxt
      const ticker = await this.exchange.fetchTicker(coinbaseSymbol);

      // Transform ccxt ticker to our TickerSnapshot type
      const snapshot: TickerSnapshot = {
        symbol: ticker.symbol,
        last: ticker.last || 0,
        bid: ticker.bid,
        ask: ticker.ask,
        volume24h: ticker.baseVolume,
        change24h: ticker.percentage,
        timestamp: ticker.timestamp || Date.now(),
      };

      console.info(`✅ Coinbase: Ticker for ${symbol} - Last: $${snapshot.last.toFixed(2)}`);

      return snapshot;
    } catch (error) {
      // Provide clear error messages
      if (error instanceof Error) {
        throw new Error(
          `Coinbase ticker fetch failed for ${symbol}: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Close the exchange connection (cleanup)
   * 
   * Call this when shutting down the adapter.
   */
  async close(): Promise<void> {
    // ccxt doesn't require explicit cleanup for most exchanges
    // but we provide this method for consistency
  }
}

// Export singleton instance
export const coinbasePriceFeedAdapter = new CoinbasePriceFeedAdapter();

// Export class for testing
export { CoinbasePriceFeedAdapter };

