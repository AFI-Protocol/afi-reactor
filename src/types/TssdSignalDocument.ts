/**
 * T.S.S.D. (Time-Series Signal Data) Vault Document Types
 *
 * Defines the MongoDB document schema for persisting scored + validated signals
 * from the AFI Eliza Demo pipeline.
 *
 * Collection: tssd_signals
 * Database: afi
 *
 * Phase 1: Basic persistence only (no replay, no complex querying)
 * Phase 1.5: Receipt provenance tracking (off-chain only, no on-chain minting)
 *
 * @module TssdSignalDocument
 */

/**
 * T.S.S.D. Vault Document
 * 
 * This document represents a single scored + validated signal run
 * stored in MongoDB for audit, replay, and analytics.
 */
export interface TssdSignalDocument {
  /** Unique signal identifier (from pipeline) */
  signalId: string;

  /** Timestamp when signal was created (for time-series indexing) */
  createdAt: Date;

  /** Source of the signal (e.g., "afi-eliza-demo", "tradingview-webhook") */
  source: "afi-eliza-demo" | "tradingview-webhook" | string;

  /** Market metadata */
  market: {
    symbol: string;        // e.g., "BTC/USDT"
    timeframe: string;     // e.g., "1h", "15m", "4h"
    market?: string;       // e.g., "spot", "perp", "futures"
  };

  /** Pipeline execution results */
  pipeline: {
    /** UWR (Universal Weighting Rule) score from Froggy analyst */
    uwrScore: number;

    /** Validator decision from Val Dook */
    validatorDecision: {
      decision: "approve" | "reject" | "flag" | "abstain";
      uwrConfidence: number;
      reasonCodes?: string[];
    };

    /** Execution result (simulated) */
    execution: {
      status: "simulated" | "skipped";
      type?: "buy" | "sell" | "hold";
      asset?: string;
      amount?: number;
      simulatedPrice?: number;
      timestamp: string;
      notes?: string;
    };

    /** Stage summaries (DEMO-ONLY: for AFI Eliza Demo narration) */
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

  /** Strategy metadata */
  strategy: {
    name: string;          // e.g., "froggy_trend_pullback_v1"
    direction: string;     // e.g., "long", "short", "neutral"
  };

  /** Original inbound payload (for replay/audit) */
  rawPayload?: unknown;

  /**
   * Receipt provenance tracking (Phase 1.5)
   *
   * Tracks the lifecycle of signal minting and on-chain receipt/token issuance.
   * This block is optional and backward-compatible with Phase 1 documents.
   *
   * Bridge to on-chain: Maps to AFIMintCoordinator.MintCoordinated event
   * - signalId (string) ↔ signalId (bytes32) in event
   * - epochId ↔ epochId in event
   * - receiptId ↔ ERC-1155 token ID
   * - mintTxHash ↔ transaction hash of mint
   * - beneficiary ↔ recipient address
   * - tokenAmount ↔ AFI tokens minted
   * - receiptAmount ↔ receipt NFTs minted
   */
  receiptProvenance?: {
    /** Mint lifecycle status */
    mintStatus: "pending" | "eligible" | "minted" | "failed" | "ineligible";

    /** When the signal became eligible for minting */
    mintEligibleAt?: Date;

    /** When mint was attempted */
    mintAttemptedAt?: Date;

    /** When mint succeeded */
    mintedAt?: Date;

    /** Emissions epoch/batch number (bridge key to on-chain) */
    epochId?: number;

    /** ERC-1155 receipt token ID (as string for MongoDB) */
    receiptId?: string;

    /** Transaction hash of the mint (0x...) */
    mintTxHash?: string;

    /** Block number where mint occurred */
    mintBlockNumber?: number;

    /** Beneficiary address (recipient of tokens/receipts) */
    beneficiary?: string;

    /** AFI tokens minted (as decimal string to avoid precision loss) */
    tokenAmount?: string;

    /** Number of receipt NFTs minted (typically 1) */
    receiptAmount?: number;

    /** Error message if mint failed */
    mintError?: string;

    /** Number of mint retry attempts */
    mintRetryCount?: number;
  };

  /** Schema version (for forward compatibility) */
  version: "v0.1";
}

/**
 * Vault write status
 *
 * Indicates whether the signal was successfully persisted to the TSSD vault.
 */
export type VaultWriteStatus = "success" | "failed" | "skipped";

/**
 * Replay Result (Phase 2)
 *
 * Result of replaying a signal from the TSSD vault through the pipeline.
 * Provides stored vs recomputed values for auditing and regression testing.
 */
export interface ReplayResult {
  /** Signal ID that was replayed */
  signalId: string;

  /** Stored values from TSSD vault document */
  stored: {
    uwrScore: number;
    validatorDecision: {
      decision: "approve" | "reject" | "flag" | "abstain";
      uwrConfidence: number;
      reasonCodes?: string[];
    };
    execution: {
      status: "simulated" | "skipped";
      type?: "buy" | "sell" | "hold";
      timestamp: string;
    };
    meta: {
      symbol: string;
      timeframe: string;
      strategy: string;
      direction: string;
      source: string;
      createdAt: Date;
    };
    receiptProvenance?: {
      mintStatus: "pending" | "eligible" | "minted" | "failed" | "ineligible";
      epochId?: number;
      receiptId?: string;
      mintTxHash?: string;
    };
  };

  /** Recomputed values from re-running the pipeline */
  recomputed: {
    uwrScore: number;
    validatorDecision: {
      decision: "approve" | "reject" | "flag" | "abstain";
      uwrConfidence: number;
      reasonCodes?: string[];
    };
    execution: {
      status: "simulated" | "skipped";
      type?: "buy" | "sell" | "hold";
      timestamp: string;
    };
  };

  /** Comparison summary (stored vs recomputed) */
  comparison: {
    uwrScoreDelta: number;
    decisionChanged: boolean;
    changes: string[];
  };

  /** Replay metadata */
  replayMeta: {
    ranAt: Date;
    pipelineVersion: string;
    notes: string;
  };
}

