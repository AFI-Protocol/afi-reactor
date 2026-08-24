/**
 * afi-scorer-froggy-trend-pullback@1.0.0 — the single scoring seam (scorer
 * category node; LIFE-GOV D-LIFE-1 transition monopoly).
 *
 * Composes afi-core's public exports: the interpreter fragment (from the
 * strategy's registered enrichment mapping, DEM-GOV D-DEM-2) + the residual
 * builder's unexpressible half, with the UWR config resolved PER
 * DETERMINATION above the executor and handed down as ctx.uwr (CFG-GOV
 * D-CFG-4(4) — fail-closed, no fallback; RC-4: this node refuses to score
 * without it and never resolves or defaults), and emits analysis +
 * uwrResolvedSource VERBATIM (RC-6: the stamp site never re-reads the
 * environment or infers the source later). Since DEM-BIND's final bounded
 * step there is no bespoke-adapter path here: no resolved mapping on the
 * determination means no score and no record (D-DEM-2(6), D-DEM-5(7)).
 */
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
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

      // DEM-GOV D-DEM-2(6): the interpreter fragment is unconditionally
      // authoritative for the expressible inputs — an interpreter refusal
      // throws, so no determination exists (D-DEM-5(7)); the residual
      // (unexpressible) half rides the untouched legacy adapter via the
      // residual builder. There is no built-in mapping, no default mapping,
      // and no code-path fallback to the retired bespoke code: absent a
      // resolved mapping this node refuses exactly as it refuses without
      // the resolved UWR config above.
      const mappingCarrier = ctx.mapping;
      if (!mappingCarrier) {
        throw new Error(
          "scorer node received no resolved enrichment mapping (DEM-GOV D-DEM-2(6)) — " +
            "refusing to score (fail-closed, no fallback; no determination, D-DEM-5(7))."
        );
      }
      const { fragment, firedDefaults } = interpretEnrichmentMapping(
        mappingCarrier.doc,
        enriched
      );
      const residual = buildFroggyResidualInput(enriched);
      const scorerInput = composeFroggyTrendPullbackInput(fragment, residual);
      // D-DEM-5(3): a fired declared default is a RECORDED degradation —
      // it flips the node's summary status, which is inside the
      // executionSummaryHash preimage. Never silent.
      const degradations: NodeDegradation[] = firedDefaults.map((target) => ({
        class: "declared-default-fired",
        detail: target,
      }));
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
