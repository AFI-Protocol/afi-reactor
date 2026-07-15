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
import { coinbasePriceFeedAdapter } from "./coinbasePriceFeedAdapter.js";
import { demoPriceFeedAdapter } from "./demoPriceFeedAdapter.js";

/**
 * Price Feed Adapter Registry
 *
 * Maps price source IDs to adapter instances.
 */
const PRICE_FEED_ADAPTERS: Record<string, PriceFeedAdapter> = {
  blofin: blofinPriceFeedAdapter,
  coinbase: coinbasePriceFeedAdapter,
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
 * Resolves the price source from AFI_PRICE_FEED_SOURCE. There is NO silent
 * fallback to the synthetic "demo" feed for live requests: production runtime
 * MUST select a real source explicitly (blofin | coinbase). If the variable is
 * unset, this fails closed rather than silently scoring on synthetic data. The
 * deterministic synthetic "demo" feed remains available but must be selected
 * explicitly (AFI_PRICE_FEED_SOURCE=demo); as a strictly-test-code convenience it
 * is the implicit source only under NODE_ENV=test.
 *
 * @returns Configured price source ID
 * @throws Error in production runtime when AFI_PRICE_FEED_SOURCE is unset
 */
export function getDefaultPriceSource(): PriceSourceId {
  const configured = process.env.AFI_PRICE_FEED_SOURCE as PriceSourceId | undefined;
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "test") {
    // Strictly test code: default to the deterministic synthetic feed.
    return "demo";
  }
  throw new Error(
    'AFI_PRICE_FEED_SOURCE is required for live scoring (e.g. "blofin" or "coinbase"). ' +
      'The synthetic "demo" feed must be selected explicitly and never serves live ' +
      "requests silently — set AFI_PRICE_FEED_SOURCE explicitly."
  );
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

