/**
 * Exchange Price Feed Adapter Types
 * 
 * Defines the interface for exchange price feed adapters (BloFin, Coinbase, etc.)
 * and common types for OHLCV candles, tickers, and price data.
 * 
 * This abstraction allows AFI to support multiple exchanges without tight coupling.
 */

/**
 * OHLCV Candle
 * 
 * Standard candlestick data structure used across all exchanges.
 * Timestamps are in milliseconds since epoch (Unix timestamp * 1000).
 */
export interface OHLCVCandle {
  /** Timestamp (ms since epoch) */
  timestamp: number;
  
  /** Open price */
  open: number;
  
  /** High price */
  high: number;
  
  /** Low price */
  low: number;
  
  /** Close price */
  close: number;
  
  /** Volume */
  volume: number;
}

/**
 * Raised when a venue returns a candle that is not fully populated.
 *
 * ccxt types every OHLCV element as `Num` (`number | undefined`) because a
 * venue MAY return a partial bar. AFI refuses such a bar rather than repairing
 * it: defaulting a missing price to 0 or carrying the previous bar forward
 * would invent market data, and the resulting score would be indistinguishable
 * from one derived from real data.
 */
export class PartialCandleError extends Error {
  constructor(
    readonly venue: string,
    readonly symbol: string,
    readonly index: number,
    readonly field: keyof OHLCVCandle,
    readonly received: unknown
  ) {
    super(
      `${venue}: candle[${index}].${field} is not a finite number ` +
        `(received ${String(received)}) for ${symbol} — refusing the series ` +
        `rather than substituting a value`
    );
    this.name = "PartialCandleError";
  }
}

/**
 * Convert one ccxt OHLCV tuple to an OHLCVCandle, refusing anything non-finite.
 *
 * This is the boundary where market data enters the scoring pipeline, and it is
 * the only place a missing value can be detected cheaply and attributed to its
 * source. Downstream it becomes undiagnosable: `EMA.update(undefined)` returns
 * `NaN` silently (verified), `NaN == null` is false so the indicator-bundle
 * presence check passes it, comparisons then launder it into plausible values
 * (`trendBias` → "range", `isInValueSweetSpot` → false), and the canonical-hash
 * finiteness policy never sees it because the enrichment bundle is round-tripped
 * through `JSON.stringify`, which rewrites `NaN` to `null`.
 *
 * @throws {PartialCandleError} if any element is absent, NaN, or infinite.
 */
export function toOHLCVCandle(
  tuple: ReadonlyArray<number | undefined>,
  venue: string,
  symbol: string,
  index: number
): OHLCVCandle {
  const fields: ReadonlyArray<keyof OHLCVCandle> = [
    "timestamp",
    "open",
    "high",
    "low",
    "close",
    "volume",
  ];
  for (let i = 0; i < fields.length; i++) {
    const value = tuple[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new PartialCandleError(venue, symbol, index, fields[i]!, value);
    }
  }
  return {
    timestamp: tuple[0]!,
    open: tuple[1]!,
    high: tuple[2]!,
    low: tuple[3]!,
    close: tuple[4]!,
    volume: tuple[5]!,
  };
}

/**
 * Ticker Snapshot
 *
 * Real-time price snapshot for a trading pair.
 */
export interface TickerSnapshot {
  /** Trading pair symbol (e.g., "BTC/USDT") */
  symbol: string;
  
  /** Last traded price */
  last: number;
  
  /** Best bid price */
  bid?: number;
  
  /** Best ask price */
  ask?: number;
  
  /** 24h volume in base currency */
  volume24h?: number;
  
  /** 24h price change percentage */
  change24h?: number;
  
  /** Timestamp of the ticker (ms since epoch) */
  timestamp: number;
}

/**
 * Price Feed Adapter Interface
 * 
 * All exchange adapters must implement this interface.
 * Provides a consistent API for fetching OHLCV and ticker data.
 */
export interface PriceFeedAdapter {
  /** Unique identifier for this adapter (e.g., "blofin", "coinbase") */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Whether this adapter supports perpetual futures */
  supportsPerps: boolean;
  
  /** Whether this adapter supports spot markets */
  supportsSpot: boolean;
  
  /**
   * Fetch OHLCV candles for a symbol
   * 
   * @param params - OHLCV fetch parameters
   * @returns Array of OHLCV candles, sorted by timestamp ascending
   */
  getOHLCV(params: {
    symbol: string;         // e.g., "BTC/USDT"
    timeframe: string;      // e.g., "1m", "5m", "1h", "1d"
    since?: number;         // ms since epoch (optional)
    limit?: number;         // max number of candles (optional)
  }): Promise<OHLCVCandle[]>;
  
  /**
   * Fetch current ticker snapshot for a symbol
   * 
   * @param symbol - Trading pair symbol (e.g., "BTC/USDT")
   * @returns Current ticker snapshot
   */
  getTicker(symbol: string): Promise<TickerSnapshot>;
}

/**
 * Price Source ID
 * 
 * Identifies which price feed source to use.
 * "blofin" = BloFin exchange
 * "coinbase" = Coinbase (future)
 * (Tests may inject additional sources via registerPriceFeedAdapterForTests.)
 */
export type PriceSourceId = "blofin" | "coinbase" | string;

/**
 * Venue Type
 * 
 * Categorizes the type of trading venue.
 */
export type VenueType = "crypto_perps" | "crypto_spot" | "equity" | "forex" | "demo";

/**
 * Price Feed Metadata
 * 
 * Metadata about the price feed source used for a signal.
 * This is stored in TSSD vault for provenance tracking.
 */
export interface PriceFeedMetadata {
  /** Price source ID (e.g., "blofin", "coinbase") */
  priceSource: PriceSourceId;
  
  /** Venue type (e.g., "crypto_perps", "crypto_spot") */
  venueType: VenueType;
  
  /** Exchange-specific market identifier (optional) */
  marketId?: string;
  
  /** Timestamp when price data was fetched (ms since epoch) */
  fetchedAt: number;
}

