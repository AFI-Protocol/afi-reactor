// @ts-nocheck
/**
 * Canonical Novelty Types and Helpers
 * 
 * Provides replay-stable novelty types and canonicalization helpers for
 * deterministic audit/replay comparison.
 * 
 * Key Principles:
 * - CanonicalNovelty contains ONLY replay-stable fields (no timestamps)
 * - NoveltyResult (from afi-core) includes computedAt for observability
 * - Replay comparison uses CanonicalNovelty only
 * - Deterministic cohortId derivation from USS provenance
 */

import type { NoveltyResult, NoveltyClass, NoveltyReferenceSignal } from "afi-core/validators/NoveltyTypes.js";

/**
 * Canonical Novelty (Replay-Stable)
 * 
 * Contains only fields that should be compared during replay.
 * Excludes computedAt and any other runtime-generated timestamps.
 */
export interface CanonicalNovelty {
  /** Novelty score in [0,1], where 1.0 is maximally novel */
  noveltyScore: number;
  
  /** Novelty class label */
  noveltyClass: NoveltyClass;
  
  /** Cohort identifier (deterministic from signal attributes) */
  cohortId: string;
  
  /** Baseline identifier (optional, must be deterministic if present) */
  baselineId?: string;
  
  /** Reference signal IDs only (sorted for determinism) */
  referenceSignalIds?: string[];
  
  /** Evidence notes (optional, must be deterministic if present) */
  evidenceNotes?: string;
}

/**
 * Canonicalize a NoveltyResult for replay comparison.
 * 
 * Extracts only the replay-stable fields from a full NoveltyResult.
 * This ensures that replay comparisons are deterministic and don't
 * fail due to timestamp drift.
 * 
 * @param novelty - Full novelty result from afi-core scorer
 * @returns Canonical novelty with only replay-stable fields
 */
export function canonicalizeNovelty(novelty: NoveltyResult): CanonicalNovelty {
  // Extract signalIds from referenceSignals and sort for determinism
  const referenceSignalIds = novelty.referenceSignals
    ?.map(ref => ref.signalId)
    .sort(); // Alphabetical sort for stable ordering

  return {
    noveltyScore: novelty.noveltyScore,
    noveltyClass: novelty.noveltyClass,
    cohortId: novelty.cohortId,
    baselineId: novelty.baselineId,
    referenceSignalIds,
    evidenceNotes: novelty.evidenceNotes,
  };
}

/**
 * Derive deterministic cohort ID from signal attributes.
 * 
 * Format: ${market}-${timeframe}-${strategy}
 * 
 * Normalization rules:
 * - Market/symbol: uppercase, remove separators (BTC/USDT → BTCUSDT)
 * - Timeframe: lowercase, standardized (1h, 4h, 1d, etc.)
 * - Strategy: lowercase, kebab-case
 * 
 * @param market - Market symbol (e.g., "BTC/USDT", "BTCUSDT")
 * @param timeframe - Timeframe string (e.g., "1h", "4h", "1d")
 * @param strategy - Strategy identifier (e.g., "trend_pullback_v1")
 * @returns Deterministic cohort ID
 */
export function deriveCohortId(
  market: string,
  timeframe: string,
  strategy: string
): string {
  // Normalize market: uppercase, remove separators
  const normalizedMarket = market
    .toUpperCase()
    .replace(/[\/\-_]/g, "");

  // Normalize timeframe: lowercase
  const normalizedTimeframe = timeframe.toLowerCase();

  // Normalize strategy: lowercase
  const normalizedStrategy = strategy.toLowerCase();

  return `${normalizedMarket}-${normalizedTimeframe}-${normalizedStrategy}`;
}

/**
 * Extract market/timeframe/strategy from USS provenance.
 * 
 * This is a temporary helper until USS core schema is fully populated.
 * For now, we extract from provenance.providerRef and make reasonable defaults.
 * 
 * @param rawUss - Canonical USS v1.1 payload
 * @returns Extracted market, timeframe, strategy
 */
export function extractCohortAttributesFromUss(rawUss: any): {
  market: string;
  timeframe: string;
  strategy: string;
} {
  // TODO Phase 3: Extract from USS core when available
  // For now, use provenance.providerRef as market proxy
  const market = rawUss.provenance.providerRef || "UNKNOWN";
  
  // Default timeframe (TODO: extract from USS core)
  const timeframe = "1h";
  
  // Default strategy (TODO: extract from USS core or lens)
  const strategy = "trend_pullback_v1";

  return { market, timeframe, strategy };
}
// @ts-nocheck
