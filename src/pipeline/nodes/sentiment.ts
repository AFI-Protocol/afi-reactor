/**
 * afi-analysis-sentiment@1.0.0 — perp-sentiment category node.
 *
 * Wraps the EXISTING production kernel (W3 spec section 5):
 * computeFroggySentiment (Coinalyze funding/positioning heuristics) — with
 * the ACTUAL signal symbol/timeframe mapped to the provider's symbol
 * convention instead of the retired hardcoded BTC-perp literal.
 *
 * Symbol mapping (documented per spec):
 *   Coinalyze aggregates Binance perpetuals under
 *   '<BASE><QUOTE>_PERP.A'. The canonical AFI symbol
 *   ('BTC/USDT' — or the already-concatenated 'BTCUSDT' some providers send)
 *   maps by stripping the '/' separator, uppercasing, and appending
 *   '_PERP.A'. A node config 'symbolOverride' bypasses the mapping entirely
 *   (for assets whose Coinalyze listing does not follow the convention).
 *
 * Timeframe mapping: Coinalyze history is fetched at '1h' or '1d' — signal
 * timeframes of a day or longer ('1d', '3d', '1w', ...) map to '1d', every
 * intraday timeframe maps to '1h' (the same granularity the live path used).
 *
 * Output shape (category-marked): { category: 'sentiment', sentiment } —
 * byte-identical to the live froggy-enrichment-sentiment-news plugin's
 * sentiment object (legacy score/tags + USS payload fields), so the merge
 * node assembles the same view.
 *
 * Provider unavailability is fail-soft exactly as today (payload null →
 * sentiment undefined) and is RECORDED as a degradation (D-FCP-8: never
 * silent).
 */
import { computeFroggySentiment } from "../../indicator/froggySentimentProfile.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";

export interface SentimentNodeOutput {
  category: "sentiment";
  sentiment:
    | {
        score: number;
        tags: string[];
        perpSentimentScore?: number;
        positioningBias?: string;
        fundingRegime?: string;
      }
    | undefined;
}

export interface SentimentNodeDeps {
  computeSentiment: typeof computeFroggySentiment;
}

const PRODUCTION_DEPS: SentimentNodeDeps = {
  computeSentiment: computeFroggySentiment,
};

/** Maps a canonical AFI symbol to the Coinalyze Binance-perp convention. */
export function toCoinalyzeSymbol(canonicalSymbol: string): string {
  const compact = canonicalSymbol.replace(/\//g, "").trim().toUpperCase();
  if (!compact) {
    throw new Error(`cannot map empty symbol to a Coinalyze symbol`);
  }
  return `${compact}_PERP.A`;
}

/** Maps a signal timeframe to the Coinalyze history granularity. */
export function toCoinalyzeTimeframe(timeframe: string | undefined): "1h" | "1d" {
  // Case-sensitive: 'm' is minutes (intraday), 'M' is months (daily bucket).
  if (typeof timeframe === "string" && /^\d+(d|D|w|W|M)$/.test(timeframe.trim())) {
    return "1d";
  }
  return "1h";
}

export function createSentimentNode(
  deps: SentimentNodeDeps = PRODUCTION_DEPS
): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-analysis-sentiment", pluginVersion: "1.0.0" },
    async run(_input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      const overrideRaw = ctx.config["symbolOverride"];
      const symbol =
        typeof overrideRaw === "string" && overrideRaw.length > 0
          ? overrideRaw
          : toCoinalyzeSymbol(
              typeof ctx.signal.facts?.symbol === "string" ? ctx.signal.facts.symbol : "BTC/USDT"
            );
      const timeframe = toCoinalyzeTimeframe(ctx.signal.facts?.timeframe);

      const payload = await deps.computeSentiment(symbol, timeframe);

      if (!payload) {
        ctx.logger.warn("sentiment provider unavailable (fail-soft, recorded)", { symbol });
        const output: SentimentNodeOutput = { category: "sentiment", sentiment: undefined };
        return ok(output, [
          {
            class: "provider-unavailable",
            detail: `Coinalyze sentiment unavailable for ${symbol}`,
          },
        ]);
      }

      // Identical legacy mapping to the live sentiment+news plugin.
      const legacyScore = payload.perpSentimentScore ? payload.perpSentimentScore / 100 : 0.5;
      const output: SentimentNodeOutput = {
        category: "sentiment",
        sentiment: {
          score: legacyScore,
          tags: [payload.positioningBias || "balanced", payload.fundingRegime || "normal"],
          perpSentimentScore: payload.perpSentimentScore,
          positioningBias: payload.positioningBias,
          fundingRegime: payload.fundingRegime,
        },
      };
      return ok(output);
    },
  };
}

export const sentimentNode: AnalysisNodePlugin = createSentimentNode();
