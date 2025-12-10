/**
 * Price Feed Registry
 * 
 * Central registry for price feed adapters.
 * Maps price source IDs to concrete adapter implementations.
 * 
 * Usage:
 *   const adapter = getPriceFeedAdapter("blofin");
 *   const candles = await adapter.getOHLCV({ symbol: "BTC/USDT", timeframe: "1h", limit: 50 });
 */

import type { PriceFeedAdapter, PriceSourceId } from "./types.js";
import { blofinPriceFeedAdapter } from "./blofinPriceFeedAdapter.js";
import { demoPriceFeedAdapter } from "./demoPriceFeedAdapter.js";

/**
 * Price Feed Adapter Registry
 * 
 * Maps price source IDs to adapter instances.
 */
const PRICE_FEED_ADAPTERS: Record<string, PriceFeedAdapter> = {
  blofin: blofinPriceFeedAdapter,
  demo: demoPriceFeedAdapter,
};

/**
 * Get Price Feed Adapter
 * 
 * Returns the appropriate price feed adapter for the given source ID.
 * 
 * @param source - Price source ID (e.g., "blofin", "demo")
 * @returns Price feed adapter instance
 * @throws Error if source is not supported
 */
export function getPriceFeedAdapter(source: PriceSourceId): PriceFeedAdapter {
  const adapter = PRICE_FEED_ADAPTERS[source];
  
  if (!adapter) {
    const supportedSources = Object.keys(PRICE_FEED_ADAPTERS).join(", ");
    throw new Error(
      `Unsupported price source: "${source}". Supported sources: ${supportedSources}`
    );
  }
  
  return adapter;
}

/**
 * Get Default Price Source
 * 
 * Returns the default price source based on environment configuration.
 * Falls back to "demo" if AFI_PRICE_FEED_SOURCE is not set.
 * 
 * @returns Default price source ID
 */
export function getDefaultPriceSource(): PriceSourceId {
  return (process.env.AFI_PRICE_FEED_SOURCE as PriceSourceId) || "demo";
}

/**
 * List Available Price Sources
 * 
 * Returns a list of all registered price source IDs.
 * 
 * @returns Array of price source IDs
 */
export function listAvailablePriceSources(): PriceSourceId[] {
  return Object.keys(PRICE_FEED_ADAPTERS);
}

