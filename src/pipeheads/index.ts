/**
 * Barrel exports for the pipehead system (partial; later features extend this).
 */

export * from "./types.js";
export { createFrozenClock, FROZEN_CLOCK_ISO } from "./clock.js";
export type { Clock } from "./clock.js";
export {
  canonicalize,
  canonicalHash,
  buildScoringProjection,
  EXCLUDED_TIMESTAMP_KEYS,
} from "./canonicalHash.js";
export type { CanonicalizeOptions, ScoringProjection } from "./canonicalHash.js";
export {
  schemaValidationPipehead,
  validateUssV11Structural,
  SCHEMA_VALIDATION_PIPEHEAD_ID,
  STRUCTURAL_VALIDATOR_NOTE,
  USS_V11_SCHEMA_CONST,
} from "./schemaValidationPipehead.js";
export type {
  StructuralUssValidationResult,
  StructuralValidationError,
} from "./schemaValidationPipehead.js";
export {
  technicalLane,
  runTechnicalLane,
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
