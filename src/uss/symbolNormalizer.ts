/**
 * Symbol Normalization with Explicit Validation
 * 
 * Hardened symbol parser for CPJ ingestion lane.
 * Enforces canonical BASE/QUOTE format with strict validation.
 * 
 * @module symbolNormalizer
 */

/**
 * Symbol normalization error reasons
 */
export enum SymbolNormalizationError {
  UNRECOGNIZED_SYMBOL_FORMAT = "UNRECOGNIZED_SYMBOL_FORMAT",
  AMBIGUOUS_QUOTE = "AMBIGUOUS_QUOTE",
  INVALID_BASE_CURRENCY = "INVALID_BASE_CURRENCY",
  INVALID_QUOTE_CURRENCY = "INVALID_QUOTE_CURRENCY",
  CONTAINS_FORBIDDEN_CHARS = "CONTAINS_FORBIDDEN_CHARS",
  VENUE_SUFFIX_NOT_STRIPPED = "VENUE_SUFFIX_NOT_STRIPPED",
}

/**
 * Symbol normalization result
 */
export interface SymbolNormalizationResult {
  success: boolean;
  canonical?: string;
  error?: SymbolNormalizationError;
  symbolRaw: string;
  symbolNormalizedAttempt?: string;
  details?: string;
}

/**
 * Canonical symbol format regex: BASE/QUOTE where both are 2+ alphanumeric chars
 */
const CANONICAL_SYMBOL_REGEX = /^[A-Z0-9]{2,}\/[A-Z0-9]{2,}$/;

/**
 * Common quote currencies (ordered by priority for disambiguation)
 */
const QUOTE_CURRENCIES = [
  "USDT", "USDC", "USD", "BUSD", "DAI", "TUSD", // Stablecoins
  "BTC", "ETH", "BNB", "SOL", "AVAX", "MATIC", // Major cryptos
  "EUR", "GBP", "JPY", "AUD", "CAD", // Fiat
];

/**
 * Known "1000" style tokens that should preserve the prefix
 * e.g., 1000PEPE, 1000SHIB, 1000FLOKI
 */
const THOUSAND_STYLE_TOKENS = ["1000PEPE", "1000SHIB", "1000FLOKI", "1000BONK", "1000LUNC"];

/**
 * Normalize raw symbol to canonical BASE/QUOTE format with strict validation
 * 
 * Handles:
 * - Slash format: BTC/USDT → BTC/USDT
 * - Hyphen format: BTC-USD → BTC/USD
 * - Concatenated: BTCUSDT → BTC/USDT
 * - 1000-style: 1000PEPEUSDT → 1000PEPE/USDT
 * - Venue suffixes: BTC/USDT:USDT → BTC/USDT (strips colon suffix)
 * 
 * @param symbolRaw - Raw symbol from third-party source
 * @param venueHint - Optional venue hint (not currently used, reserved for future)
 * @returns Normalization result with canonical symbol or error details
 */
export function normalizeSymbolStrict(
  symbolRaw: string,
  venueHint?: string
): SymbolNormalizationResult {
  const upper = symbolRaw.toUpperCase().trim();

  // Check for forbidden characters (anything not alphanumeric, slash, hyphen, or colon)
  // Note: hyphen must be escaped or at end of character class to avoid range interpretation
  if (/[^A-Z0-9/:\-]/.test(upper)) {
    return {
      success: false,
      symbolRaw,
      error: SymbolNormalizationError.CONTAINS_FORBIDDEN_CHARS,
      details: `Symbol contains forbidden characters: ${symbolRaw}`,
    };
  }

  // Strip venue-specific suffixes (e.g., BTC/USDT:USDT → BTC/USDT)
  let normalized = upper;
  if (normalized.includes(":")) {
    const beforeColon = normalized.split(":")[0];
    normalized = beforeColon;
    // Note: We stripped a colon suffix, will validate the result
  }

  // Already in slash format
  if (normalized.includes("/")) {
    const canonical = normalized;
    if (!CANONICAL_SYMBOL_REGEX.test(canonical)) {
      return {
        success: false,
        symbolRaw,
        symbolNormalizedAttempt: canonical,
        error: SymbolNormalizationError.INVALID_BASE_CURRENCY,
        details: `Symbol does not match canonical format BASE/QUOTE: ${canonical}`,
      };
    }
    return { success: true, canonical, symbolRaw };
  }

  // Handle hyphen-separated format (e.g., BTC-USD)
  if (normalized.includes("-")) {
    const canonical = normalized.replace("-", "/");
    if (!CANONICAL_SYMBOL_REGEX.test(canonical)) {
      return {
        success: false,
        symbolRaw,
        symbolNormalizedAttempt: canonical,
        error: SymbolNormalizationError.INVALID_BASE_CURRENCY,
        details: `Hyphen-separated symbol does not match canonical format: ${canonical}`,
      };
    }
    return { success: true, canonical, symbolRaw };
  }

  // Handle concatenated format (e.g., BTCUSDT, 1000PEPEUSDT)
  // First check for 1000-style tokens
  for (const token of THOUSAND_STYLE_TOKENS) {
    if (normalized.startsWith(token)) {
      const remainder = normalized.slice(token.length);
      if (QUOTE_CURRENCIES.includes(remainder)) {
        const canonical = `${token}/${remainder}`;
        return { success: true, canonical, symbolRaw };
      }
    }
  }

  // Try splitting on known quote currencies
  for (const quote of QUOTE_CURRENCIES) {
    if (normalized.endsWith(quote)) {
      const base = normalized.slice(0, -quote.length);
      if (base.length >= 2) {
        const canonical = `${base}/${quote}`;
        if (CANONICAL_SYMBOL_REGEX.test(canonical)) {
          return { success: true, canonical, symbolRaw };
        }
      }
    }
  }

  // Could not normalize
  return {
    success: false,
    symbolRaw,
    error: SymbolNormalizationError.UNRECOGNIZED_SYMBOL_FORMAT,
    details: `Could not parse symbol into BASE/QUOTE format: ${symbolRaw}`,
  };
}

