/**
 * Demo Price Feed Adapter
 * 
 * Generates mock OHLCV and ticker data for demo/testing purposes.
 * This is the default adapter when AFI_PRICE_FEED_SOURCE is not set.
 * 
 * Maintains backward compatibility with existing demo behavior.
 */

import type { PriceFeedAdapter, OHLCVCandle, TickerSnapshot } from "./types.js";

/**
 * Demo Price Feed Adapter
 * 
 * Generates plausible mock data for development and testing.
 * Does NOT connect to any real exchange.
 */
class DemoPriceFeedAdapter implements PriceFeedAdapter {
  public readonly id = "demo";
  public readonly name = "Demo (Mock Data)";
  public readonly supportsPerps = true;
  public readonly supportsSpot = true;

  /**
   * Generate mock OHLCV candles
   * 
   * Creates realistic-looking candles with random price movements.
   */
  async getOHLCV(params: {
    symbol: string;
    timeframe: string;
    since?: number;
    limit?: number;
  }): Promise<OHLCVCandle[]> {
    const { symbol, timeframe, limit = 50 } = params;

    // Base price depends on symbol
    const basePrice = this.getBasePriceForSymbol(symbol);
    
    // Generate candles
    const candles: OHLCVCandle[] = [];
    const now = Date.now();
    const timeframeMs = this.parseTimeframeToMs(timeframe);

    for (let i = limit - 1; i >= 0; i--) {
      const timestamp = now - i * timeframeMs;
      const open = basePrice + (Math.random() - 0.5) * basePrice * 0.02;
      const close = open + (Math.random() - 0.5) * open * 0.01;
      const high = Math.max(open, close) + Math.random() * open * 0.005;
      const low = Math.min(open, close) - Math.random() * open * 0.005;
      const volume = 100 + Math.random() * 900;

      candles.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    return candles;
  }

  /**
   * Generate mock ticker snapshot
   */
  async getTicker(symbol: string): Promise<TickerSnapshot> {
    const basePrice = this.getBasePriceForSymbol(symbol);
    const last = basePrice + (Math.random() - 0.5) * basePrice * 0.01;
    const spread = last * 0.0001; // 0.01% spread

    return {
      symbol,
      last,
      bid: last - spread / 2,
      ask: last + spread / 2,
      volume24h: 10000 + Math.random() * 90000,
      change24h: (Math.random() - 0.5) * 10, // -5% to +5%
      timestamp: Date.now(),
    };
  }

  /**
   * Get base price for a symbol (for realistic mock data)
   */
  private getBasePriceForSymbol(symbol: string): number {
    const symbolUpper = symbol.toUpperCase();
    
    if (symbolUpper.includes("BTC")) return 50000;
    if (symbolUpper.includes("ETH")) return 3000;
    if (symbolUpper.includes("SOL")) return 100;
    if (symbolUpper.includes("AVAX")) return 30;
    
    return 100; // Default
  }

  /**
   * Parse timeframe string to milliseconds
   */
  private parseTimeframeToMs(timeframe: string): number {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1), 10);

    switch (unit) {
      case "m": return value * 60 * 1000;
      case "h": return value * 60 * 60 * 1000;
      case "d": return value * 24 * 60 * 60 * 1000;
      case "w": return value * 7 * 24 * 60 * 60 * 1000;
      default: return 60 * 60 * 1000; // Default to 1h
    }
  }
}

// Export singleton instance
export const demoPriceFeedAdapter = new DemoPriceFeedAdapter();

// Export class for testing
export { DemoPriceFeedAdapter };

