/**
 * AFI Candle Type
 *
 * Neutral OHLCV candle format for AFI enrichment pipeline.
 * Compatible with any exchange adapter (BloFin, Coinbase, Demo, etc.).
 */

/**
 * Neutral candle type for AFI enrichment.
 * Compatible with any exchange adapter's OHLCV format.
 */
export interface AfiCandle {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Opening price */
  open: number;
  /** Highest price during the period */
  high: number;
  /** Lowest price during the period */
  low: number;
  /** Closing price */
  close: number;
  /** Trading volume */
  volume: number;
}

