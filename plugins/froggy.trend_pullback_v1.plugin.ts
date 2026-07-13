// @ts-nocheck
/**
 * Froggy Trend Pullback v1 Plugin - Dev/Demo Only
 * 
 * Purpose: Wrap Froggy's actual analyst logic from afi-core.
 *
 * PR-UWR-RUNTIME-READ: this plugin composes afi-core's public exports —
 * buildFroggyTrendPullbackInputFromEnriched + scoreFroggyTrendPullback(input,
 * resolvedConfig, enriched) — which is exactly what
 * scoreFroggyTrendPullbackFromEnriched does internally, except the UWR config
 * is resolved explicitly at the composition root (flag-gated; builtin default
 * IS afi-core's defaultUwrConfig, so default behavior is bit-identical).
 * 
 * Part of: canonical scored-only Froggy pipeline (USS ingest → telemetry derive → enrichment → froggy-analyst UWR score → vault write)
 */

import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { buildFroggyTrendPullbackInputFromEnriched } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { scoreFroggyTrendPullback } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import { getUwrRuntimeConfigOnce } from "../src/config/uwrRuntimeProfile.js";

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
  // PR-UWR-RUNTIME-READ: resolve the UWR config at the composition root
  // (flag-gated; "builtin" default IS afi-core's defaultUwrConfig, so this
  // path is bit-identical to the previous scoreFroggyTrendPullbackFromEnriched
  // call, which does exactly build-input + scoreFroggyTrendPullback with
  // defaultUwrConfig). In registry mode the config passed here has been
  // RC-5-verified value-identical, and a failed resolve throws before any
  // scoring happens (fail-closed, no fallback).
  const uwrRuntime = getUwrRuntimeConfigOnce();

  // Call afi-core's Froggy analyst with the explicitly resolved config.
  const input = buildFroggyTrendPullbackInputFromEnriched(enriched);
  const analysis = scoreFroggyTrendPullback(input, uwrRuntime.config, enriched);

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
