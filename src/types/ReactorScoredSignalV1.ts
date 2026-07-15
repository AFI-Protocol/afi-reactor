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
import type { UwrProfileSource } from "../config/uwrRuntimeProfile.js";

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
   * source — so any stamp produced now carries it. RC-6 is explicit that a
   * stamp WITHOUT this field identifies the pre-program era, so a consumer must
   * treat a missing `source` as exactly that (pre-program), never assume it is
   * present. Optional-by-design keeps the type honest about that history.
   * (Note: this stamp's former persistence site — the legacy Reactor scored
   * document — has been deleted; `uwrProfileStampFor` is retained pending a
   * governed home on the canonical evidence record. See PR body / owner note.)
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

  /**
   * The UWR runtime source the composition path ACTUALLY scored with, PROPAGATED
   * verbatim from the froggy-analyst plugin (ResolvedUwrRuntimeConfig.source).
   *
   * Carried so the canonical-evidence stamp site can build the governed
   * `uwrProfile` from the real resolution instead of re-deriving it (RC-6: a
   * stamp site must never re-read the flag, re-resolve the config, or consult the
   * environment). Resolution is fail-closed (RC-4), so a failed/invalid
   * resolution throws before scoring — this field only ever describes a
   * successful run.
   */
  uwrResolvedSource: UwrProfileSource;

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
