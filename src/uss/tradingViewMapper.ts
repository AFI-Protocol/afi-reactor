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
 * Priority:
 * 1. Explicit providerId in payload
 * 2. Strategy name (e.g., "froggy_trend_pullback_v1" -> "froggy-scout-tv")
 * 3. Environment variable AFI_DEFAULT_PROVIDER_ID
 * 4. Fallback: "tradingview-default"
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

  // 3. Derive from strategy name
  if (payload.strategy && payload.strategy.trim().length > 0) {
    const strategyPrefix = payload.strategy.split("_")[0].toLowerCase();
    return `${strategyPrefix}-scout-tv`;
  }

  // 4. Fallback
  return "tradingview-default";
}

/**
 * Map TradingView payload to canonical USS v1.1
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
  
  // Construct canonical USS v1.1
  const uss: UssV11Payload = {
    schema: "afi.usignal.v1.1",
    provenance: {
      source: "tradingview-webhook",
      providerId,
      signalId,
      ingestedAt: now,
      ingestHash,
      providerType: "tradingview",
      providerRef: payload.strategy || "unknown",
    },
  };
  
  // Add core telemetry if we can infer it from strategy
  // For now, keep it minimal - enrichment happens in the DAG
  if (payload.timeframe) {
    // Map timeframe to decay half-life (rough heuristic)
    const halfLifeDays = mapTimeframeToHalfLife(payload.timeframe);
    
    uss.core = {
      cashProxy: "pnl",
      telemetry: {
        decay: {
          halfLifeDays,
          function: "exp",
        },
      },
    };
  }
  
  return uss;
}

/**
 * Map TradingView timeframe to decay half-life (days)
 * 
 * Heuristic:
 * - 1m, 5m: 0.1 days (scalp)
 * - 15m, 30m: 0.25 days (intraday)
 * - 1h, 4h: 1 day (swing)
 * - 1d+: 7 days (position)
 */
function mapTimeframeToHalfLife(timeframe: string): number {
  const tf = timeframe.toLowerCase();

  // Check longer timeframes first to avoid substring matches
  if (tf === "15m" || tf === "30m") {
    return 0.25; // intraday
  }

  if (tf === "1m" || tf === "5m") {
    return 0.1; // scalp
  }

  if (tf === "1h" || tf === "4h") {
    return 1; // swing
  }

  if (tf === "1d" || tf.includes("d")) {
    return 7; // position
  }

  // Fallback for unknown timeframes
  return 1;
}

