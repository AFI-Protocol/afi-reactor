/**
 * TradingView to USS v1.1 Mapper
 * 
 * Converts TradingView webhook payloads to canonical USS v1.1 format.
 * 
 * @module tradingViewMapper
 */

import crypto from "crypto";
import { UssV11Payload } from "./ussValidator.js";

/**
 * TradingView alert payload shape (from existing webhook)
 */
export interface TradingViewAlertPayload {
  symbol: string;
  timeframe: string;
  strategy: string;
  direction: "long" | "short" | "neutral";
  setupSummary?: string;
  notes?: string;
  enrichmentProfile?: any;
  signalId?: string;
  providerId?: string;
  secret?: string;
  [key: string]: any;
}

/**
 * Generate a deterministic signal ID from TradingView payload
 * 
 * Format: {symbol}-{timeframe}-{strategy}-{direction}-{timestamp}
 * Example: btcusdt-15m-froggy-trend-pullback-v1-long-20251215T120530Z
 */
function generateSignalId(payload: TradingViewAlertPayload, timestamp: string): string {
  const symbol = payload.symbol.toLowerCase().replace(/\//g, "");
  const timeframe = payload.timeframe.toLowerCase();
  const strategy = payload.strategy.toLowerCase().replace(/_/g, "-");
  const direction = payload.direction.toLowerCase();

  // Use ISO timestamp without milliseconds for cleaner IDs
  const cleanTimestamp = timestamp.replace(/\.\d{3}Z$/, "Z");

  return `${symbol}-${timeframe}-${strategy}-${direction}-${cleanTimestamp}`;
}

/**
 * Generate a SHA256 hash of the raw payload for integrity verification
 */
function generateIngestHash(payload: any): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Derive provider ID from payload or environment
 *
 * Safe demo rule - no strategy-based derivation to avoid conflating identity with strategy.
 *
 * Priority:
 * 1. Explicit providerId in payload
 * 2. Environment variable AFI_DEFAULT_PROVIDER_ID
 * 3. Fallback: "tradingview-default"
 */
function deriveProviderId(payload: TradingViewAlertPayload): string {
  // 1. Explicit providerId
  if (payload.providerId) {
    return payload.providerId;
  }

  // 2. Environment variable
  if (process.env.AFI_DEFAULT_PROVIDER_ID) {
    return process.env.AFI_DEFAULT_PROVIDER_ID;
  }

  // 3. Fallback constant
  return "tradingview-default";
}

/**
 * Map TradingView payload to canonical USS v1.1
 *
 * Canonical ingest facts only - NO decay decisions at ingest time.
 * Decay parameters are derived later by analyst/scoring stages.
 *
 * @param payload - TradingView alert payload
 * @returns Canonical USS v1.1 payload
 */
export function mapTradingViewToUssV11(payload: TradingViewAlertPayload): UssV11Payload {
  const now = new Date().toISOString();

  // Derive or use explicit signalId
  const signalId = payload.signalId || generateSignalId(payload, now);

  // Derive or use explicit providerId
  const providerId = deriveProviderId(payload);

  // Generate integrity hash
  const ingestHash = generateIngestHash(payload);

  // Construct canonical USS v1.1 with ingest facts only
  const uss: UssV11Payload = {
    schema: "afi.usignal.v1.1",
    provenance: {
      source: "tradingview-webhook",
      providerId,
      signalId,
      ingestedAt: now,
      ingestHash,
      providerType: "tradingview",
      providerRef: payload.strategy || "unknown", // Provider reference (strategy identity)
    },
    // Ingest facts block - replay-canonical market/strategy metadata
    // This is persisted in TSSD vault and used by telemetry deriver for deterministic replay
    facts: {
      symbol: payload.symbol,
      market: payload.market || "perp", // Default to perp if not specified
      timeframe: payload.timeframe,
      strategy: payload.strategy || payload.strategyId || "unknown",
      direction: payload.direction || "neutral",
    },
  };

  // NO decay mapping at ingest - this is handled by analyst/scoring stages
  // Ingest facts (symbol, timeframe, direction, strategy) are now stored in facts block

  return uss;
}

