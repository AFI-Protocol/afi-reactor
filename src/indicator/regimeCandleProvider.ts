/**
 * Regime Candle Provider
 *
 * Provides OHLC candles for Pattern Regime computation with:
 * - Multiple provider support (Blofin, Coinbase, CoinGecko)
 * - Lightweight caching (TTL-based)
 * - Graceful fallback handling
 * - Kill-switch for CoinGecko (for tests)
 *
 * Environment Variables:
 * - PATTERN_REGIME_PROVIDER: blofin|coinbase|coingecko|off (default: blofin)
 * - PATTERN_REGIME_TIMEFRAME: 4h|1d|etc (default: 4h)
 * - PATTERN_REGIME_LOOKBACK_DAYS: number (default: 90)
 * - PATTERN_REGIME_CACHE_TTL_MINUTES: number (default: 15)
 */

import { getPriceFeedAdapter } from "../adapters/exchanges/priceFeedRegistry.js";
import type { OHLCVCandle } from "../adapters/exchanges/types.js";
import {
  fetchCoinGeckoOhlc,
  mapSymbolToCoinGeckoId,
  type CoinGeckoOhlcCandle,
} from "../adapters/coingecko/coingeckoClient.js";

/**
 * Regime Candle (normalized format)
 */
export interface RegimeCandle {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Provider type
 */
export type RegimeProvider = "blofin" | "coinbase" | "coingecko" | "off";

/**
 * Cache entry
 */
interface CacheEntry {
  candles: RegimeCandle[];
  expiresAt: number;
}

/**
 * In-memory cache (symbol+timeframe → candles)
 */
const cache = new Map<string, CacheEntry>();

/**
 * Get configuration from environment
 */
function getConfig() {
  const provider = (process.env.PATTERN_REGIME_PROVIDER || "blofin") as RegimeProvider;
  const timeframe = process.env.PATTERN_REGIME_TIMEFRAME || "4h";
  const lookbackDays = parseInt(process.env.PATTERN_REGIME_LOOKBACK_DAYS || "90", 10);
  const cacheTtlMinutes = parseInt(process.env.PATTERN_REGIME_CACHE_TTL_MINUTES || "15", 10);

  return { provider, timeframe, lookbackDays, cacheTtlMinutes };
}

/**
 * Normalize symbol for exchange providers
 * 
 * Converts TradingView symbols like "BTCUSDT.P" to exchange format "BTC/USDT"
 */
function normalizeSymbol(symbol: string): string {
  // Strip .P suffix (TradingView perp indicator)
  let normalized = symbol.replace(/\.P$/i, "");
  
  // If already has slash, return as-is
  if (normalized.includes("/")) {
    return normalized.toUpperCase();
  }
  
  // Common quote currencies (order matters - check longer ones first)
  const quotes = ["USDT", "USDC", "USD", "BTC", "ETH"];
  
  for (const quote of quotes) {
    if (normalized.toUpperCase().endsWith(quote)) {
      const base = normalized.slice(0, -quote.length);
      return `${base}/${quote}`.toUpperCase();
    }
  }
  
  // Fallback: assume USDT
  return `${normalized}/USDT`.toUpperCase();
}

/**
 * Fetch candles from Blofin or Coinbase
 */
async function fetchFromExchange(
  provider: "blofin" | "coinbase",
  symbol: string,
  timeframe: string,
  lookbackDays: number
): Promise<RegimeCandle[]> {
  const adapter = getPriceFeedAdapter(provider);
  
  // Calculate since timestamp (lookbackDays ago)
  const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  
  // Normalize symbol (BTCUSDT.P → BTC/USDT)
  const normalizedSymbol = normalizeSymbol(symbol);
  
  console.log(
    `🔍 Regime Candles: Fetching from ${provider} - ${normalizedSymbol} ${timeframe} (${lookbackDays}d)`
  );
  
  const candles = await adapter.getOHLCV({
    symbol: normalizedSymbol,
    timeframe,
    since,
    limit: 500, // Max limit to ensure we get enough data
  });
  
  // Convert to RegimeCandle format
  return candles.map((c) => ({
    timestampMs: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

/**
 * Fetch candles from CoinGecko (legacy fallback)
 */
async function fetchFromCoinGecko(
  symbol: string,
  lookbackDays: number
): Promise<RegimeCandle[]> {
  const coinId = mapSymbolToCoinGeckoId(symbol);
  
  console.log(
    `🔍 Regime Candles: Fetching from CoinGecko - ${coinId} (${lookbackDays}d)`
  );
  
  const candles = await fetchCoinGeckoOhlc(coinId, "usd", lookbackDays);
  
  // Already in RegimeCandle format
  return candles;
}

/**
 * Fetch regime candles with caching
 * 
 * @param symbol - Trading symbol (e.g., "BTCUSDT.P", "BTC/USDT")
 * @returns Array of regime candles or empty array if provider is "off" or fetch fails
 */
export async function fetchRegimeCandles(symbol: string): Promise<RegimeCandle[]> {
  const { provider, timeframe, lookbackDays, cacheTtlMinutes } = getConfig();

  // Kill-switch: return empty array if provider is "off"
  if (provider === "off") {
    console.log(`⚠️  Regime Candles: Provider is "off", skipping fetch`);
    return [];
  }

  // Check cache
  const cacheKey = `${symbol}:${timeframe}:${lookbackDays}:${provider}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    console.log(`✅ Regime Candles: Cache hit for ${cacheKey}`);
    return cached.candles;
  }

  // Fetch from provider
  try {
    let candles: RegimeCandle[] = [];

    if (provider === "blofin" || provider === "coinbase") {
      candles = await fetchFromExchange(provider, symbol, timeframe, lookbackDays);
    } else if (provider === "coingecko") {
      candles = await fetchFromCoinGecko(symbol, lookbackDays);
    }

    // Cache the result
    const expiresAt = Date.now() + cacheTtlMinutes * 60 * 1000;
    cache.set(cacheKey, { candles, expiresAt });

    console.log(
      `✅ Regime Candles: Fetched ${candles.length} candles from ${provider} (cached for ${cacheTtlMinutes}m)`
    );

    return candles;
  } catch (error) {
    console.error(
      `❌ Regime Candles: Failed to fetch from ${provider}:`,
      error instanceof Error ? error.message : String(error)
    );

    // Return empty array on error (graceful degradation)
    return [];
  }
}

/**
 * Clear the cache (useful for testing)
 */
export function clearRegimeCandleCache(): void {
  cache.clear();
  console.log(`🗑️  Regime Candles: Cache cleared`);
}

