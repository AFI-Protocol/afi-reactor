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
 * "demo" = mock data (current behavior)
 * "blofin" = BloFin exchange
 * "coinbase" = Coinbase (future)
 */
export type PriceSourceId = "demo" | "blofin" | "coinbase" | string;

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
  /** Price source ID (e.g., "blofin", "demo") */
  priceSource: PriceSourceId;
  
  /** Venue type (e.g., "crypto_perps", "crypto_spot") */
  venueType: VenueType;
  
  /** Exchange-specific market identifier (optional) */
  marketId?: string;
  
  /** Timestamp when price data was fetched (ms since epoch) */
  fetchedAt: number;
}

