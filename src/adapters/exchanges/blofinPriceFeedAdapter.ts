/**
 * BloFin Price Feed Adapter
 * 
 * Provides real-time price data from BloFin exchange using ccxt.
 * 
 * BloFin is AFI's primary CEX for crypto perpetual futures.
 * This adapter is READ-ONLY (no order placement).
 * 
 * Environment Variables:
 * - BLOFIN_API_BASE_URL (optional): Custom API base URL for BloFin
 * 
 * @see https://docs.ccxt.com/
 */

import ccxt from "ccxt";
import type { PriceFeedAdapter, OHLCVCandle, TickerSnapshot } from "./types.js";
import { toVenueSymbol } from "../symbolRegistry.js";

/**
 * BloFin Price Feed Adapter
 *
 * Uses ccxt to fetch OHLCV and ticker data from BloFin.
 * Supports both perpetual futures and spot markets.
 */
class BloFinPriceFeedAdapter implements PriceFeedAdapter {
  public readonly id = "blofin";
  public readonly name = "BloFin";
  public readonly supportsPerps = true;
  public readonly supportsSpot = true;

  private exchange: any; // ccxt.Exchange type

  constructor() {
    // Initialize ccxt BloFin exchange
    // Note: ccxt uses lowercase 'blofin' as the exchange ID
    this.exchange = new ccxt.blofin({
      enableRateLimit: true, // Respect rate limits
      // No API keys needed for public endpoints (OHLCV, ticker)
    });

    // Apply custom base URL if provided
    const customBaseUrl = process.env.BLOFIN_API_BASE_URL;
    if (customBaseUrl) {
      this.exchange.urls.api = customBaseUrl;
    }
  }

  /**
   * Fetch OHLCV candles from BloFin
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
      // Convert AFI canonical symbol to BloFin format using centralized registry
      // Assumes perps by default (most common use case for BloFin)
      const blofinSymbol = toVenueSymbol({
        venue: 'blofin',
        canonical: symbol,
        marketType: 'perp',
      });

      // Fetch OHLCV from BloFin via ccxt
      // ccxt returns: [[timestamp, open, high, low, close, volume], ...]
      const ohlcvData = await this.exchange.fetchOHLCV(
        blofinSymbol,
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

      return candles;
    } catch (error) {
      // Provide clear error messages
      if (error instanceof Error) {
        throw new Error(
          `BloFin OHLCV fetch failed for ${symbol} ${timeframe}: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Fetch current ticker snapshot from BloFin
   * 
   * @param symbol - Trading pair symbol (e.g., "BTC/USDT")
   * @returns Current ticker snapshot
   */
  async getTicker(symbol: string): Promise<TickerSnapshot> {
    try {
      // Convert AFI canonical symbol to BloFin format using centralized registry
      const blofinSymbol = toVenueSymbol({
        venue: 'blofin',
        canonical: symbol,
        marketType: 'perp',
      });

      // Fetch ticker from BloFin via ccxt
      const ticker = await this.exchange.fetchTicker(blofinSymbol);

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

      return snapshot;
    } catch (error) {
      // Provide clear error messages
      if (error instanceof Error) {
        throw new Error(
          `BloFin ticker fetch failed for ${symbol}: ${error.message}`
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
export const blofinPriceFeedAdapter = new BloFinPriceFeedAdapter();

// Export class for testing
export { BloFinPriceFeedAdapter };

