/**
 * afi-scorer-froggy-trend-pullback@1.0.0 — the single scoring seam (scorer
 * category node; LIFE-GOV D-LIFE-1 transition monopoly).
 *
 * Composes afi-core's public exports EXACTLY like the live
 * plugins/froggy.trend_pullback_v1.plugin.ts does:
 * buildFroggyTrendPullbackInputFromEnriched + scoreFroggyTrendPullback with
 * the UWR config resolved at the composition root through the existing
 * RC loader (getUwrRuntimeConfigOnce — fail-closed, no fallback; RC-4), and
 * emits analysis + uwrResolvedSource VERBATIM (RC-6: the stamp site never
 * re-reads the environment or infers the source later).
 */
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { buildFroggyTrendPullbackInputFromEnriched } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { scoreFroggyTrendPullback } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import { getUwrRuntimeConfigOnce } from "../../config/uwrRuntimeProfile.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";

function isEnrichedView(input: unknown): input is FroggyEnrichedView {
  return (
    input !== null &&
    typeof input === "object" &&
    typeof (input as FroggyEnrichedView).signalId === "string" &&
    typeof (input as FroggyEnrichedView).symbol === "string"
  );
}

export function createScorerFroggyTrendPullbackNode(): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
    async run(input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      if (!isEnrichedView(input)) {
        throw new Error("scorer node requires the (optionally aiMl-augmented) FroggyEnrichedView");
      }
      const enriched = input;

      // PR-UWR-RUNTIME-READ: resolve the UWR config at the composition root
      // (fail-closed; a failed resolution throws before any scoring happens).
      const uwrRuntime = getUwrRuntimeConfigOnce();

      const scorerInput = buildFroggyTrendPullbackInputFromEnriched(enriched);
      const analysis = scoreFroggyTrendPullback(scorerInput, uwrRuntime.config, enriched);

      ctx.logger.info("froggy trend-pullback scored", {
        uwrResolvedSource: uwrRuntime.source,
      });

      // Identical envelope to the live plugin: enriched view + analysis +
      // the resolved config source, propagated verbatim (RC-6).
      return ok({
        ...enriched,
        analysis,
        uwrResolvedSource: uwrRuntime.source,
      });
    },
  };
}

export const scorerFroggyTrendPullbackNode: AnalysisNodePlugin =
  createScorerFroggyTrendPullbackNode();
