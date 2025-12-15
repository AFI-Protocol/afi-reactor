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
 * Phase 2: USS lenses for enrichment data (technical, pattern, sentiment, etc.)
 * Phase 3: Analyst score template integration (canonical scoring structure)
 *
 * @module TssdSignalDocument
 */

import type { SupportedLens } from "./UssLenses.js";
import type { AnalystScoreTemplate } from "afi-core/analyst";
import type { CanonicalUss } from "../services/pipelineRunner.js";

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

    /**
     * Price source metadata (Phase: BloFin Integration)
     *
     * REQUIRED for any pipeline that uses price data (e.g., Froggy enrichment).
     * These fields track data provenance for audit and debugging.
     *
     * - priceSource: Which adapter provided the price data (e.g., "blofin", "demo")
     * - venueType: Type of market venue (e.g., "crypto_perps", "crypto_spot", "demo")
     *
     * The froggyDemoService enforces these fields are present before writing to TSSD vault.
     */
    priceSource?: string;  // e.g., "blofin", "demo" - REQUIRED for price-based pipelines
    venueType?: string;    // e.g., "crypto_perps", "crypto_spot", "demo" - REQUIRED for price-based pipelines
  };

  /** Pipeline execution results */
  pipeline: {
    /**
     * Canonical analyst score for this signal, matching AnalystScoreTemplate from afi-core.
     * All UWR scoring data should come from this object.
     */
    analystScore?: AnalystScoreTemplate;

    /**
     * ISO timestamp when scoring was completed (aligns with afi-infra ScoreSnapshot.scoredAt)
     * Used as the reference point for time decay calculations.
     */
    scoredAt?: string;

    /**
     * Decay parameters derived from analyst score (Greeks-style time decay)
     * Computed via pickDecayParamsForAnalystScore() from afi-core/decay
     */
    decayParams?: {
      halfLifeMinutes: number;
      greeksTemplateId: string;
    } | null;

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

  /**
   * USS Lenses (Phase 2: Enrichment Data)
   *
   * Versioned, structured enrichment data attached as USS lenses.
   * Each lens provides domain-specific enrichment (technical, pattern, sentiment, etc.)
   * in a forward-compatible, composable format.
   *
   * Lenses are optional and backward-compatible with Phase 1 documents.
   */
  lenses?: SupportedLens[];

  /**
   * Price Feed Metadata (Debugging/Provenance)
   *
   * Mirrors key enrichment data for debugging and provenance tracking.
   * This is a transitional field - enrichment data should primarily live in lenses.
   *
   * DEPRECATED: Use lenses instead. This field will be removed in a future version.
   */
  _priceFeedMetadata?: {
    /** Technical indicators (mirrored from TechnicalLensV1) */
    technicalIndicators?: {
      ema20?: number;
      ema50?: number;
      rsi14?: number;
      atr14?: number;
      trendBias?: string;
      volumeRatio?: number;
      emaDistancePct?: number;
      isInValueSweetSpot?: boolean;
    };
    /** Pattern signals (mirrored from PatternLensV1) */
    patternSignals?: {
      bullishEngulfing?: boolean;
      bearishEngulfing?: boolean;
      pinBar?: boolean;
      insideBar?: boolean;
      structureBias?: string;
      trendPullbackConfirmed?: boolean;
      patternName?: string;
      patternConfidence?: number;
    };
  };

  /**
   * Canonical USS v1.1 Raw Signal (Phase 3)
   *
   * The canonical, AJV-validated USS v1.1 payload that entered the pipeline.
   * This is the single source of truth for replay/audit and contains all
   * provenance metadata required for deterministic replay.
   *
   * Required fields in provenance:
   * - source: Where the signal came from (e.g., "tradingview-webhook")
   * - providerId: Stable provider identifier (e.g., "tradingview-default")
   * - signalId: Unique signal identifier
   * - ingestedAt: ISO timestamp when signal was ingested
   * - ingestHash: SHA-256 hash of the raw inbound payload
   *
   * This field is queryable and indexed for audit/replay workflows.
   */
  rawUss?: CanonicalUss;

  /**
   * Original inbound payload (DEPRECATED - use rawUss instead)
   *
   * Legacy field for backward compatibility. New pipelines should store
   * the canonical USS v1.1 payload in rawUss instead.
   */
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
    /** Canonical analyst score (if available) */
    analystScore?: AnalystScoreTemplate;
    /** ISO timestamp when scoring was completed */
    scoredAt?: string;
    /** Decay parameters (if available) */
    decayParams?: {
      halfLifeMinutes: number;
      greeksTemplateId: string;
    } | null;
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
    /** Canonical analyst score (if available) */
    analystScore?: AnalystScoreTemplate;
    /** ISO timestamp when scoring was completed */
    scoredAt?: string;
    /** Decay parameters (if available) */
    decayParams?: {
      halfLifeMinutes: number;
      greeksTemplateId: string;
    } | null;
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

