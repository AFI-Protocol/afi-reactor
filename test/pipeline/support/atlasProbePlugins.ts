/**
 * SECOND-STRATEGY PROOF test plugins (W3 spec section 8.2 / program §9.5) —
 * TEST-ONLY implementations for the 'atlas-probe' overlay strategy. They live
 * under test/ exclusively: production source contains NO mock implementations;
 * binding them is data injection through the composition test seam.
 */
import type { CanonicalUss } from "../../../src/types/canonicalUss.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeResult,
  type NodeRunContext,
} from "../../../src/pipeline/nodeSdk.js";

/**
 * afi-aiml-atlas-probe@1.0.0 — deterministic aiMl-category probe. Emits a
 * category-marked envelope recording what it consumed (proves the conditional
 * edge fired and the join delivered it under its own namespace).
 */
export const aimlAtlasProbeNode: AnalysisNodePlugin = {
  manifestRef: { pluginId: "afi-aiml-atlas-probe", pluginVersion: "1.0.0" },
  async run(input: unknown): Promise<NodeResult> {
    const upstreamCategory =
      input !== null && typeof input === "object"
        ? ((input as { category?: unknown }).category ?? null)
        : null;
    return ok({ category: "aiMl", probe: true, upstreamCategory });
  },
};

/**
 * afi-scorer-atlas-probe@1.0.0 — deterministic TEST scorer. Emits the SAME
 * envelope contract as the production scorer node ({ ...enriched, analysis:
 * { analystScore }, uwrResolvedSource }) with the atlas-probe strategy triple,
 * so the generic stamp/evidence path is exercised end-to-end with NO froggy
 * identity anywhere.
 */
export const scorerAtlasProbeNode: AnalysisNodePlugin = {
  manifestRef: { pluginId: "afi-scorer-atlas-probe", pluginVersion: "1.0.0" },
  async run(input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
    const enriched =
      input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const facts = (ctx.signal as CanonicalUss & { facts?: { direction?: string } }).facts;
    const direction =
      facts?.direction === "long" || facts?.direction === "short" ? facts.direction : "neutral";
    const analystScore = {
      analystId: "atlas-probe",
      strategyId: "multi_branch_v1",
      strategyVersion: "1.0.0",
      direction,
      riskBucket: "medium",
      conviction: 0.5,
      uwrScore: 0.5,
      uwrAxes: { structure: 0.5, execution: 0.5, risk: 0.5, insight: 0.5 },
      holdingHorizon: "scalp",
    };
    return ok({
      ...enriched,
      analysis: { analystScore },
      // RC-6: a test scorer still propagates an honest source discriminator.
      uwrResolvedSource: "builtin",
    });
  },
};
