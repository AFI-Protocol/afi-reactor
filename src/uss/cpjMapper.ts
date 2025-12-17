/**
 * CPJ to USS v1.1 Mapper
 * 
 * Converts Canonical Parsed JSON (CPJ) v0.1 payloads from third-party sources
 * (Telegram/Discord) to canonical USS v1.1 format.
 * 
 * This is the second normalization stage:
 * 1. CPJ v0.1: Source-faithful parsed object + provenance + parse confidence
 * 2. USS v1.1: Standardized AFI Universal Signal Schema
 * 
 * @module cpjMapper
 */

import crypto from "crypto";
import { UssV11Payload } from "./ussValidator.js";
import { CpjV01Payload } from "../cpj/cpjValidator.js";
import { normalizeMarketType } from "../utils/marketUtils.js";
import {
  normalizeSymbolStrict,
  type SymbolNormalizationResult,
  SymbolNormalizationError,
} from "./symbolNormalizer.js";

/**
 * CPJ to USS mapping result
 */
export interface CpjMappingResult {
  success: boolean;
  uss?: UssV11Payload;
  error?: {
    type: "symbol_normalization_failed";
    symbolRaw: string;
    symbolNormalizedAttempt?: string;
    reason: SymbolNormalizationError;
    details?: string;
  };
}

/**
 * Normalize raw symbol to AFI canonical format (BASE/QUOTE)
 * 
 * Handles common variations:
 * - BTCUSDT → BTC/USDT
 * - BTC-USD → BTC/USD
 * - SOLUSDT → SOL/USDT
 * - ETH-USDC → ETH/USDC
 * 
 * @param symbolRaw - Raw symbol from third-party source
 * @param venueHint - Optional venue hint to guide normalization
 * @returns Canonical AFI symbol format (BASE/QUOTE)
 */
function normalizeSymbol(symbolRaw: string, venueHint?: string): string {
  // Already in canonical format (contains slash)
  if (symbolRaw.includes("/")) {
    return symbolRaw.toUpperCase();
  }

  // Handle hyphen-separated format (e.g., BTC-USD, SOL-USDC)
  if (symbolRaw.includes("-")) {
    return symbolRaw.replace("-", "/").toUpperCase();
  }

  // Handle concatenated format (e.g., BTCUSDT, SOLUSDT)
  // Common quote currencies to try splitting on
  const quotePatterns = ["USDT", "USD", "USDC", "BTC", "ETH"];
  
  for (const quote of quotePatterns) {
    if (symbolRaw.toUpperCase().endsWith(quote)) {
      const base = symbolRaw.slice(0, -quote.length);
      if (base.length > 0) {
        return `${base.toUpperCase()}/${quote}`;
      }
    }
  }

  // Fallback: assume it's already in some valid format
  console.warn(`⚠️  Could not normalize symbol "${symbolRaw}", using as-is`);
  return symbolRaw.toUpperCase();
}

/**
 * Normalize side/direction to USS v1.1 format
 *
 * CPJ uses: "long" | "short" | "buy" | "sell" | "neutral"
 * USS uses: "long" | "short" | "neutral"
 *
 * @param side - CPJ side value
 * @returns USS direction value
 */
function normalizeSide(side: string): "long" | "short" | "neutral" {
  const normalized = side.toLowerCase();

  if (normalized === "buy" || normalized === "long") {
    return "long";
  }

  if (normalized === "sell" || normalized === "short") {
    return "short";
  }

  return "neutral";
}

/**
 * Map CPJ providerType to USS v1.1 providerType enum
 *
 * USS v1.1 schema only allows: ["tradingview", "manual", "bot", "mcp", "api", "other"]
 * CPJ providerTypes like "telegram", "discord" should map to "bot"
 *
 * @param cpjProviderType - CPJ providerType value
 * @returns USS providerType value
 */
function mapProviderType(cpjProviderType: string): string {
  const lower = cpjProviderType.toLowerCase();

  // Map messaging platforms to "bot"
  if (lower === "telegram" || lower === "discord" || lower === "slack") {
    return "bot";
  }

  // Map known USS types directly
  if (["tradingview", "manual", "bot", "mcp", "api"].includes(lower)) {
    return lower;
  }

  // Default to "other" for unknown types
  return "other";
}

/**
 * Generate a deterministic signal ID from CPJ payload
 * 
 * Format: cpj-{providerType}-{providerId}-{messageId}
 * Example: cpj-telegram-channel123-msg789
 */
function generateSignalId(cpj: CpjV01Payload): string {
  const providerType = cpj.provenance.providerType;
  const providerId = cpj.provenance.providerId.replace(/[^a-zA-Z0-9-]/g, "");
  const messageId = cpj.provenance.messageId.replace(/[^a-zA-Z0-9-]/g, "");
  
  return `cpj-${providerType}-${providerId}-${messageId}`;
}

/**
 * Canonicalize CPJ fields for deterministic hashing
 *
 * This function normalizes semantically equivalent representations to ensure
 * duplicate detection works correctly.
 *
 * Canonicalization rules:
 * - Entry ranges: normalize to {min, max} with min <= max
 * - Take profit arrays: sort by price ascending
 * - Stop loss arrays: sort by price ascending (if array)
 * - Object keys: sorted alphabetically (deep)
 *
 * @param cpj - Validated CPJ v0.1 payload
 * @returns Canonicalized copy of CPJ (does not mutate original)
 */
function canonicalizeCpjForHashing(cpj: CpjV01Payload): any {
  // Deep clone to avoid mutating original
  const clone = JSON.parse(JSON.stringify(cpj));

  // Canonicalize entry field
  if (clone.extracted?.entry) {
    const entry = clone.extracted.entry;

    // If entry is an object with min/max, ensure min <= max
    if (typeof entry === "object" && !Array.isArray(entry)) {
      if (entry.min !== undefined && entry.max !== undefined) {
        const [min, max] = [entry.min, entry.max].sort((a, b) => a - b);
        clone.extracted.entry = { min, max };
      }
    }
  }

  // Canonicalize takeProfits array (sort by price ascending)
  if (Array.isArray(clone.extracted?.takeProfits)) {
    clone.extracted.takeProfits = clone.extracted.takeProfits
      .slice() // Copy array
      .sort((a, b) => {
        const priceA = typeof a === "object" ? a.price : a;
        const priceB = typeof b === "object" ? b.price : b;
        return priceA - priceB;
      });
  }

  // Canonicalize stopLoss if it's an array (sort ascending)
  if (Array.isArray(clone.extracted?.stopLoss)) {
    clone.extracted.stopLoss = clone.extracted.stopLoss
      .slice()
      .sort((a, b) => a - b);
  }

  return clone;
}

/**
 * Generate a deterministic SHA256 hash of the CPJ payload for integrity verification
 *
 * Normalization rules for deterministic hashing:
 * - Object keys are sorted alphabetically (deep)
 * - Entry ranges normalized to {min, max} with min <= max
 * - Take profit arrays sorted by price ascending
 * - Stop loss arrays sorted ascending (if array)
 * - Whitespace is normalized via JSON.stringify
 * - Undefined values are excluded (JSON.stringify behavior)
 *
 * What is normalized:
 * - Object key ordering
 * - Entry range ordering (min/max)
 * - TP/SL array ordering (price-based)
 * - Whitespace and formatting
 *
 * What is NOT normalized (preserved as-is):
 * - String casing (already normalized in CPJ schema)
 * - Numeric precision (preserved by JSON)
 * - Other array orderings (where order is semantically meaningful)
 *
 * @param cpj - Validated CPJ v0.1 payload
 * @returns SHA256 hash (hex string)
 */
function generateIngestHash(cpj: CpjV01Payload): string {
  // First, canonicalize field-specific semantics
  const canonicalized = canonicalizeCpjForHashing(cpj);
  /**
   * Recursively sort object keys for deterministic serialization
   * Arrays are already canonicalized above, preserve their order here
   */
  function sortKeys(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      // Preserve array order (already canonicalized), but recursively sort nested objects
      return obj.map(sortKeys);
    }

    if (typeof obj === "object") {
      // Sort object keys alphabetically
      return Object.keys(obj)
        .sort()
        .reduce((sorted: any, key) => {
          sorted[key] = sortKeys(obj[key]);
          return sorted;
        }, {});
    }

    return obj;
  }

  const normalized = sortKeys(canonicalized);
  const canonical = JSON.stringify(normalized);

  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Map CPJ v0.1 payload to canonical USS v1.1 with strict symbol validation
 *
 * Performs symbol/venue normalization and populates USS v1.1 fields.
 * Returns error result if symbol normalization fails.
 *
 * @param cpj - Validated CPJ v0.1 payload
 * @returns Mapping result with USS payload or error details
 */
export function mapCpjToUssV11(cpj: CpjV01Payload): CpjMappingResult {
  const now = new Date().toISOString();

  // Normalize symbol to AFI canonical format with strict validation
  const symbolResult = normalizeSymbolStrict(
    cpj.extracted.symbolRaw,
    cpj.extracted.venueHint
  );

  // If symbol normalization failed, return error immediately
  if (!symbolResult.success) {
    return {
      success: false,
      error: {
        type: "symbol_normalization_failed",
        symbolRaw: symbolResult.symbolRaw,
        symbolNormalizedAttempt: symbolResult.symbolNormalizedAttempt,
        reason: symbolResult.error!,
        details: symbolResult.details,
      },
    };
  }

  const canonicalSymbol = symbolResult.canonical!;

  // Normalize market type
  const marketType = normalizeMarketType(cpj.extracted.marketTypeHint);

  // Normalize direction
  const direction = normalizeSide(cpj.extracted.side);

  // Generate signal ID and ingest hash
  const signalId = generateSignalId(cpj);
  const ingestHash = generateIngestHash(cpj);

  // Map CPJ providerType to USS-compatible providerType
  const ussProviderType = mapProviderType(cpj.provenance.providerType);

  // Construct canonical USS v1.1
  const uss: UssV11Payload = {
    schema: "afi.usignal.v1.1",
    provenance: {
      source: `cpj-${cpj.provenance.providerType}`,
      providerId: cpj.provenance.providerId,
      signalId,
      ingestedAt: now,
      ingestHash,
      providerType: ussProviderType, // Use mapped USS-compatible providerType
      providerRef: cpj.provenance.channelName || cpj.provenance.providerId,
      // Store original CPJ metadata for audit trail
      cpjMessageId: cpj.provenance.messageId,
      cpjPostedAt: cpj.provenance.postedAt,
      cpjParseConfidence: cpj.parse.confidence,
    },
    // Ingest facts block - replay-canonical market/strategy metadata
    facts: {
      symbol: canonicalSymbol,
      market: marketType,
      timeframe: cpj.extracted.timeframeHint || "unknown",
      strategy: "cpj-ingested", // CPJ signals don't have strategy at ingest
      direction,
    },
  };

  return { success: true, uss };
}
