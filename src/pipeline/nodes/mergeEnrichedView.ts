/**
 * afi-merge-enriched-view@1.0.0 — deterministic merge category node.
 *
 * Assembles the FroggyEnrichedView + USS lenses + _priceFeedMetadata
 * FIELD-BY-FIELD IDENTICAL to plugins/froggy-enrichment-adapter.plugin.ts
 * (the DAG-mode branch of the live adapter) — same legacy technical object
 * (brokeEmaWithBody: false, same indicator key names), same pattern/regime
 * mirroring, same sentiment/news lens construction, same enrichment summary
 * string, same enrichmentMeta (enrichedBy stays 'froggy-enrichment-adapter'
 * so the assembled bytes are indistinguishable from the live adapter's) —
 * byte-compatible scorer input is the gate (W3 spec section 5).
 *
 * Parents arrive KEYED BY NODE ID ({ parents: { <nodeId>: output } }) — no
 * hardcoded parent ids anywhere. Contributions are classified by the
 * category marker each analysis node stamps on its output
 * ({ category: 'technical' | 'pattern' | 'sentiment' | 'news' }); parents
 * are visited in sorted-nodeId order, and a second contribution to an
 * already-filled category fails the merge (the manifest's namespace-by-node
 * conflictRule 'error' — deterministic by construction). Skipped/degraded
 * optional parents arrive as empty namespaces and simply contribute
 * nothing (never fabricated data).
 *
 * The aiMl category is NOT merged here: in the official graph the aiml node
 * runs AFTER the merge and augments the assembled view.
 */
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import {
  normalizeMarketType,
  mapMarketTypeToVenueType,
} from "../../utils/marketUtils.js";
import type {
  TechnicalLensV1,
  PatternLensV1,
  NewsLensV1,
  SupportedLens,
} from "../../types/UssLenses.js";
import type { NewsFeatures } from "../../news/newsFeatures.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";
import type { TechnicalNodeOutput } from "./technical.js";
import type { PatternNodeOutput } from "./pattern.js";
import type { SentimentNodeOutput } from "./sentiment.js";
import type { NewsNodeOutput } from "./news.js";

/** The join-shaped input the executor delivers to a merge node. */
export interface MergeNodeInput {
  parents: Record<string, unknown>;
}

type CategorizedParent =
  | TechnicalNodeOutput
  | PatternNodeOutput
  | SentimentNodeOutput
  | NewsNodeOutput;

function hasCategory(value: unknown): value is CategorizedParent {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { category?: unknown }).category === "string"
  );
}

export function createMergeEnrichedViewNode(): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-merge-enriched-view", pluginVersion: "1.0.0" },
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
      const byCategory: Partial<Record<string, CategorizedParent>> = {};
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

      const tech = byCategory["technical"] as TechnicalNodeOutput | undefined;
      const pat = byCategory["pattern"] as PatternNodeOutput | undefined;
      const sent = byCategory["sentiment"] as SentimentNodeOutput | undefined;
      const nws = byCategory["news"] as NewsNodeOutput | undefined;

      const signalId = ctx.signal.provenance?.signalId ?? "";
      const symbol =
        typeof ctx.signal.facts?.symbol === "string" ? ctx.signal.facts.symbol : "";
      const market =
        typeof ctx.signal.facts?.market === "string" ? ctx.signal.facts.market : "";
      const timeframe =
        typeof ctx.signal.facts?.timeframe === "string" ? ctx.signal.facts.timeframe : "";

      const enrichedCategories: string[] = [];
      const lenses: SupportedLens[] = [];

      // ---- technical (identical to the adapter's DAG-mode branch) ----
      const technicalLensPayload: TechnicalLensV1["payload"] | null =
        tech?.technical ?? null;
      let technical: FroggyEnrichedView["technical"] = undefined;
      if (technicalLensPayload) {
        technical = {
          emaDistancePct: technicalLensPayload.emaDistancePct,
          isInValueSweetSpot: technicalLensPayload.isInValueSweetSpot,
          brokeEmaWithBody: false,
          indicators: {
            rsi: technicalLensPayload.rsi14,
            ema_20: technicalLensPayload.ema20,
            ema_50: technicalLensPayload.ema50,
            volume_ratio: technicalLensPayload.volumeRatio,
          },
        };
        lenses.push({ type: "technical", version: "v1", payload: technicalLensPayload });
        enrichedCategories.push("technical");
      }

      // ---- pattern (identical to the adapter's DAG-mode branch) ----
      const patternLensPayload: PatternLensV1["payload"] | null = pat?.pattern ?? null;
      let pattern: FroggyEnrichedView["pattern"] = undefined;
      if (patternLensPayload) {
        pattern = {
          patternName: patternLensPayload.patternName,
          patternConfidence: patternLensPayload.patternConfidence,
        };
        if (patternLensPayload.regime) {
          (pattern as Record<string, unknown>).regime = patternLensPayload.regime;
        }
        lenses.push({ type: "pattern", version: "v1", payload: patternLensPayload });
        enrichedCategories.push("pattern");
      }

      // ---- sentiment (identical to the adapter's DAG-mode branch) ----
      let sentiment: FroggyEnrichedView["sentiment"] = undefined;
      if (sent?.sentiment) {
        sentiment = sent.sentiment;
        if (sent.sentiment.perpSentimentScore !== undefined) {
          lenses.push({
            type: "sentiment",
            version: "v1",
            payload: {
              perpSentimentScore: sent.sentiment.perpSentimentScore,
              positioningBias: sent.sentiment.positioningBias,
              fundingRegime: sent.sentiment.fundingRegime,
            } as SupportedLens["payload"],
          } as SupportedLens);
        }
        enrichedCategories.push("sentiment");
      }

      // ---- news (identical to the adapter's DAG-mode branch) ----
      let news: NewsLensV1["payload"] | undefined = undefined;
      let newsFeatures: NewsFeatures | undefined = undefined;
      if (nws?.news) {
        news = nws.news;
        newsFeatures = nws.newsFeatures;
        lenses.push({
          type: "news",
          version: "v1",
          payload: {
            hasShockEvent: news.hasShockEvent,
            shockDirection: news.shockDirection,
            headlines: news.headlines,
            items: news.items,
          },
        });
        enrichedCategories.push("news");
      }

      // ---- assemble (identical field order/values to the adapter) ----
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
      if (patternLensPayload?.patternName) {
        enrichmentSummary += `. Pattern: ${patternLensPayload.patternName}`;
      }
      if (patternLensPayload?.regime) {
        const regime = patternLensPayload.regime;
        enrichmentSummary += `. Regime: ${regime.cyclePhase || "unknown"} (${regime.trendState || "?"}, ${regime.volRegime || "?"} vol`;
        if (regime.externalLabels?.fearGreedLabel) {
          enrichmentSummary += `, ${regime.externalLabels.fearGreedLabel}`;
        }
        enrichmentSummary += `)`;
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
        aiMl: undefined, // augmented by the aiml node AFTER this merge
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
