/**
 * Symbol Registry
 * 
 * Centralized symbol normalization and mapping for AFI Reactor.
 * 
 * AFI uses canonical symbol format: "BASE/QUOTE" (e.g., "BTC/USDT")
 * Each exchange/venue may have its own format requirements.
 * This registry handles bidirectional mapping between AFI canonical and venue-specific formats.
 * 
 * Design Principles:
 * - AFI canonical format is "BASE/QUOTE" (e.g., "BTC/USDT", "ETH/USDC")
 * - Venue-specific formats are handled internally by adapters
 * - Symbol parsing is simple and deterministic
 * - Future: Support for more complex mappings (e.g., inverse pairs, exotic venues)
 */

/**
 * Supported venue identifiers
 */
export type VenueId = 'blofin' | 'demo' | 'coinbase';

/**
 * Market type (spot vs derivatives)
 */
export type MarketType = 'spot' | 'perp' | 'futures';

/**
 * Canonical symbol representation
 */
export interface CanonicalSymbol {
  base: string;   // e.g., "BTC"
  quote: string;  // e.g., "USDT"
}

/**
 * Parse AFI canonical symbol into components
 * 
 * @param symbol - AFI canonical symbol (e.g., "BTC/USDT")
 * @returns Parsed symbol components
 * @throws Error if symbol format is invalid
 * 
 * @example
 * parseCanonicalSymbol("BTC/USDT") // { base: "BTC", quote: "USDT" }
 * parseCanonicalSymbol("ETH/USDC") // { base: "ETH", quote: "USDC" }
 */
export function parseCanonicalSymbol(symbol: string): CanonicalSymbol {
  if (!symbol || typeof symbol !== 'string') {
    throw new Error(`Invalid symbol: expected non-empty string, got ${typeof symbol}`);
  }

  const parts = symbol.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid canonical symbol format: "${symbol}". Expected "BASE/QUOTE" (e.g., "BTC/USDT")`);
  }

  const [base, quote] = parts;
  if (!base || !quote) {
    throw new Error(`Invalid canonical symbol: "${symbol}". Both base and quote must be non-empty`);
  }

  return { base: base.trim().toUpperCase(), quote: quote.trim().toUpperCase() };
}

/**
 * Convert AFI canonical symbol to venue-specific format
 * 
 * @param params - Conversion parameters
 * @param params.venue - Target venue identifier
 * @param params.canonical - AFI canonical symbol (e.g., "BTC/USDT")
 * @param params.marketType - Market type (spot, perp, futures)
 * @returns Venue-specific symbol format
 * 
 * @example
 * // BloFin perps use "BASE/QUOTE:SETTLEMENT" format
 * toVenueSymbol({ venue: 'blofin', canonical: 'BTC/USDT', marketType: 'perp' })
 * // Returns: "BTC/USDT:USDT"
 * 
 * // Demo adapter uses canonical format directly
 * toVenueSymbol({ venue: 'demo', canonical: 'BTC/USDT', marketType: 'spot' })
 * // Returns: "BTC/USDT"
 */
export function toVenueSymbol(params: {
  venue: VenueId;
  canonical: string;
  marketType?: MarketType;
}): string {
  const { venue, canonical, marketType = 'perp' } = params;

  // Parse canonical symbol to validate format
  const parsed = parseCanonicalSymbol(canonical);

  switch (venue) {
    case 'blofin':
      return toBloFinSymbol(parsed, marketType);
    
    case 'demo':
      // Demo adapter uses canonical format directly
      return canonical;
    
    case 'coinbase':
      // Coinbase uses "BASE-QUOTE" format (hyphen instead of slash)
      // TODO: Implement when Coinbase adapter is added
      return `${parsed.base}-${parsed.quote}`;
    
    default:
      // Unknown venue - return canonical format as fallback
      console.warn(`Unknown venue "${venue}", using canonical symbol format`);
      return canonical;
  }
}

/**
 * Convert canonical symbol to BloFin-specific format
 * 
 * BloFin uses different formats for spot vs perps:
 * - Spot: "BASE/QUOTE" (same as canonical)
 * - Perps: "BASE/QUOTE:SETTLEMENT" (e.g., "BTC/USDT:USDT")
 * 
 * @param parsed - Parsed canonical symbol
 * @param marketType - Market type
 * @returns BloFin-specific symbol
 */
function toBloFinSymbol(parsed: CanonicalSymbol, marketType: MarketType): string {
  const { base, quote } = parsed;

  if (marketType === 'spot') {
    // BloFin spot uses canonical format
    return `${base}/${quote}`;
  }

  // BloFin perps use "BASE/QUOTE:SETTLEMENT" format
  // For USDT and USDC pairs, settlement currency is the same as quote
  if (marketType === 'perp' || marketType === 'futures') {
    return `${base}/${quote}:${quote}`;
  }

  // Fallback to canonical
  return `${base}/${quote}`;
}

/**
 * Convert venue-specific symbol back to AFI canonical format
 * 
 * @param params - Conversion parameters
 * @param params.venue - Source venue identifier
 * @param params.venueSymbol - Venue-specific symbol
 * @returns AFI canonical symbol
 * 
 * @example
 * fromVenueSymbol({ venue: 'blofin', venueSymbol: 'BTC/USDT:USDT' })
 * // Returns: "BTC/USDT"
 */
export function fromVenueSymbol(params: {
  venue: VenueId;
  venueSymbol: string;
}): string {
  const { venue, venueSymbol } = params;

  switch (venue) {
    case 'blofin':
      // BloFin perps: "BTC/USDT:USDT" → "BTC/USDT"
      return venueSymbol.split(':')[0];
    
    case 'demo':
      // Demo uses canonical format
      return venueSymbol;
    
    case 'coinbase':
      // Coinbase: "BTC-USDT" → "BTC/USDT"
      return venueSymbol.replace('-', '/');
    
    default:
      return venueSymbol;
  }
}

