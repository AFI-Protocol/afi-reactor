/**
 * afi-analysis-aiml@1.0.0 — AI/ML augmentation category node.
 *
 * Wraps the EXISTING production kernel (W3 spec section 5):
 * fetchAiMlForFroggy over the MERGED enriched view (this node runs after the
 * merge in the official froggy graph), augmenting the view exactly as the
 * live froggy-enrichment-adapter does — same TinyBrainsFroggyInput
 * projection, same aiMl attachment, same aiMl USS lens, same
 * enrichmentMeta.categories append.
 *
 * Degradations recorded (D-FCP-8, never silent; the view passes through
 * UNAUGMENTED — never fabricated predictions):
 *  - 'service-unconfigured' when TINY_BRAINS_URL is unset;
 *  - 'service-unavailable' when the configured service yields no prediction
 *    (down, non-2xx, invalid payload — fetchAiMlForFroggy's fail-soft
 *    surface, identical to today).
 */
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import {
  fetchAiMlForFroggy,
  type TinyBrainsFroggyInput,
} from "../../aiMl/tinyBrainsClient.js";
import type { AiMlLensV1, SupportedLens } from "../../types/UssLenses.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";

export interface AimlNodeDeps {
  fetchAiMl: typeof fetchAiMlForFroggy;
  /** TINY_BRAINS_URL presence check (configuration probe only). */
  isConfigured: () => boolean;
}

const PRODUCTION_DEPS: AimlNodeDeps = {
  fetchAiMl: fetchAiMlForFroggy,
  isConfigured: () => Boolean(process.env.TINY_BRAINS_URL?.trim()),
};

function isEnrichedView(input: unknown): input is FroggyEnrichedView {
  return (
    input !== null &&
    typeof input === "object" &&
    typeof (input as FroggyEnrichedView).signalId === "string" &&
    typeof (input as FroggyEnrichedView).symbol === "string"
  );
}

export function createAimlNode(deps: AimlNodeDeps = PRODUCTION_DEPS): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-analysis-aiml", pluginVersion: "1.0.0" },
    async run(input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      if (!isEnrichedView(input)) {
        throw new Error("aiml node requires the merged FroggyEnrichedView as input");
      }
      const view = input;

      if (!deps.isConfigured()) {
        ctx.logger.info("tiny-brains not configured; view passes through unaugmented");
        return ok(view, [
          {
            class: "service-unconfigured",
            detail: "TINY_BRAINS_URL unset; aiMl augmentation skipped",
          },
        ]);
      }

      // Identical projection to the live froggy-enrichment-adapter.
      const tinyBrainsInput: TinyBrainsFroggyInput = {
        signalId: view.signalId,
        symbol: view.symbol,
        timeframe: view.timeframe,
        traceId: view.signalId,
        technical: view.technical,
        pattern: view.pattern,
        sentiment: view.sentiment,
        newsFeatures: view.newsFeatures || undefined,
      };

      const prediction = await deps.fetchAiMl(tinyBrainsInput);

      if (!prediction) {
        ctx.logger.warn("tiny-brains yielded no prediction (fail-soft, recorded)");
        return ok(view, [
          {
            class: "service-unavailable",
            detail: "tiny-brains service returned no usable prediction",
          },
        ]);
      }

      // Augment a copy — same lens + categories append as the live adapter.
      const aiMlPayload: AiMlLensV1["payload"] = {
        ensembleScore: prediction.convictionScore,
        modelTags: prediction.regime ? [prediction.regime] : [],
      };
      const priorLenses = ((view as Record<string, unknown>).lenses as SupportedLens[]) ?? [];
      const priorMeta = view.enrichmentMeta ?? { categories: [] as string[] };

      const augmented: FroggyEnrichedView = {
        ...view,
        aiMl: prediction,
        enrichmentMeta: {
          ...priorMeta,
          categories: [...(priorMeta.categories ?? []), "aiMl"],
        },
      };
      (augmented as Record<string, unknown>).lenses = [
        ...priorLenses,
        { type: "aiMl", version: "v1", payload: aiMlPayload },
      ];

      return ok(augmented);
    },
  };
}

export const aimlNode: AnalysisNodePlugin = createAimlNode();
