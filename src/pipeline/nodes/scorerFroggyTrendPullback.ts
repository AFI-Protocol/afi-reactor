/**
 * afi-scorer-froggy-trend-pullback@1.0.0 — the single scoring seam (scorer
 * category node; LIFE-GOV D-LIFE-1 transition monopoly).
 *
 * Composes afi-core's public exports EXACTLY like the live
 * plugins/froggy.trend_pullback_v1.plugin.ts does:
 * buildFroggyTrendPullbackInputFromEnriched + scoreFroggyTrendPullback with
 * the UWR config resolved PER DETERMINATION above the executor and handed
 * down as ctx.uwr (CFG-GOV D-CFG-4(4) — fail-closed, no fallback; RC-4:
 * this node refuses to score without it and never resolves or defaults), and
 * emits analysis + uwrResolvedSource VERBATIM (RC-6: the stamp site never
 * re-reads the environment or infers the source later).
 */
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { buildFroggyTrendPullbackInputFromEnriched } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { scoreFroggyTrendPullback } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import {
  buildFroggyResidualInput,
  composeFroggyTrendPullbackInput,
} from "afi-core/analysts/froggy.residual_builder.js";
import { interpretEnrichmentMapping } from "afi-core/validators/EnrichmentMappingInterpreter.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeDegradation,
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

      // CFG-GOV D-CFG-4(4): the UWR config is resolved per determination from
      // the strategy registration and handed down; this node never resolves,
      // re-reads the flag, or defaults. No config => no score (RC-4).
      const uwrRuntime = ctx.uwr;
      if (!uwrRuntime) {
        throw new Error(
          "scorer node received no resolved UWR configuration (CFG-GOV D-CFG-4(4)) — " +
            "refusing to score (fail-closed, no fallback; RC-4)."
        );
      }

      // DEM-GOV D-DEM-2(6): when the determination carries a resolved
      // mapping, the interpreter fragment is unconditionally authoritative
      // for the expressible inputs — an interpreter refusal throws, so no
      // determination exists (D-DEM-5(7)); the residual (unexpressible) half
      // rides the untouched legacy adapter via the residual builder. The
      // legacy full-adapter branch survives only while mappingRef is
      // optional and is removed at the final bounded step.
      let scorerInput: ReturnType<typeof buildFroggyTrendPullbackInputFromEnriched>;
      let degradations: NodeDegradation[] = [];
      if (ctx.mapping) {
        const { fragment, firedDefaults } = interpretEnrichmentMapping(
          ctx.mapping.doc,
          enriched
        );
        const residual = buildFroggyResidualInput(enriched);
        scorerInput = composeFroggyTrendPullbackInput(fragment, residual);
        // D-DEM-5(3): a fired declared default is a RECORDED degradation —
        // it flips the node's summary status, which is inside the
        // executionSummaryHash preimage. Never silent.
        degradations = firedDefaults.map((target) => ({
          class: "declared-default-fired",
          detail: target,
        }));
      } else {
        scorerInput = buildFroggyTrendPullbackInputFromEnriched(enriched);
      }
      const analysis = scoreFroggyTrendPullback(scorerInput, uwrRuntime.config, enriched);

      ctx.logger.info("froggy trend-pullback scored", {
        uwrResolvedSource: uwrRuntime.source,
        mappingApplied: Boolean(ctx.mapping),
      });

      // Identical envelope to the live plugin: enriched view + analysis +
      // the resolved config source, propagated verbatim (RC-6).
      return ok(
        {
          ...enriched,
          analysis,
          uwrResolvedSource: uwrRuntime.source,
        },
        degradations
      );
    },
  };
}

export const scorerFroggyTrendPullbackNode: AnalysisNodePlugin =
  createScorerFroggyTrendPullbackNode();
