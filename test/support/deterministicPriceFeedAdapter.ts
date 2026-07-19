/**
 * Deterministic synthetic price-feed adapter (TEST-ONLY; selected by
 * AFI_PRICE_FEED_SOURCE=demo after being injected through
 * registerPriceFeedAdapterForTests — production source contains no synthetic
 * feed and refuses the injection seam under NODE_ENV=production).
 *
 * The implementation below is the byte-stable former src demo adapter, moved
 * verbatim so the committed oracle goldens (priceSource:"demo" provenance and
 * all derived indicator bytes) remain unchanged.
 *
 * Generates synthetic OHLCV / ticker data as a DETERMINISTIC function of the
 * governed request inputs (symbol + timeframe): NO wall-clock (Date.now) and NO
 * Math.random. The same request therefore yields byte-identical candles, so the
 * downstream scored signal — and the canonical afi.scored-signal-evidence.v3
 * record built from it — is reproducible and endpoint submissions are idempotent
 * (a request-time-random feed made the record nondeterministic → spurious 409s).
 *
 * This is NOT a real exchange and does NOT connect to one; production selects a
 * real source (AFI_PRICE_FEED_SOURCE=blofin|coinbase). The response openly stamps
 * priceSource:"demo" so a synthetic source is never presented as real.
 */

import type {
  PriceFeedAdapter,
  OHLCVCandle,
  TickerSnapshot,
} from "../../src/adapters/exchanges/types.js";

/** FNV-1a 32-bit string hash → deterministic PRNG seed (no wall clock). */
function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny deterministic PRNG. Same seed ⇒ same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fixed synthetic-candle time anchor (2025-01-01T00:00:00Z). Deterministic by
 * construction — candle timestamps derive from this constant + the timeframe,
 * never from the wall clock. Candle timestamps are excluded from the canonical
 * evidence record; only the price-derived indicators feed the score.
 */
const DEMO_TIME_ANCHOR_MS = 1735689600000;

/**
 * Deterministic Synthetic Price Feed Adapter
 *
 * Generates plausible synthetic data derived only from the request inputs.
 * Does NOT connect to any real exchange.
 */
class DemoPriceFeedAdapter implements PriceFeedAdapter {
  public readonly id = "demo";
  public readonly name = "Deterministic Synthetic (non-production)";
  public readonly supportsPerps = true;
  public readonly supportsSpot = true;

  /**
   * Generate deterministic synthetic OHLCV candles.
   *
   * Prices are a pure function of (symbol, timeframe, limit) via a seeded PRNG,
   * so repeated requests for the same signal return identical candles.
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

    // Deterministic PRNG seeded from the governed request inputs.
    const rand = mulberry32(seedFromString(`${symbol}|${timeframe}|${limit}`));

    // Generate candles
    const candles: OHLCVCandle[] = [];
    const timeframeMs = this.parseTimeframeToMs(timeframe);

    for (let i = limit - 1; i >= 0; i--) {
      const timestamp = DEMO_TIME_ANCHOR_MS - i * timeframeMs;
      const open = basePrice + (rand() - 0.5) * basePrice * 0.02;
      const close = open + (rand() - 0.5) * open * 0.01;
      const high = Math.max(open, close) + rand() * open * 0.005;
      const low = Math.min(open, close) - rand() * open * 0.005;
      const volume = 100 + rand() * 900;

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
   * Generate a deterministic synthetic ticker snapshot.
   */
  async getTicker(symbol: string): Promise<TickerSnapshot> {
    const basePrice = this.getBasePriceForSymbol(symbol);
    const rand = mulberry32(seedFromString(`ticker|${symbol}`));
    const last = basePrice + (rand() - 0.5) * basePrice * 0.01;
    const spread = last * 0.0001; // 0.01% spread

    return {
      symbol,
      last,
      bid: last - spread / 2,
      ask: last + spread / 2,
      volume24h: 10000 + rand() * 90000,
      change24h: (rand() - 0.5) * 10, // -5% to +5%
      timestamp: DEMO_TIME_ANCHOR_MS,
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

