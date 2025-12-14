/**
 * Froggy Enrichment: Sentiment + News Plugin
 * 
 * Purpose: Extract sentiment and news enrichment into a separate DAG stage.
 * 
 * This plugin computes:
 * - Sentiment (Coinalyze perp sentiment, funding, open interest)
 * - News (headlines, shock detection via NewsData.io or other providers)
 * 
 * Part of Pass B: Modular enrichment split (tech+pattern → sentiment+news → adapter)
 */

import { z } from "zod";
import type { SentimentLensV1, NewsLensV1 } from "../src/types/UssLenses.js";
import { computeFroggySentiment } from "../src/indicator/froggySentimentProfile.js";
import type { NewsProvider, NewsShockSummary, NewsShockDirection } from "../src/news/newsProvider.js";
import { DEFAULT_NEWS_SUMMARY } from "../src/news/newsProvider.js";
import { createNewsDataProvider } from "../src/news/newsdataNewsProvider.js";
import { computeNewsFeatures, type NewsFeatures } from "../src/news/newsFeatures.js";

/**
 * Input schema: structured signal from signal-structurer or tech-pattern stage
 */
const inputSchema = z.object({
  signalId: z.string(),
  score: z.number(),
  confidence: z.number(),
  timestamp: z.string(),
  meta: z.object({
    symbol: z.string(),
    market: z.string(),
    timeframe: z.string(),
    strategy: z.string(),
    direction: z.enum(["long", "short", "neutral"]),
  }),
  // Optional: tech+pattern enrichment from previous stage
  _techPatternEnrichment: z.any().optional(),
});

type StructuredSignal = z.infer<typeof inputSchema>;

/**
 * Output: signal with attached sentiment+news enrichment
 */
interface SentimentNewsEnrichment {
  sentiment?: {
    score: number;  // Legacy format: 0.0-1.0
    tags: string[];
    perpSentimentScore?: number;  // USS format: 0-100
    positioningBias?: string;
    fundingRegime?: string;
  };
  news?: {
    hasShockEvent: boolean;
    shockDirection: NewsShockDirection;
    headlines: string[];
    items?: Array<{
      title: string;
      source: string;
      url: string;
      publishedAt: string;
    }>;
  };
  newsFeatures?: NewsFeatures;
  enrichedAt: string;
  sources: string[];
}

/**
 * Create a NewsProvider based on environment configuration
 */
function createNewsProvider(): NewsProvider | null {
  const providerType = process.env.NEWS_PROVIDER?.toLowerCase();
  const debugNews = process.env.AFI_DEBUG_NEWS === "1";

  if (debugNews) {
    console.log(`[SentimentNewsPlugin] DEBUG: NEWS_PROVIDER="${providerType}"`);
  }

  if (!providerType || providerType === "none") {
    console.log("[SentimentNewsPlugin] News enrichment disabled (NEWS_PROVIDER not set or 'none')");
    return null;
  }

  if (providerType === "newsdata") {
    return createNewsDataProvider();
  }

  console.warn(`[SentimentNewsPlugin] Unknown NEWS_PROVIDER: ${providerType}. News enrichment disabled.`);
  return null;
}

/**
 * Run sentiment + news enrichment
 */
async function run(signal: StructuredSignal): Promise<StructuredSignal & { _sentimentNewsEnrichment: SentimentNewsEnrichment }> {
  const debugNews = process.env.AFI_DEBUG_NEWS === "1";

  if (debugNews) {
    process.stderr.write(`[SentimentNewsPlugin] ⚡ Starting sentiment+news enrichment for signal ${signal.signalId}\n`);
  }

  // Validate input
  const validatedInput = inputSchema.parse(signal);

  const sources: string[] = [];
  let sentiment: SentimentNewsEnrichment["sentiment"] = undefined;
  let news: SentimentNewsEnrichment["news"] = undefined;
  let newsFeatures: NewsFeatures | undefined = undefined;

  // Sentiment enrichment (Coinalyze perp sentiment)
  try {
    // Default to BTC perp, could be parameterized per signal in the future
    const sentimentPayload = await computeFroggySentiment("BTCUSDT_PERP.A", "1h");

    if (sentimentPayload) {
      // Map perpSentimentScore (0-100) to legacy score (0.0-1.0)
      const legacyScore = sentimentPayload.perpSentimentScore
        ? sentimentPayload.perpSentimentScore / 100
        : 0.5;

      sentiment = {
        score: legacyScore,
        tags: [
          sentimentPayload.positioningBias || "balanced",
          sentimentPayload.fundingRegime || "normal",
        ],
        perpSentimentScore: sentimentPayload.perpSentimentScore,
        positioningBias: sentimentPayload.positioningBias,
        fundingRegime: sentimentPayload.fundingRegime,
      };
      sources.push("coinalyze");
    } else {
      console.warn("⚠️  Sentiment enrichment: Coinalyze data unavailable, skipping");
    }
  } catch (err) {
    console.warn(`⚠️  Sentiment enrichment error:`, err);
  }

  // News enrichment
  try {
    const newsProvider = createNewsProvider();

    if (debugNews) {
      console.log(`[SentimentNewsPlugin] Provider created: ${newsProvider ? newsProvider.constructor.name : "null"}`);
    }

    let newsSummary: NewsShockSummary | null = null;

    if (newsProvider) {
      try {
        const windowHours = process.env.NEWS_WINDOW_HOURS
          ? parseInt(process.env.NEWS_WINDOW_HOURS, 10)
          : 4;

        if (debugNews) {
          console.log(`[SentimentNewsPlugin] DEBUG: Calling fetchRecentNews for symbol="${validatedInput.meta.symbol}", windowHours=${windowHours}`);
        }

        newsSummary = await newsProvider.fetchRecentNews({
          symbol: validatedInput.meta.symbol ?? "BTCUSDT",
          windowHours,
        });

        if (debugNews) {
          console.log(`[SentimentNewsPlugin] DEBUG: fetchRecentNews returned:`, JSON.stringify(newsSummary, null, 2));
        }
      } catch (err) {
        console.warn(`[SentimentNewsPlugin] Error fetching news for ${validatedInput.meta.symbol}:`, err);
        newsSummary = null;
      }
    }

    // Use provider data if available, otherwise fall back to default
    const effectiveNews = newsSummary ?? DEFAULT_NEWS_SUMMARY;

    if (debugNews) {
      console.log(`[SentimentNewsPlugin] DEBUG: effectiveNews (after fallback):`, JSON.stringify(effectiveNews, null, 2));
    }

    // Build news payload
    news = {
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

    // Compute NewsFeatures from news enrichment (UWR-ready, not wired yet)
    newsFeatures = computeNewsFeatures(newsSummary) || undefined;

    if (newsProvider) {
      sources.push("newsdata");
    }
  } catch (err) {
    console.warn(`⚠️  News enrichment error:`, err);
  }

  // Build enrichment payload
  const enrichment: SentimentNewsEnrichment = {
    sentiment,
    news,
    newsFeatures,
    enrichedAt: new Date().toISOString(),
    sources,
  };

  // Return signal with attached enrichment
  return {
    ...validatedInput,
    _sentimentNewsEnrichment: enrichment,
  };
}

export default {
  id: "froggy-enrichment-sentiment-news",
  kind: "plugin",
  run,
};

