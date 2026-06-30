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
