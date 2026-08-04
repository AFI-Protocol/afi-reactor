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

import ccxt, { type OHLCV } from "ccxt";
import type { PriceFeedAdapter, OHLCVCandle, TickerSnapshot } from "./types.js";
import { toOHLCVCandle } from "./types.js";
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

  // D8-R2: this `any` is why the OHLCV mapping below type-checks at all.
  // Typing it `ccxt.Exchange` surfaces that ccxt declares every OHLCV
  // element as `Num` (number | undefined) and `ticker.symbol` as `Str`,
  // neither of which satisfies our OHLCVCandle/TickerSnapshot contracts.
  // Left as-is deliberately: tightening it forces a reject-or-default
  // decision that changes scoring behaviour. See the D8 report.
  private exchange: any; // ccxt.Exchange

  constructor() {
    // Initialize ccxt BloFin exchange
    // Note: ccxt uses lowercase 'blofin' as the exchange ID
    // PLATFORM FLOOR (perf/platform-floor-v0.1): the limiter stays ON, but its
    // interval is lowered from ccxt's blofin default of 100ms to 10ms.
    //
    // ccxt's throttle is a leaky bucket that NEVER credits idle time
    // (node_modules/ccxt/js/src/base/functions/throttle.js — leakyBucketLoop
    // resets lastTimestamp on every re-entry), so `rateLimit` behaves as a fixed
    // per-call sleep rather than a burst limiter. Measured with zero network
    // involvement (`await ex.throttle(1)` only): 100ms default → ~100ms sleep on
    // every call even after seconds of idle; rateLimit:10 → ~10ms. This adapter
    // feeds the pipeline's ENTRY node, so that sleep blocked all downstream
    // waves on every scored signal in every analyst configuration.
    //
    // 10ms still caps us at ~100 req/s, orders of magnitude above the governed
    // bar cadence, so the limiter keeps doing its job. Candles are unchanged, so
    // this is hash-neutral (no effect on ingestHash/recordHash/replayHash).
    this.exchange = new ccxt.blofin({
      enableRateLimit: true, // Respect rate limits
      rateLimit: 10, // ms between calls (ccxt blofin default is 100)
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

      // Transform ccxt format to our OHLCVCandle type.
      // ccxt types every OHLCV element as `Num` (number | undefined): a
      // venue MAY return a partial bar. toOHLCVCandle REFUSES such a bar
      // rather than repairing it — see the rationale on that function.
      const candles: OHLCVCandle[] = ohlcvData.map(
        (candle: OHLCV, index: number) =>
          toOHLCVCandle(candle, "BloFin", blofinSymbol, index)
      );

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

