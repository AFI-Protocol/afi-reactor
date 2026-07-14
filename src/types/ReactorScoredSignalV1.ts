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
 * RC-6 source discriminator (PR-UWR-STAMP-SEMANTICS,
 * uwr-runtime-consumption-v0.1.md §7 row flipped by owner merge of
 * afi-governance PR #13, merge commit 6b3638b).
 *
 * - "builtin-value-identity": the record was scored with afi-core's builtin
 *   `defaultUwrConfig` (the RC-3 flag selected `builtin`, the default). The
 *   stamp remains VALUE-IDENTITY metadata: the config is value-identical to
 *   the registered profile by construction (UP-2/UP-5), but the registry was
 *   not read.
 * - "registry-consumed": the record was scored with the profile actually
 *   READ from the afi-config registry and validated under the RC-5 identity
 *   predicate (RC-4 fail-closed — a failed read/validation refuses to score,
 *   so no record and no stamp can exist for a failed resolution).
 */
export type UwrProfileStampSource =
  | "builtin-value-identity"
  | "registry-consumed";

/**
 * UWR profile stamp (PR-UWR-STAMP, uwr-profile-pin-v0.1.md §7;
 * source discriminator added by PR-UWR-STAMP-SEMANTICS per RC-6).
 *
 * Traceability metadata only: records which governed, version-pinned UWR
 * profile the scoring configuration corresponds to (UP-2/UP-5) and — via
 * `source` — whether that configuration was the builtin value-identical
 * stub or the registry document actually consumed at runtime. It does NOT
 * indicate qualification, reward eligibility, or mint wiring — each remains
 * separately authorized.
 */
export interface UwrProfileStamp {
  /** Pinned profile id (e.g. "uwr-weighted-lifts-v0.1"). */
  profileId: string;
  /** Governance status of the pinned profile. */
  status: "testnet-provisional";
  /** Decision that pinned the profile. */
  decisionRef: string;
  /**
   * RC-6 source discriminator. **Optional by design, not by accident.**
   *
   * Every stamp WRITTEN from PR-UWR-STAMP-SEMANTICS onward populates it —
   * `uwrProfileStampFor` always sets it and refuses to stamp an unknown
   * source — so new persisted records always carry it. But this same
   * interface also types records READ BACK from the vault
   * (ReactorScoredSignalDocument.pipeline.uwrProfile), and records persisted
   * during the PR-UWR-STAMP era carry a stamp WITHOUT this field. RC-6 is
   * explicit that those records are not rewritten and that "absence of the
   * discriminator identifies the pre-program era" — so a read-side consumer
   * must treat a missing `source` as exactly that (pre-program), never
   * assume it is present. Typing it required here would assert a guarantee
   * stored pre-program documents do not have.
   */
  source?: UwrProfileStampSource;
}

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

    /**
     * UWR profile stamp (PR-UWR-STAMP). Present only when the scorer
     * identity is the one the profile is recognized for (UP-10); absent on
     * documents persisted before this field existed and on documents from
     * unrecognized scorer identities. Never null.
     */
    uwrProfile?: UwrProfileStamp;
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

