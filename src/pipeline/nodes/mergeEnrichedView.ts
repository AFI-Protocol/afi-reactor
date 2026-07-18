/**
 * afi-merge-enriched-view@1.1.0 — deterministic five-category merge node
 * (FLPR-GOV).
 *
 * Joins the five governed category results (technical, pattern, sentiment,
 * news, aiMl) into the analyst-facing FroggyEnrichedView + USS lenses +
 * _priceFeedMetadata. The scorer-visible values are projected through the
 * shared laneView helpers BYTE-IDENTICALLY to the pre-activation runtime
 * (technical emaDistancePct / isInValueSweetSpot / brokeEmaWithBody=false and
 * indicator renames; pattern patternName / patternConfidence from the
 * candlestick block; sentiment tags from the closed axis-tag vocabulary), so
 * analyst scoring, UWR, and the ScoredSignal projection are unchanged.
 *
 * Parents arrive KEYED BY NODE ID ({ parents: { <nodeId>: output } }) — no
 * hardcoded parent ids anywhere. Contributions are classified by the
 * category marker each lane stamps on its governed result; parents are
 * visited in sorted-nodeId order, and a second contribution to an
 * already-filled category fails the merge (the manifest's namespace-by-node
 * conflictRule 'error' — deterministic by construction). Skipped/degraded
 * optional parents arrive as empty namespaces and simply contribute
 * nothing (never fabricated data). No provider is invoked here — this is a
 * pure structural merge.
 */
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import {
  normalizeMarketType,
  mapMarketTypeToVenueType,
} from "../../utils/marketUtils.js";
import type {
  TechnicalLensV1,
  PatternLensV1,
  SupportedLens,
} from "../../types/UssLenses.js";
import type { NewsFeatures } from "../../news/newsFeatures.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";
import {
  viewAiMl,
  viewPattern,
  viewSentiment,
  viewTechnical,
  type AiMlLanePayload,
  type PatternLanePayload,
  type SentimentAxisObservation,
} from "./laneView.js";

/** The join-shaped input the executor delivers to a merge node. */
export interface MergeNodeInput {
  parents: Record<string, unknown>;
}

interface CategorizedResult {
  category: string;
  [field: string]: unknown;
}

function hasCategory(value: unknown): value is CategorizedResult {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { category?: unknown }).category === "string"
  );
}

export function createMergeEnrichedViewNode(): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-merge-enriched-view", pluginVersion: "1.1.0" },
    async run(input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      if (
        input === null ||
        typeof input !== "object" ||
        typeof (input as MergeNodeInput).parents !== "object" ||
        (input as MergeNodeInput).parents === null
      ) {
        throw new Error("merge node requires a join input of shape { parents: { nodeId: output } }");
      }
      const parents = (input as MergeNodeInput).parents;

      // Classify contributions by category marker, parents in sorted-nodeId
      // order; a duplicate category is a conflict (conflictRule 'error').
      const byCategory: Partial<Record<string, CategorizedResult>> = {};
      for (const nodeId of Object.keys(parents).sort()) {
        const contribution = parents[nodeId];
        if (!hasCategory(contribution)) continue; // empty namespace (skipped/degraded parent)
        if (byCategory[contribution.category] !== undefined) {
          throw new Error(
            `merge conflict: category '${contribution.category}' contributed by more than one parent (conflictRule 'error')`
          );
        }
        byCategory[contribution.category] = contribution;
      }

      const tech = byCategory["technical"] as
        | { technical?: TechnicalLensV1["payload"]; priceSource?: string }
        | undefined;
      const pat = byCategory["pattern"] as unknown as PatternLanePayload | undefined;
      const sent = byCategory["sentiment"] as
        | { axes?: SentimentAxisObservation[] }
        | undefined;
      const nws = byCategory["news"] as
        | { news?: FroggyEnrichedView["news"]; newsFeatures?: NewsFeatures }
        | undefined;
      const ai = byCategory["aiMl"] as unknown as AiMlLanePayload | undefined;

      const signalId = ctx.signal.provenance?.signalId ?? "";
      const symbol =
        typeof ctx.signal.facts?.symbol === "string" ? ctx.signal.facts.symbol : "";
      const market =
        typeof ctx.signal.facts?.market === "string" ? ctx.signal.facts.market : "";
      const timeframe =
        typeof ctx.signal.facts?.timeframe === "string" ? ctx.signal.facts.timeframe : "";

      const enrichedCategories: string[] = [];
      const lenses: SupportedLens[] = [];

      // ---- technical (scorer-visible projection unchanged) ----
      const technicalLensPayload: TechnicalLensV1["payload"] | null =
        tech?.technical ?? null;
      const technical = viewTechnical(technicalLensPayload);
      if (technicalLensPayload) {
        lenses.push({ type: "technical", version: "v1", payload: technicalLensPayload });
        enrichedCategories.push("technical");
      }

      // ---- pattern (governed result rides the lens; candlestick → view) ----
      let patternLensPayload: PatternLensV1["payload"] | null = null;
      let pattern: FroggyEnrichedView["pattern"] = undefined;
      if (pat) {
        const { category: _patCategory, ...lanePayload } = pat as unknown as CategorizedResult;
        patternLensPayload = lanePayload as unknown as PatternLensV1["payload"];
        pattern = viewPattern(pat);
        lenses.push({ type: "pattern", version: "v1", payload: patternLensPayload });
        enrichedCategories.push("pattern");
      }

      // ---- sentiment (governed axes → closed tag vocabulary; inert at scorer) ----
      let sentiment: FroggyEnrichedView["sentiment"] = undefined;
      if (sent?.axes && sent.axes.length > 0) {
        sentiment = viewSentiment(sent.axes);
        lenses.push({
          type: "sentiment",
          version: "v1",
          payload: { axes: sent.axes },
        });
        enrichedCategories.push("sentiment");
      }

      // ---- news (view shape is the governed result's news object, verbatim) ----
      let news: FroggyEnrichedView["news"] = undefined;
      let newsFeatures: NewsFeatures | undefined = undefined;
      if (nws?.news) {
        news = nws.news;
        newsFeatures =
          nws.newsFeatures && Object.keys(nws.newsFeatures).length > 0
            ? nws.newsFeatures
            : undefined;
        lenses.push({
          type: "news",
          version: "v1",
          payload: {
            hasShockEvent: news.hasShockEvent ?? false,
            shockDirection: (news.shockDirection ?? "none") as "bullish" | "bearish" | "none" | "unknown",
            headlines: news.headlines ?? undefined,
            items: news.items ?? undefined,
          },
        });
        enrichedCategories.push("news");
      }

      // ---- aiMl (joined as the fifth lane; never read by the scorer) ----
      let aiMl: FroggyEnrichedView["aiMl"] = undefined;
      if (ai && ai.forecast && typeof ai.forecast.conviction === "number") {
        aiMl = viewAiMl(ai);
        if (aiMl) {
          lenses.push({
            type: "aiMl",
            version: "v1",
            payload: {
              ensembleScore: aiMl.convictionScore,
              modelTags: aiMl.regime ? [aiMl.regime] : [],
            },
          });
          enrichedCategories.push("aiMl");
        }
      }

      // ---- assemble (field order/values preserved from the pre-activation merge) ----
      const actualPriceSource = tech?.priceSource ?? "unavailable";
      const normalizedMarketType = normalizeMarketType(market);
      const venueType = mapMarketTypeToVenueType(
        normalizedMarketType,
        actualPriceSource === "demo"
      );

      let enrichmentSummary = `Applied enrichment legos: ${enrichedCategories.join(", ")}`;
      if (technicalLensPayload) {
        enrichmentSummary += `. Trend: ${technicalLensPayload.trendBias} (EMA20=${technicalLensPayload.ema20.toFixed(2)}, RSI=${technicalLensPayload.rsi14.toFixed(0)})`;
      }
      if (pattern?.patternName) {
        enrichmentSummary += `. Pattern: ${pattern.patternName}`;
      }

      const enriched: FroggyEnrichedView = {
        signalId,
        symbol,
        market: normalizedMarketType,
        timeframe,
        technical,
        pattern,
        sentiment,
        news,
        aiMl,
        newsFeatures: newsFeatures || undefined,
        enrichmentMeta: {
          categories: enrichedCategories,
          enrichedBy: "froggy-enrichment-adapter",
          enrichedAt: new Date().toISOString(),
        },
      };

      (enriched as Record<string, unknown>).lenses = lenses;
      (enriched as Record<string, unknown>)._priceFeedMetadata = {
        priceSource: actualPriceSource,
        venueType,
        marketType: normalizedMarketType,
        technicalIndicators: technicalLensPayload || undefined,
        patternSignals: patternLensPayload || undefined,
      };
      (enriched as Record<string, unknown>)._enrichmentSummary = enrichmentSummary;

      ctx.logger.info("enriched view assembled", { categories: enrichedCategories });
      return ok(enriched);
    },
  };
}

export const mergeEnrichedViewNode: AnalysisNodePlugin = createMergeEnrichedViewNode();
