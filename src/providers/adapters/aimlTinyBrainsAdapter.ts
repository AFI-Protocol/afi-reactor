/**
 * afi-adapter-aiml-tiny-brains@1.0.0 — the KEYLESS first-party aiMl adapter
 * (FLPR-GOV D-FLPR-2 item 3): invokes the self-hosted Tiny Brains service and
 * emits exactly ONE governed 'aiMl' category result.
 *
 * The aiMl lane is a PRE-MERGE analysis lane: its joined input is the sibling
 * lane outputs ({ parents: { nodeId: output } } namespaces for technical /
 * pattern / sentiment / news). The adapter classifies parents by their
 * category marker (never by node id), projects them through the SAME shared
 * lane-view helpers the merge uses, posts the projection to the service, and
 * maps the prediction into the governed forecast shape. Free-prose service
 * notes are dropped at this edge (the governed contract is anti-prose).
 *
 * Tiny Brains remains a replaceable, non-authority, first-party service
 * (PBF-GOV D-PBF-3): the result is never read by the scorer. FAIL-CLOSED on
 * service absence/error — the lane's declared failure policy records the
 * degradation; nothing is fabricated.
 */
import {
  viewPattern,
  viewSentiment,
  viewTechnical,
  type AiMlLanePayload,
  type PatternLanePayload,
  type SentimentAxisObservation,
} from "../../pipeline/nodes/laneView.js";
import type { TechnicalLensV1 } from "../../types/UssLenses.js";
import type { callAimlService, AimlServiceInput } from "../clients/aimlServiceClient.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface AimlTinyBrainsAdapterDeps {
  callService: typeof callAimlService;
}

/** Load the real Tiny Brains aiMl client only when the production adapter runs. */
async function loadProductionDeps(): Promise<AimlTinyBrainsAdapterDeps> {
  const { callAimlService } = await import("../clients/aimlServiceClient.js");
  return { callService: callAimlService };
}

const REGIME_LABEL_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

interface SiblingLanes {
  technical?: { technical?: TechnicalLensV1["payload"] };
  pattern?: PatternLanePayload;
  sentiment?: { axes?: SentimentAxisObservation[] };
  news?: { newsFeatures?: unknown };
}

/** Classify the joined parent namespaces by category marker (sorted node ids). */
function classifyParents(input: unknown): SiblingLanes {
  const lanes: SiblingLanes = {};
  if (input === null || typeof input !== "object") return lanes;
  const parents = (input as { parents?: Record<string, unknown> }).parents;
  if (!parents || typeof parents !== "object") return lanes;
  for (const nodeId of Object.keys(parents).sort()) {
    const contribution = parents[nodeId];
    if (contribution === null || typeof contribution !== "object") continue;
    const category = (contribution as { category?: unknown }).category;
    if (category === "technical") lanes.technical = contribution as SiblingLanes["technical"];
    else if (category === "pattern") lanes.pattern = contribution as unknown as PatternLanePayload;
    else if (category === "sentiment") lanes.sentiment = contribution as SiblingLanes["sentiment"];
    else if (category === "news") lanes.news = contribution as SiblingLanes["news"];
  }
  return lanes;
}

export function createAimlTinyBrainsAdapter(deps?: AimlTinyBrainsAdapterDeps): ProviderAdapter {
  return {
    adapterId: "afi-adapter-aiml-tiny-brains",
    adapterVersion: "1.0.0",
    category: "aiMl",
    providerCompatibility: ["afi-provider-aiml-tiny-brains"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      const d = deps ?? (await loadProductionDeps());
      const lanes = classifyParents(ctx.input);

      const signalId = ctx.signal.provenance?.signalId ?? "";
      const symbol = typeof ctx.signal.facts?.symbol === "string" ? ctx.signal.facts.symbol : "";
      const timeframe =
        typeof ctx.signal.facts?.timeframe === "string" ? ctx.signal.facts.timeframe : "";

      const serviceInput: AimlServiceInput = {
        signalId,
        symbol,
        timeframe,
        traceId: signalId,
        technical: viewTechnical(lanes.technical?.technical ?? null),
        pattern: viewPattern(lanes.pattern ?? null),
        sentiment: viewSentiment(lanes.sentiment?.axes ?? null),
        newsFeatures: lanes.news?.newsFeatures ?? undefined,
      };

      const timeoutRaw = ctx.config["timeoutMs"];
      const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : undefined;

      // Fail CLOSED on service absence/error — no fabricated neutral, no fallback.
      const prediction = await d.callService(serviceInput, { timeoutMs, abort: ctx.abort });

      ctx.logger.info("aiMl forecast computed (tiny-brains provider adapter)", {
        signalId,
        direction: prediction.direction,
        conviction: prediction.convictionScore,
      });

      const result: AiMlLanePayload & { category: "aiMl" } = {
        category: "aiMl",
        forecast: {
          direction: prediction.direction,
          conviction: prediction.convictionScore,
        },
      };
      if (
        typeof prediction.regime === "string" &&
        REGIME_LABEL_PATTERN.test(prediction.regime)
      ) {
        result.regime = { label: prediction.regime };
      }
      if (typeof prediction.riskFlag === "boolean") {
        result.riskFlag = prediction.riskFlag;
      }
      return result as unknown as CategoryResult;
    },
  };
}

/** Production singleton (lazy client; no transport loaded until first run()). */
export const aimlTinyBrainsAdapter: ProviderAdapter = createAimlTinyBrainsAdapter();
