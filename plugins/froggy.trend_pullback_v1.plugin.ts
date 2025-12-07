/**
 * Froggy Trend Pullback v1 Plugin - Dev/Demo Only
 * 
 * Purpose: Wrap Froggy's actual analyst logic from afi-core.
 * 
 * This plugin imports and calls afi-core's scoreFroggyTrendPullbackFromEnriched
 * function, which implements the full UWR-based scoring logic for Froggy's
 * trend_pullback_v1 strategy.
 * 
 * Part of: froggy-trend-pullback-v1 pipeline (Alpha → Pixel Rick → Froggy → Val Dook → Execution Sim)
 */

import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { scoreFroggyTrendPullbackFromEnriched } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";

/**
 * Output schema: enriched signal + Froggy analysis.
 */
interface FroggyAnalyzedSignal extends FroggyEnrichedView {
  analysis: FroggyTrendPullbackScore;
}

/**
 * Run Froggy's trend_pullback_v1 strategy on enriched signal.
 * 
 * This calls afi-core's canonical Froggy analyst implementation,
 * which produces UWR-scored analysis with structure/execution/risk/insight axes.
 * 
 * @param enriched - FroggyEnrichedView from froggy-enrichment-adapter
 * @returns FroggyAnalyzedSignal with analysis attached
 */
async function run(enriched: FroggyEnrichedView): Promise<FroggyAnalyzedSignal> {
  // Call afi-core's Froggy analyst
  const analysis = scoreFroggyTrendPullbackFromEnriched(enriched);

  // Attach analysis to enriched signal
  const analyzed: FroggyAnalyzedSignal = {
    ...enriched,
    analysis,
  };

  return analyzed;
}

export default {
  run,
};

