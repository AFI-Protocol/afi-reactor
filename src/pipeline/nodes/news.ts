/**
 * afi-analysis-news@1.0.0 — market-news category node.
 *
 * Wraps the EXISTING production kernels (W3 spec section 5): the pluggable
 * news provider selected by NEWS_PROVIDER exactly as today (newsdata → the
 * NewsData.io provider; unset/none → disabled), the same
 * DEFAULT_NEWS_SUMMARY fallback the live plugin ships when no provider data
 * is available, and computeNewsFeatures over the raw summary.
 *
 * The look-back window comes from NODE CONFIG (windowHours; default 4 —
 * matching today's NEWS_WINDOW_HOURS default) instead of the retired
 * process-wide env read.
 *
 * Output shape (category-marked):
 *   { category: 'news', news, newsFeatures }
 * byte-identical to the live froggy-enrichment-sentiment-news plugin's news
 * object, so the merge node assembles the same view.
 *
 * Degradations recorded (D-FCP-8, never silent):
 *  - 'service-unconfigured' when no news provider is configured;
 *  - 'provider-error' when the configured provider failed (the declared
 *    DEFAULT_NEWS_SUMMARY fallback ships, exactly as today).
 */
import type { NewsProvider, NewsShockSummary } from "../../news/newsProvider.js";
import { DEFAULT_NEWS_SUMMARY } from "../../news/newsProvider.js";
import { createNewsDataProvider } from "../../news/newsdataNewsProvider.js";
import { computeNewsFeatures, type NewsFeatures } from "../../news/newsFeatures.js";
import type { NewsLensV1 } from "../../types/UssLenses.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeDegradation,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";

export interface NewsNodeOutput {
  category: "news";
  news: NewsLensV1["payload"];
  newsFeatures: NewsFeatures | undefined;
}

export interface NewsNodeDeps {
  /** Provider factory honoring NEWS_PROVIDER exactly as the live plugin. */
  createProvider: () => NewsProvider | null;
  computeFeatures: typeof computeNewsFeatures;
}

/** NEWS_PROVIDER resolution — identical to the live plugins' createNewsProvider. */
export function createConfiguredNewsProvider(): NewsProvider | null {
  const providerType = process.env.NEWS_PROVIDER?.toLowerCase();
  if (!providerType || providerType === "none") {
    return null;
  }
  if (providerType === "newsdata") {
    return createNewsDataProvider();
  }
  console.warn(`[news-node] Unknown NEWS_PROVIDER: ${providerType}. News enrichment disabled.`);
  return null;
}

const PRODUCTION_DEPS: NewsNodeDeps = {
  createProvider: createConfiguredNewsProvider,
  computeFeatures: computeNewsFeatures,
};

export function createNewsNode(deps: NewsNodeDeps = PRODUCTION_DEPS): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-analysis-news", pluginVersion: "1.0.0" },
    async run(_input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      const windowRaw = ctx.config["windowHours"];
      const windowHours = typeof windowRaw === "number" ? windowRaw : 4;
      const symbol =
        typeof ctx.signal.facts?.symbol === "string" ? ctx.signal.facts.symbol : "BTCUSDT";

      const degradations: NodeDegradation[] = [];
      const provider = deps.createProvider();
      let newsSummary: NewsShockSummary | null = null;

      if (!provider) {
        degradations.push({
          class: "service-unconfigured",
          detail: "no news provider configured (NEWS_PROVIDER unset or 'none')",
        });
      } else {
        try {
          newsSummary = await provider.fetchRecentNews({ symbol, windowHours });
        } catch (err) {
          ctx.logger.warn("news provider fetch failed (fail-soft, recorded)", {
            symbol,
            error: err instanceof Error ? err.message : String(err),
          });
          degradations.push({
            class: "provider-error",
            detail: `news provider failed for ${symbol}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
          newsSummary = null;
        }
      }

      // Declared fallback — identical to the live plugin.
      const effectiveNews = newsSummary ?? DEFAULT_NEWS_SUMMARY;

      const news: NewsLensV1["payload"] = {
        hasShockEvent: effectiveNews.hasShockEvent,
        shockDirection: effectiveNews.shockDirection,
        headlines: effectiveNews.headlines,
        items: effectiveNews.items?.map((item) => ({
          title: item.title,
          source: item.source,
          url: item.url,
          publishedAt: item.publishedAt.toISOString(),
        })),
      };

      const newsFeatures = deps.computeFeatures(newsSummary) || undefined;

      const output: NewsNodeOutput = { category: "news", news, newsFeatures };
      return ok(output, degradations);
    },
  };
}

export const newsNode: AnalysisNodePlugin = createNewsNode();
