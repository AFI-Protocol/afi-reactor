/**
 * Market Type Utilities
 * 
 * Centralized utilities for normalizing market types and mapping to venue types.
 * 
 * AFI Market Type Semantics:
 * - "spot": Spot trading (immediate settlement)
 * - "perp": Perpetual futures (no expiry)
 * - "futures": Dated futures contracts
 * 
 * Venue Type Semantics:
 * - "crypto_spot": Cryptocurrency spot markets
 * - "crypto_perps": Cryptocurrency perpetual futures
 * - "crypto_futures": Cryptocurrency dated futures
 * - "demo": Demo/mock data (for testing)
 * 
 * @module marketUtils
 */

/**
 * AFI canonical market types
 */
export type AfiMarketType = "spot" | "perp" | "futures";

/**
 * Venue types for provenance tracking
 */
export type VenueType = "crypto_spot" | "crypto_perps" | "crypto_futures" | "demo";

/**
 * Normalize market type input to AFI canonical format
 * 
 * Handles common variations and defaults to "spot" if invalid.
 * 
 * @param input - Raw market type string from request/config
 * @returns Normalized AFI market type
 * 
 * @example
 * normalizeMarketType("perp")    // "perp"
 * normalizeMarketType("perps")   // "perp"
 * normalizeMarketType("SPOT")    // "spot"
 * normalizeMarketType("future")  // "futures"
 * normalizeMarketType(undefined) // "spot" (default)
 */
export function normalizeMarketType(input?: string): AfiMarketType {
  if (!input) {
    return "spot"; // Default to spot if not specified
  }

  const normalized = input.toLowerCase().trim();

  // Handle common variations
  if (normalized === "perp" || normalized === "perps" || normalized === "perpetual") {
    return "perp";
  }

  if (normalized === "spot") {
    return "spot";
  }

  if (normalized === "futures" || normalized === "future") {
    return "futures";
  }

  // Default to spot for unknown values
  console.warn(`⚠️  Unknown market type "${input}", defaulting to "spot"`);
  return "spot";
}

/**
 * Map AFI market type to venue type for provenance tracking
 * 
 * @param marketType - Normalized AFI market type
 * @param isDemo - Whether this is demo/mock data (overrides market type)
 * @returns Venue type for TSSD provenance
 * 
 * @example
 * mapMarketTypeToVenueType("spot")    // "crypto_spot"
 * mapMarketTypeToVenueType("perp")    // "crypto_perps"
 * mapMarketTypeToVenueType("futures") // "crypto_futures"
 * mapMarketTypeToVenueType("spot", true) // "demo"
 */
export function mapMarketTypeToVenueType(
  marketType: AfiMarketType,
  isDemo: boolean = false
): VenueType {
  // Demo data always uses "demo" venue type
  if (isDemo) {
    return "demo";
  }

  // Map market type to venue type
  switch (marketType) {
    case "spot":
      return "crypto_spot";
    case "perp":
      return "crypto_perps";
    case "futures":
      return "crypto_futures";
    default:
      console.warn(`⚠️  Unknown market type "${marketType}", defaulting to "crypto_spot"`);
      return "crypto_spot";
  }
}

