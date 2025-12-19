/**
 * Baseline Fetch for Novelty Scoring
 * 
 * Provides deterministic baseline signal fetching from TSSD vault for novelty comparison.
 * 
 * Key Principles:
 * - Deterministic ordering (timestamp desc, signalId asc tie-breaker)
 * - Stable limit (N=25 constant)
 * - Filters by cohortId and excludes current signal
 * - Uses rawUss.provenance.ingestedAt as canonical timestamp
 */

import type { NoveltySignalInput } from "afi-core/validators/NoveltyScorer.js";
import type { ReactorScoredSignalDocument } from "../types/ReactorScoredSignalV1.js";
import { getTssdCollection } from "../services/tssdVaultService.js";
import type { Collection } from "mongodb";

/**
 * Baseline fetch limit (constant for determinism)
 */
const BASELINE_LIMIT = 25;

/**
 * Fetch baseline signals from TSSD vault for novelty comparison.
 *
 * Query rules:
 * - Same cohortId
 * - Timestamp strictly earlier than current signal time
 * - Exclude same signalId
 * - Sort by timestamp desc, tie-breaker by signalId asc (for stable ordering)
 * - Limit N=25 constant
 *
 * @param cohortId - Cohort identifier to filter by
 * @param currentSignalId - Current signal ID to exclude
 * @param currentTimestamp - ISO timestamp of current signal (from rawUss.provenance.ingestedAt)
 * @param testCollection - Optional test collection (for testing only)
 * @returns Array of baseline signals for novelty comparison
 */
export async function fetchBaselineSignals(
  cohortId: string,
  currentSignalId: string,
  currentTimestamp: string,
  testCollection?: Collection<ReactorScoredSignalDocument>
): Promise<NoveltySignalInput[]> {
  try {
    // Use test collection if provided, otherwise get from vault service
    const collection = testCollection || await getTssdCollection();
    if (!collection) {
      console.info("ℹ️  Baseline fetch skipped: TSSD vault disabled");
      return [];
    }

    // Query for signals in same cohort, earlier than current signal
    const currentDate = new Date(currentTimestamp);
    
    const docs = await collection
      .find({
        // Filter by cohortId (stored in a custom field we'll add)
        "noveltyMeta.cohortId": cohortId,
        // Exclude current signal
        signalId: { $ne: currentSignalId },
        // Only signals ingested before current signal
        "rawUss.provenance.ingestedAt": { $lt: currentTimestamp },
      })
      .sort({
        // Primary sort: timestamp descending (most recent first)
        "rawUss.provenance.ingestedAt": -1,
        // Tie-breaker: signalId ascending (stable ordering)
        signalId: 1,
      })
      .limit(BASELINE_LIMIT)
      .toArray();

    // Map TSSD documents to NoveltySignalInput format
    return docs.map(doc => mapTssdDocToNoveltyInput(doc));
  } catch (error: any) {
    console.warn(`⚠️  Baseline fetch failed:`, error.message || String(error));
    return [];
  }
}

/**
 * Map a TSSD document to NoveltySignalInput format.
 * 
 * Extracts the fields needed for novelty comparison from a stored signal.
 * 
 * @param doc - TSSD signal document from vault
 * @returns NoveltySignalInput for afi-core scorer
 */
function mapTssdDocToNoveltyInput(doc: ReactorScoredSignalDocument): NoveltySignalInput {
  // Extract cohortId from noveltyMeta (we'll store it there)
  const cohortId = (doc as any).noveltyMeta?.cohortId || "unknown";

  // Extract market/timeframe/strategy from stored metadata
  const market = doc.market?.symbol || "UNKNOWN";
  const timeframe = doc.market?.timeframe || "1h";
  const strategy = doc.strategy?.name || "unknown";

  // Extract direction from strategy
  const direction = doc.strategy?.direction || "neutral";

  // Extract UWR axes from analystScore (nested under pipeline)
  const axes = doc.pipeline.analystScore?.uwrAxes;

  // Extract timestamp from rawUss provenance (canonical source)
  const createdAt = doc.rawUss?.provenance?.ingestedAt || doc.pipeline.scoredAt;

  return {
    signalId: doc.signalId,
    cohortId,
    market,
    timeframe,
    strategy,
    direction: direction as "long" | "short" | "neutral",
    structureAxis: axes?.structure,
    executionAxis: axes?.execution,
    riskAxis: axes?.risk,
    insightAxis: axes?.insight,
    createdAt,
  };
}

