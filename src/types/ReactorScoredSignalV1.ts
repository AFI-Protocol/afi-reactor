/**
 * Reactor Scored Signal V1
 *
 * Canonical output contract for AFI Reactor.
 * Reactor's responsibility: ingest → enrich → score → persist.
 *
 * This contract represents a scored signal ONLY.
 * Validator certification, execution, and minting are NOT Reactor's responsibility.
 *
 * @module ReactorScoredSignalV1
 */

import type { AnalystScoreTemplate } from "afi-core/analyst";

/**
 * Reactor Scored Signal V1 (Response Contract)
 *
 * This is what Reactor returns from ingestion endpoints.
 */
export interface ReactorScoredSignalV1 {
  /** Unique signal identifier (from USS provenance) */
  signalId: string;

  /** Canonical USS v1.1 payload (preserved for replay/audit) */
  rawUss: any;

  /** USS lenses (enrichment data in USS format) */
  lenses?: any[];

  /** Price feed metadata (provenance for audit trail) */
  _priceFeedMetadata?: {
    priceSource?: string;
    venueType?: string;
    marketType?: string;
    technicalIndicators?: any;
    patternSignals?: any;
  };

  /** Analyst score (canonical UWR score from afi-core) */
  analystScore: AnalystScoreTemplate;

  /** Timestamp when scoring was completed (ISO 8601) */
  scoredAt: string;

  /** Decay parameters (Greeks-style time decay) */
  decayParams: {
    halfLifeMinutes: number;
    greeksTemplateId: string;
  } | null;

  /** Market metadata */
  meta: {
    symbol: string;
    timeframe: string;
    strategy: string;
    direction: "long" | "short" | "neutral";
    source: string;
  };
}

/**
 * Reactor Scored Signal Document (Persistence Schema)
 *
 * This is what Reactor persists to MongoDB.
 * Stored in Reactor-owned collection (isolated from afi-infra TSSD vault).
 */
export interface ReactorScoredSignalDocument {
  /** Unique signal identifier */
  signalId: string;

  /** Document creation timestamp */
  createdAt: Date;

  /** Signal source (e.g., "tradingview-webhook", "cpj-telegram") */
  source: string;

  /** Market metadata */
  market: {
    symbol: string;
    timeframe: string;
    market: string; // "spot" | "perp" | "futures"
    priceSource: string; // Required for provenance
    venueType: string; // Required for provenance
  };

  /** USS lenses (enrichment data) */
  lenses?: any[];

  /** Price feed metadata (mirrored for debugging, DEPRECATED) */
  _priceFeedMetadata?: {
    technicalIndicators?: any;
    patternSignals?: any;
  };

  /** Pipeline outputs */
  pipeline: {
    /** Canonical analyst score */
    analystScore: AnalystScoreTemplate;

    /** Timestamp when scoring was completed */
    scoredAt: string;

    /** Decay parameters */
    decayParams: {
      halfLifeMinutes: number;
      greeksTemplateId: string;
    } | null;
  };

  /** Strategy metadata */
  strategy: {
    name: string;
    direction: "long" | "short" | "neutral";
  };

  /** Canonical USS v1.1 (queryable field for replay) */
  rawUss: any;

  /** Legacy field (kept for backward compatibility) */
  rawPayload?: any;

  /** Schema version */
  version: string;
}

