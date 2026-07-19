/**
 * TypeScript mirrors of the merged District 2 M1 provenance schemas
 * (afi-config `schemas/provenance/v1/*.schema.json`). Development-time types
 * only — AJV compiled over the afi-config JSON schemas remains the single
 * source of validation truth (`schemaValidation.ts`); nothing here duplicates
 * or overrides schema semantics.
 *
 * ESM: relative imports use `.js`.
 */

import type { CanonicalHashV1 } from "./canonicalHashV1.js";

export type { CanonicalHashV1 } from "./canonicalHashV1.js";

/** EvidenceRef v1 — hash-only evidence reference (evidence-ref.schema.json). */
export interface EvidenceRefV1 {
  evidenceId: string;
  sourceRef: string;
  evidenceHash: CanonicalHashV1;
  fetchedAt?: string;
  asOf?: string;
  postedAt?: string;
  observedAt?: string;
  uri?: string;
  mediaType?: string;
  redactionStatus?: "disclosed" | "redacted" | "withheld";
  withheldReason?: string;
  notes?: string;
}

export type SourceClass =
  | "exchange-api"
  | "market-data-vendor"
  | "onchain-data"
  | "social"
  | "news"
  | "human-analyst"
  | "model-output"
  | "other";

export type DisclosureLevel = "full" | "partial" | "summary-only" | "withheld";

export type ReplayabilityLevel =
  | "deterministic"
  | "pinned-inputs"
  | "best-effort"
  | "non-replayable";

/**
 * SourceDisclosureProfile v1 — descriptive source metadata
 * (source-disclosure-profile.schema.json). Descriptive only; encodes no
 * evaluation/weighting policy of any kind.
 */
export interface SourceDisclosureProfileV1 {
  sourceId: string;
  sourceClass: SourceClass;
  disclosureLevel: DisclosureLevel;
  replayabilityLevel: ReplayabilityLevel;
  withheldReason?:
    | "license-restricted"
    | "proprietary"
    | "privacy"
    | "regulatory"
    | "security"
    | "other";
  licenseConstraint?:
    | "none"
    | "attribution-required"
    | "no-redistribution"
    | "internal-use-only"
    | "commercial-restricted"
    | "custom";
  providerAttestation?:
    | "none"
    | "self-attested"
    | "third-party-attested"
    | "cryptographic";
  analystVisibleSummary?: string;
  validatorVisibleSummary?: string;
  qualityClaim?: { statement: string; basis?: string };
  notes?: string;
}

export const ANALYST_INPUT_ENVELOPE_SCHEMA = "afi.analyst-input-envelope.v1" as const;

/**
 * AnalystInputEnvelope v1 — strict wrapper around an intentionally OPAQUE
 * strategy-local view (analyst-input-envelope.schema.json). The view is
 * NON-CANONICAL: it must be declared (strategyViewType and/or
 * enrichedViewSchemaRef) and only participates in hashing via the explicit
 * strategyLocalViewHash pin.
 */
export interface AnalystInputEnvelopeV1 {
  schema: typeof ANALYST_INPUT_ENVELOPE_SCHEMA;
  signalId: string;
  strategyLocalView: Record<string, unknown>;
  providerId?: string;
  analystId?: string;
  strategyId?: string;
  strategyViewType?: string;
  enrichedViewSchemaRef?: string;
  strategyLocalViewHash?: CanonicalHashV1;
  sourceDisclosureProfiles?: SourceDisclosureProfileV1[];
  evidenceRefs?: EvidenceRefV1[];
  replayProfileRef?: string;
}

export const SCORED_SIGNAL_SCHEMA = "afi.scored-signal.v1" as const;

/**
 * ScoredSignal v1 projection — thin canonical scored-signal projection
 * (scored-signal.schema.json). Structurally excludes runtime/storage baggage
 * (no rawUss, no lenses, no _priceFeedMetadata, no volatile processing
 * timestamps).
 */
export interface ScoredSignalV1 {
  schema: typeof SCORED_SIGNAL_SCHEMA;
  signalId: string;
  analystId: string;
  strategyId: string;
  direction: "long" | "short" | "neutral";
  uwrScore: number;
  providerId?: string;
  providerRef?: string;
  strategyVersion?: string;
  riskBucket?: string;
  conviction?: number;
  uwrAxes?: Record<string, number>;
  evaluatedAt?: string;
  provenanceRecordRef?: string;
  provenanceRecordHash?: CanonicalHashV1;
  outputHash?: CanonicalHashV1;
}

export const PROVENANCE_RECORD_SCHEMA = "afi.provenance-record.v1" as const;

/**
 * ProvenanceRecord v1 — per-pass provenance record
 * (provenance-record.schema.json). Carries no on-chain commitments, no
 * claims, no validator-decision fields, and no runtime/storage timestamps.
 */
export interface ProvenanceRecordV1 {
  schema: typeof PROVENANCE_RECORD_SCHEMA;
  signalId: string;
  canonicalizationVersion: string;
  inputHash: CanonicalHashV1;
  outputHash: CanonicalHashV1;
  enrichmentHash?: CanonicalHashV1;
  evidenceRefs?: EvidenceRefV1[];
  sourceDisclosureRefs?: string[];
  replayProfileRef?: string;
  domainTags?: string[];
  schemaVersions?: Record<string, string>;
  storageProfileRef?: string;
  notes?: string;
}

export const REPLAY_PROFILE_SCHEMA = "afi.replay-profile.v1" as const;

/** ReplayProfile v1 — D2-conformant replay metadata (replay-profile.schema.json). */
export interface ReplayProfileV1 {
  schema: typeof REPLAY_PROFILE_SCHEMA;
  replayabilityLevel: ReplayabilityLevel;
  factsRequired: boolean;
  datasetId?: string;
  codeCommit?: string;
  seed?: string | number | null;
  evidenceRefs?: string[];
  evidenceHashes?: CanonicalHashV1[];
  sourceRefs?: string[];
  laneVersions?: Record<string, string>;
  environmentNotes?: string;
}
