/**
 * Barrel exports for the pipehead system — the D2-native reference
 * implementation surface (District 2 M2).
 */

export * from "./types.js";
export { createFrozenClock, FROZEN_CLOCK_ISO } from "./clock.js";
export type { Clock } from "./clock.js";
export {
  canonicalizeV1,
  canonicalPreimageV1,
  computeCanonicalHashV1,
  assertValidDomainTag,
  CanonicalHashPolicyError,
  AFI_HASH_V1,
  HASH_ALGORITHM_SHA256,
  DOMAIN_TAG_PATTERN,
  VOLATILE_TIMESTAMP_KEYS,
  EVIDENCE_TIMESTAMP_KEYS,
  D2_DOMAIN_TAGS,
} from "./provenance/canonicalHashV1.js";
export type {
  CanonicalHashV1,
  CanonicalHashPolicyReason,
  CanonicalizeV1Options,
  ComputeCanonicalHashV1Options,
  VolatileTimestampPolicy,
} from "./provenance/canonicalHashV1.js";
export {
  toCanonicalDecimalString,
  projectDecimalFieldsForHash,
  SCORE_DECIMAL_KEYS,
  ENRICHMENT_DECIMAL_KEYS,
  OHLCV_DECIMAL_KEYS,
} from "./provenance/hashProjection.js";
export type {
  AnalystInputEnvelopeV1,
  EvidenceRefV1,
  SourceDisclosureProfileV1,
  EnrichmentProvenanceV1,
  ProvenanceRecordV1,
  ReplayProfileV1,
  ScoredSignalV1,
  ReplayabilityLevel,
  SourceClass,
  DisclosureLevel,
  EnrichmentLaneStatus,
} from "./provenance/types.js";
export {
  ANALYST_INPUT_ENVELOPE_SCHEMA,
  SCORED_SIGNAL_SCHEMA,
  PROVENANCE_RECORD_SCHEMA,
  REPLAY_PROFILE_SCHEMA,
} from "./provenance/types.js";
export {
  validateD2Artifact,
  validateCanonicalHashV1,
  validateEvidenceRefV1,
  validateSourceDisclosureProfileV1,
  validateEnrichmentProvenanceV1,
  validateAnalystInputEnvelopeV1,
  validateScoredSignalV1,
  validateProvenanceRecordV1,
  validateReplayProfileV1,
  validateTradePlanV1,
  D2_ARTIFACT_KINDS,
} from "./provenance/schemaValidation.js";
export type {
  D2ArtifactKind,
  D2ValidationError,
  D2ValidationResult,
} from "./provenance/schemaValidation.js";
export {
  buildEvidenceRefs,
  buildSourceDisclosureProfiles,
  buildEnrichmentProvenance,
  buildAnalystInputEnvelope,
  buildScoredSignalProjection,
  buildReplayProfile,
  buildProvenanceRecord,
  computeInputHash,
  computeEnrichmentHash,
  computeScoredOutputHash,
  enrichmentBundleMaterial,
  findForbiddenArtifactKeys,
  provenanceRecordRefFor,
  replayProfileRefFor,
  FORBIDDEN_ARTIFACT_KEYS,
  FIXTURE_SOURCE_IDS,
  FIXTURE_DATASET_ID,
  LANE_VERSIONS,
  PIPEHEAD_ENGINE_ID,
  PIPEHEAD_ENGINE_VERSION,
  REFERENCE_ANALYST_ID,
  REFERENCE_STRATEGY_ID,
  REFERENCE_IMPLEMENTATION_NOTE,
  STRATEGY_VIEW_TYPE,
  ENRICHED_VIEW_SCHEMA_REF,
} from "./provenance/builders.js";
export type {
  EvidenceBuildInput,
  EnvelopeBuildInput,
  ScoredSignalProjectionOptions,
  ReplayProfileBuildInput,
  ProvenanceRecordBuildInput,
} from "./provenance/builders.js";
export {
  envelopePipehead,
  buildEnvelopeFromBundle,
  ENVELOPE_PIPEHEAD_ID,
} from "./provenance/envelopePipehead.js";
export type { EnvelopePipeheadInput } from "./provenance/envelopePipehead.js";
export {
  provenancePipehead,
  buildD2Artifacts,
  deriveEvaluatedAt,
  PROVENANCE_PIPEHEAD_ID,
} from "./provenance/provenancePipehead.js";
export type {
  ProvenancePipeheadInput,
  ProvenancePipeheadOutput,
  D2ArtifactSet,
  D2ArtifactValidationError,
} from "./provenance/provenancePipehead.js";
export {
  schemaValidationPipehead,
  validateUssV11Canonical,
  SCHEMA_VALIDATION_PIPEHEAD_ID,
  CANONICAL_VALIDATOR_NOTE,
  USS_V11_SCHEMA_CONST,
} from "./schemaValidationPipehead.js";
export type {
  UssValidationResult,
  UssValidationError,
} from "./schemaValidationPipehead.js";
export {
  technicalLane,
  runTechnicalLane,
  canonicalIndicatorEngine,
  TECHNICAL_LANE_ID,
  TECHNICAL_LANE_PIPEHEAD_ID,
  TECHNICAL_INDICATOR_NOTE,
} from "./lanes/technicalLane.js";
export type { TechnicalLanePayload } from "./lanes/technicalLane.js";
export {
  computeOfflineTechnicalIndicators,
  calculateEMA,
  calculateRSI,
  calculateATR,
  MIN_CANDLES_FOR_INDICATORS,
} from "./lanes/technicalIndicators.js";
export type {
  OfflineTechnicalIndicators,
  OfflineIndicatorEngine,
} from "./lanes/technicalIndicators.js";
export {
  patternLane,
  runPatternLane,
  PATTERN_LANE_ID,
  PATTERN_LANE_PIPEHEAD_ID,
} from "./lanes/patternLane.js";
export type { PatternLanePayload } from "./lanes/patternLane.js";
export {
  newsLane,
  runNewsLane,
  NEWS_LANE_ID,
  NEWS_LANE_PIPEHEAD_ID,
  NEWS_LANE_NOTE,
  DEFAULT_NEWS_FIXTURE,
} from "./lanes/newsLane.js";
export type { NewsLanePayload, NewsLaneItem } from "./lanes/newsLane.js";
export {
  socialLane,
  runSocialLane,
  SOCIAL_LANE_ID,
  SOCIAL_LANE_PIPEHEAD_ID,
  SOCIAL_LANE_NOTE,
  DEFAULT_SOCIAL_FIXTURE,
} from "./lanes/socialLane.js";
export type { SocialLanePayload } from "./lanes/socialLane.js";
export {
  aimlLane,
  runAimlLane,
  AIML_LANE_ID,
  AIML_LANE_PIPEHEAD_ID,
  AIML_LANE_NOTE,
  DEFAULT_AIML_FIXTURE,
} from "./lanes/aimlLane.js";
export type { AimlLanePayload } from "./lanes/aimlLane.js";
export {
  fanOut,
  indexLaneResults,
  isDegradedLaneResult,
  DEFAULT_LANE_RUNNERS,
  LANE_PROVISIONAL,
  WIRED_LANE_IDS,
  PROVISIONAL_LANE_IDS,
  DEGRADED_LANE_NOTE,
} from "./fanOut.js";
export type { FanOutInput, LaneRunner, DegradedLanePayload } from "./fanOut.js";
export {
  normalizePipehead,
  normalizeToBundle,
  buildEnrichedView,
  extractIdentityFromUss,
  validateBundleIdentity,
  NormalizeIdentityError,
  NORMALIZE_PIPEHEAD_ID,
  BUNDLE_PROVISIONAL_LANES,
} from "./normalizePipehead.js";
export type {
  BundleIdentity,
  IdentityValidationError,
  IdentityValidationResult,
} from "./normalizePipehead.js";
export {
  scoringPipehead,
  createScoringPipehead,
  buildInternalScoringResult,
  froggyScorer,
  SCORING_PIPEHEAD_ID,
} from "./scoringPipehead.js";
export type { FroggyScorer } from "./scoringPipehead.js";
export {
  runPipeheadHarness,
  isHarnessFailure,
  HARNESS_ID,
} from "./harness.js";
export type {
  HarnessInput,
  HarnessOptions,
  HarnessResult,
  HarnessAggregate,
  HarnessFailure,
  HarnessValidationFailure,
  HarnessArtifactFailure,
  HarnessInternalArtifacts,
} from "./harness.js";
