/**
 * Simple Replay View Types
 * 
 * Defines the clean, read-only view of a TSSD signal for replay/audit purposes.
 * 
 * This is a "simple replay" - just fetching and presenting stored data,
 * NOT re-running the pipeline (that's the full ReplayResult in TssdSignalDocument.ts).
 * 
 * Use case:
 * - Quick signal lookup by ID
 * - UI/dashboard display
 * - Audit trail inspection
 * - Debugging without re-computation
 * 
 * @module SimpleReplayView
 */

/**
 * Simple Replay View
 * 
 * A clean, read-only view of a stored TSSD signal.
 * Maps TSSD vault document to a UI-friendly format.
 */
export interface SimpleReplayView {
  /** Unique signal identifier */
  signalId: string;

  /** When the signal was created (ISO 8601 string) */
  createdAt: string;

  /** Source of the signal (e.g., "afi-eliza-demo", "tradingview-webhook") */
  source: string;

  /** Market metadata */
  market: {
    /** Trading pair symbol (e.g., "BTC/USDT") */
    symbol: string;

    /** Timeframe (e.g., "1h", "15m", "4h") */
    timeframe: string;

    /** Market type (e.g., "spot", "perp", "futures") */
    marketType?: string;

    /** Price data source (e.g., "blofin", "demo") */
    priceSource?: string;

    /** Venue type (e.g., "crypto_spot", "crypto_perps", "demo") */
    venueType?: string;
  };

  /** Strategy metadata */
  strategy?: {
    /** Strategy name (e.g., "froggy_trend_pullback_v1") */
    name?: string;

    /** Trade direction (e.g., "long", "short", "neutral") */
    direction?: string;
  };

  /** Pipeline execution results */
  pipeline?: {
    /** UWR (Universal Weighting Rule) score */
    uwrScore?: number;

    /** Validator decision (e.g., "approve", "reject", "flag", "abstain") */
    decision?: string;

    /** Validator confidence score */
    confidence?: number;

    /** Full validator decision object (for detailed inspection) */
    validatorDecision?: {
      decision: "approve" | "reject" | "flag" | "abstain";
      uwrConfidence: number;
      reasonCodes?: string[];
    };

    /** Execution result */
    execution?: {
      status: "simulated" | "skipped";
      type?: "buy" | "sell" | "hold";
      timestamp: string;
      notes?: string;
    };

    /** Stage summaries (if available) */
    stageSummaries?: Array<{
      stage: string;
      persona: string;
      status: string;
      summary: string;
      uwrScore?: number;
      decision?: string;
      enrichmentCategories?: string[];
    }>;
  };

  /** Receipt provenance (if minted) */
  receiptProvenance?: {
    mintStatus: "pending" | "eligible" | "minted" | "failed" | "ineligible";
    epochId?: number;
    receiptId?: string;
    mintTxHash?: string;
    beneficiary?: string;
    tokenAmount?: string;
  };

  /** Full TSSD document (for debugging / advanced use) */
  raw?: any;
}

/**
 * Simple Replay Error
 * 
 * Structured error response for replay endpoint failures.
 */
export interface SimpleReplayError {
  /** Error type */
  error: "signal_not_found" | "vault_unavailable" | "internal_error";

  /** Human-readable error message */
  message: string;

  /** Signal ID that was requested (if applicable) */
  signalId?: string;

  /** Additional context (optional) */
  reason?: string;
}

