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

/**
 * Price Feed Adapter Registry
 *
 * Maps price source IDs to adapter instances. Production registers REAL
 * exchange sources only — there is no synthetic feed in the runtime.
 */
const PRICE_FEED_ADAPTERS: Record<string, PriceFeedAdapter> = {
  blofin: blofinPriceFeedAdapter,
  coinbase: coinbasePriceFeedAdapter,
};

/**
 * TEST-ONLY injection seam: register an additional price-feed adapter (e.g.
 * the deterministic synthetic feed in test/support/) under its own id.
 * REFUSES to run in production — synthetic data can never be registered into
 * a production runtime. Returns an unregister function for suite teardown.
 */
export function registerPriceFeedAdapterForTests(
  adapter: PriceFeedAdapter
): () => void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "registerPriceFeedAdapterForTests is a test-only seam and refuses to run " +
        "under NODE_ENV=production."
    );
  }
  PRICE_FEED_ADAPTERS[adapter.id] = adapter;
  return () => {
    delete PRICE_FEED_ADAPTERS[adapter.id];
  };
}

/**
 * Get Price Feed Adapter
 * 
 * Returns the appropriate price feed adapter for the given source ID.
 * 
 * @param source - Price source ID (e.g., "blofin", "coinbase")
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
 * Resolves the price source from AFI_PRICE_FEED_SOURCE. There is NO fallback
 * of any kind — synthetic or otherwise — and no NODE_ENV-conditional default:
 * the runtime MUST select a real source explicitly (blofin | coinbase). If the
 * variable is unset, this fails closed rather than silently scoring on
 * synthetic data. Tests inject their deterministic feed through
 * registerPriceFeedAdapterForTests and still select it explicitly.
 *
 * @returns Configured price source ID
 * @throws Error when AFI_PRICE_FEED_SOURCE is unset
 */
export function getDefaultPriceSource(): PriceSourceId {
  const configured = process.env.AFI_PRICE_FEED_SOURCE as PriceSourceId | undefined;
  if (configured) {
    return configured;
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

