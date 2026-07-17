/**
 * Unit tests for the seven production category nodes (W3 spec section 5).
 * Deterministic dependencies are INJECTED through each node's factory seam —
 * production defaults wrap the real kernels; no mocks live in src/.
 */
import { jest } from "@jest/globals";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse; no test
// here ever issues a ccxt request (repo idiom — see test/oracle/*.test.ts).
// The price-feed registry constructs the blofin/coinbase adapter singletons at
// module load, so the mock must be constructible.
jest.mock("ccxt", () => {
  class UnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: UnusedExchange, coinbase: UnusedExchange },
  };
});

import { createTechnicalNode } from "../../src/pipeline/nodes/technical.js";
import { createPatternNode } from "../../src/pipeline/nodes/pattern.js";
import {
  createSentimentNode,
  toCoinalyzeSymbol,
  toCoinalyzeTimeframe,
} from "../../src/pipeline/nodes/sentiment.js";
import { createNewsNode } from "../../src/pipeline/nodes/news.js";
import { createAimlNode } from "../../src/pipeline/nodes/aiml.js";
import { createMergeEnrichedViewNode } from "../../src/pipeline/nodes/mergeEnrichedView.js";
import { createScorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
import { builtinPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import {
  NodeConfigurationError,
  SILENT_NODE_LOGGER,
  type NodeRunContext,
} from "../../src/pipeline/nodeSdk.js";
import type { TechnicalNodeOutput } from "../../src/pipeline/nodes/technical.js";
import type { SentimentNodeOutput } from "../../src/pipeline/nodes/sentiment.js";
import type { NewsNodeOutput } from "../../src/pipeline/nodes/news.js";
import { testSignal } from "./support/testHarness.js";
import { buildFroggyTrendPullbackInputFromEnriched } from "afi-core/analysts/froggy.enrichment_adapter.js";
import { scoreFroggyTrendPullback } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import { defaultUwrConfig } from "afi-core/validators/UniversalWeightingRule.js";
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";

function ctx(config: Record<string, unknown> = {}): NodeRunContext {
  return {
    signal: testSignal(),
    config,
    logger: SILENT_NODE_LOGGER,
    abort: new AbortController().signal,
  };
}

const CANDLES = Array.from({ length: 60 }, (_, i) => ({
  timestamp: 1735689600000 + i * 3600_000,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
  volume: 1000 + i,
}));

describe("technical node", () => {
  it("fetches candles via the price-feed registry and computes the technical lens", async () => {
    const calls: unknown[] = [];
    const node = createTechnicalNode({
      resolvePriceSource: () => "demo",
      getAdapter: (() => ({
        id: "demo",
        getOHLCV: async (params: unknown) => {
          calls.push(params);
          return CANDLES;
        },
      })) as never,
      computeTechnical: (candles) => ({ note: "computed", n: candles.length }) as never,
    });
    const result = await node.run(undefined, ctx({ candleLimit: 60 }));
    const output = result.output as TechnicalNodeOutput;

    expect(calls).toEqual([{ symbol: "BTC/USDT", timeframe: "1h", limit: 60 }]);
    expect(output.category).toBe("technical");
    expect(output.priceSource).toBe("demo");
    expect(output.candles).toHaveLength(60);
    expect(output.technical).toEqual({ note: "computed", n: 60 });
    expect(result.degradations).toEqual([]);
  });

  it("missing AFI_PRICE_FEED_SOURCE surfaces as NodeConfigurationError (always fatal)", async () => {
    const node = createTechnicalNode({
      resolvePriceSource: () => {
        throw new Error("AFI_PRICE_FEED_SOURCE is required for live scoring");
      },
      getAdapter: (() => {
        throw new Error("unreachable");
      }) as never,
      computeTechnical: (() => null) as never,
    });
    await expect(node.run(undefined, ctx())).rejects.toBeInstanceOf(NodeConfigurationError);
  });

  it("provider fetch failures are ordinary (policy-governed) errors", async () => {
    const node = createTechnicalNode({
      resolvePriceSource: () => "blofin",
      getAdapter: (() => ({
        getOHLCV: async () => {
          throw new Error("exchange 502");
        },
      })) as never,
      computeTechnical: (() => null) as never,
    });
    const failure = node.run(undefined, ctx());
    await expect(failure).rejects.toThrow("exchange 502");
    await expect(failure).rejects.not.toBeInstanceOf(NodeConfigurationError);
  });
});

describe("pattern node", () => {
  it("consumes the candles port, detects patterns and merges the fail-soft regime", async () => {
    const node = createPatternNode({
      detect: (candles) => ({ patternName: "hammer", patternConfidence: 0.8, n: candles.length }) as never,
      computeRegime: async () => ({ cyclePhase: "markup", trendState: "trending", volRegime: "normal" }) as never,
    });
    const result = await node.run(CANDLES, ctx());
    const output = result.output as { category: string; pattern: Record<string, unknown> };
    expect(output.category).toBe("pattern");
    expect(output.pattern.patternName).toBe("hammer");
    expect(output.pattern.regime).toEqual({
      cyclePhase: "markup",
      trendState: "trending",
      volRegime: "normal",
    });
    expect(result.degradations).toEqual([]);
  });

  it("a regime failure is recorded and the pattern ships without regime", async () => {
    const node = createPatternNode({
      detect: () => ({ patternName: "doji", patternConfidence: 0.5 }) as never,
      computeRegime: async () => {
        throw new Error("coingecko down");
      },
    });
    const result = await node.run(CANDLES, ctx());
    expect((result.output as { pattern: Record<string, unknown> }).pattern.regime).toBeUndefined();
    expect(result.degradations).toEqual([
      {
        class: "regime-unavailable",
        detail: "pattern regime summary failed; pattern shipped without regime",
      },
    ]);
  });

  it("rejects non-candle input (routing defect surfaces honestly)", async () => {
    const node = createPatternNode({
      detect: (() => null) as never,
      computeRegime: (async () => null) as never,
    });
    await expect(node.run({ not: "candles" }, ctx())).rejects.toThrow(/candle array/);
  });
});

describe("sentiment node", () => {
  it("maps the canonical signal symbol to the Coinalyze convention", () => {
    expect(toCoinalyzeSymbol("BTC/USDT")).toBe("BTCUSDT_PERP.A");
    expect(toCoinalyzeSymbol("eth/usdt")).toBe("ETHUSDT_PERP.A");
    expect(toCoinalyzeSymbol("SOLUSDT")).toBe("SOLUSDT_PERP.A");
    expect(toCoinalyzeTimeframe("1h")).toBe("1h");
    expect(toCoinalyzeTimeframe("15m")).toBe("1h");
    expect(toCoinalyzeTimeframe("1d")).toBe("1d");
    expect(toCoinalyzeTimeframe("1w")).toBe("1d");
    expect(toCoinalyzeTimeframe(undefined)).toBe("1h");
  });

  it("computes sentiment with the mapped symbol and builds the legacy+USS shape", async () => {
    const calls: unknown[] = [];
    const node = createSentimentNode({
      computeSentiment: (async (symbol: string, timeframe: string) => {
        calls.push([symbol, timeframe]);
        return {
          perpSentimentScore: 62,
          fundingRegime: "elevated",
          positioningBias: "crowded-long",
          oiChange24hPct: 3.2,
          oiTrend: "flat",
        };
      }) as never,
    });
    const result = await node.run(undefined, ctx());
    const output = result.output as SentimentNodeOutput;

    expect(calls).toEqual([["BTCUSDT_PERP.A", "1h"]]);
    expect(output.sentiment).toEqual({
      score: 0.62,
      tags: ["crowded-long", "elevated"],
      perpSentimentScore: 62,
      positioningBias: "crowded-long",
      fundingRegime: "elevated",
    });
    expect(result.degradations).toEqual([]);
  });

  it("honors the symbolOverride config", async () => {
    const calls: string[] = [];
    const node = createSentimentNode({
      computeSentiment: (async (symbol: string) => {
        calls.push(symbol);
        return null;
      }) as never,
    });
    await node.run(undefined, ctx({ symbolOverride: "XBTUSD_PERP.0" }));
    expect(calls).toEqual(["XBTUSD_PERP.0"]);
  });

  it("provider unavailability is fail-soft and RECORDED", async () => {
    const node = createSentimentNode({ computeSentiment: (async () => null) as never });
    const result = await node.run(undefined, ctx());
    expect((result.output as SentimentNodeOutput).sentiment).toBeUndefined();
    expect(result.degradations).toEqual([
      { class: "provider-unavailable", detail: "Coinalyze sentiment unavailable for BTCUSDT_PERP.A" },
    ]);
  });
});

describe("news node", () => {
  const item = {
    id: "news-item-1",
    title: "ETF approved",
    source: "wire",
    url: "https://example.org/etf",
    publishedAt: new Date("2026-07-16T12:00:00Z"),
  };

  it("fetches through the configured provider with windowHours from node config", async () => {
    const calls: unknown[] = [];
    const node = createNewsNode({
      createProvider: () => ({
        fetchRecentNews: async (params: unknown) => {
          calls.push(params);
          return {
            hasShockEvent: true,
            shockDirection: "bullish" as const,
            headlines: ["ETF approved"],
            items: [item],
          };
        },
      }),
      computeFeatures: (news) => (news ? ({ hasNewsShock: news.hasShockEvent } as never) : null),
    });
    const result = await node.run(undefined, ctx({ windowHours: 12 }));
    const output = result.output as NewsNodeOutput;

    expect(calls).toEqual([{ symbol: "BTC/USDT", windowHours: 12 }]);
    expect(output.news).toEqual({
      hasShockEvent: true,
      shockDirection: "bullish",
      headlines: ["ETF approved"],
      items: [
        {
          title: "ETF approved",
          source: "wire",
          url: "https://example.org/etf",
          publishedAt: "2026-07-16T12:00:00.000Z",
        },
      ],
    });
    expect(output.newsFeatures).toEqual({ hasNewsShock: true });
    expect(result.degradations).toEqual([]);
  });

  it("no provider configured → declared default summary + recorded 'service-unconfigured'", async () => {
    const node = createNewsNode({
      createProvider: () => null,
      computeFeatures: (news) => (news ? ({ hasNewsShock: false } as never) : null),
    });
    const result = await node.run(undefined, ctx());
    const output = result.output as NewsNodeOutput;
    expect(output.news).toEqual({
      hasShockEvent: false,
      shockDirection: "none",
      headlines: [],
      items: [],
    });
    expect(output.newsFeatures).toBeUndefined();
    expect(result.degradations.map((d) => d.class)).toEqual(["service-unconfigured"]);
  });

  it("provider failure → declared default summary + recorded 'provider-error'", async () => {
    const node = createNewsNode({
      createProvider: () => ({
        fetchRecentNews: async () => {
          throw new Error("newsdata 429");
        },
      }),
      computeFeatures: () => null,
    });
    const result = await node.run(undefined, ctx());
    expect(result.degradations.map((d) => d.class)).toEqual(["provider-error"]);
    expect((result.output as NewsNodeOutput).news.hasShockEvent).toBe(false);
  });
});

describe("aiml node", () => {
  const mergedView = () =>
    ({
      signalId: "sig-1",
      symbol: "BTC/USDT",
      market: "perp",
      timeframe: "1h",
      technical: { emaDistancePct: 1.2 },
      pattern: { patternName: "hammer" },
      sentiment: { score: 0.6, tags: [] },
      newsFeatures: undefined,
      enrichmentMeta: { categories: ["technical", "pattern", "sentiment"] },
      lenses: [{ type: "technical", version: "v1", payload: {} }],
    }) as unknown as FroggyEnrichedView;

  it("TINY_BRAINS_URL unset → passthrough + recorded 'service-unconfigured'", async () => {
    // The node calls the client EXACTLY like the live adapter (whose client
    // fail-softs to null when unconfigured); the probe only classifies the
    // recorded degradation.
    let clientCalled = false;
    const node = createAimlNode({
      isConfigured: () => false,
      fetchAiMl: (async () => {
        clientCalled = true;
        return null;
      }) as never,
    });
    const view = mergedView();
    const result = await node.run(view, ctx());
    expect(clientCalled).toBe(true); // adapter-equivalent client seam behavior
    expect(result.output).toBe(view); // passthrough, unaugmented
    expect(result.degradations.map((d) => d.class)).toEqual(["service-unconfigured"]);
  });

  it("prediction augments the view exactly like the live adapter (aiMl + lens + category)", async () => {
    const node = createAimlNode({
      isConfigured: () => true,
      fetchAiMl: (async (input: unknown) => {
        expect((input as { traceId: string }).traceId).toBe("sig-1");
        return { convictionScore: 0.71, direction: "long", regime: "trending" };
      }) as never,
    });
    const result = await node.run(mergedView(), ctx());
    const output = result.output as FroggyEnrichedView & { lenses: Array<{ type: string; payload: unknown }> };

    expect(output.aiMl).toEqual({ convictionScore: 0.71, direction: "long", regime: "trending" });
    expect(output.enrichmentMeta?.categories).toEqual([
      "technical",
      "pattern",
      "sentiment",
      "aiMl",
    ]);
    expect(output.lenses.map((l) => l.type)).toEqual(["technical", "aiMl"]);
    expect(output.lenses[1].payload).toEqual({ ensembleScore: 0.71, modelTags: ["trending"] });
    expect(result.degradations).toEqual([]);
  });

  it("configured but unavailable → passthrough + recorded 'service-unavailable'", async () => {
    const node = createAimlNode({
      isConfigured: () => true,
      fetchAiMl: (async () => undefined) as never,
    });
    const view = mergedView();
    const result = await node.run(view, ctx());
    expect(result.output).toBe(view);
    expect(result.degradations.map((d) => d.class)).toEqual(["service-unavailable"]);
  });
});

describe("mergeEnrichedView node — byte-level agreement with the live adapter (DAG mode)", () => {
  const technicalPayload = {
    ema20: 101.5,
    ema50: 99.2,
    rsi14: 58.3,
    atrPct: 2.1,
    volumeRatio: 1.4,
    emaDistancePct: 1.8,
    isInValueSweetSpot: true,
    trendBias: "bullish",
  };
  const patternPayload = {
    patternName: "hammer",
    patternConfidence: 0.8,
    regime: {
      cyclePhase: "markup",
      trendState: "trending",
      volRegime: "normal",
      topBottomRisk: "neutral",
      externalLabels: { fearGreedLabel: "greed" },
    },
  };
  const sentimentObject = {
    score: 0.62,
    tags: ["crowded-long", "elevated"],
    perpSentimentScore: 62,
    positioningBias: "crowded-long",
    fundingRegime: "elevated",
  };
  const newsObject = {
    hasShockEvent: false,
    shockDirection: "none" as const,
    headlines: [] as string[],
    items: [] as never[],
  };
  const newsFeatures = {
    hasNewsShock: false,
    headlineCount: 0,
    mostRecentMinutesAgo: null,
    oldestMinutesAgo: null,
    hasExchangeEvent: false,
    hasRegulatoryEvent: false,
    hasMacroEvent: false,
  };

  function stripVolatile(view: Record<string, unknown>): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(view));
    if (clone.enrichmentMeta) delete clone.enrichmentMeta.enrichedAt;
    return clone;
  }

  it("assembles the FROZEN FroggyEnrichedView + lenses + _priceFeedMetadata (the byte contract the deleted legacy adapter plugin proved; end-to-end bytes are pinned by the oracle enriched goldens)", async () => {
    const node = createMergeEnrichedViewNode();
    const result = await node.run(
      {
        parents: {
          technical: {
            category: "technical",
            technical: technicalPayload,
            candles: [],
            priceSource: "demo",
          },
          pattern: { category: "pattern", pattern: patternPayload },
          sentiment: { category: "sentiment", sentiment: sentimentObject },
          news: { category: "news", news: newsObject, newsFeatures },
        },
      },
      ctx()
    );

    // FROZEN merged view: captured from the merge node at the moment the
    // legacy froggy-enrichment-adapter plugin was deleted (D-FCP-9), when the
    // two were proven field-by-field identical. Any diff here is a behavior
    // change to the merged-view contract and must be reviewed as such.
    expect(stripVolatile(result.output as Record<string, unknown>)).toEqual({
      signalId: "sig-graph-proof-0001",
      symbol: "BTC/USDT",
      market: "perp",
      timeframe: "1h",
      technical: {
        emaDistancePct: 1.8,
        isInValueSweetSpot: true,
        brokeEmaWithBody: false,
        indicators: { rsi: 58.3, ema_20: 101.5, ema_50: 99.2, volume_ratio: 1.4 },
      },
      pattern: patternPayload,
      sentiment: sentimentObject,
      news: newsObject,
      newsFeatures,
      enrichmentMeta: {
        categories: ["technical", "pattern", "sentiment", "news"],
        enrichedBy: "froggy-enrichment-adapter",
      },
      lenses: [
        { type: "technical", version: "v1", payload: technicalPayload },
        { type: "pattern", version: "v1", payload: patternPayload },
        {
          type: "sentiment",
          version: "v1",
          payload: {
            perpSentimentScore: 62,
            positioningBias: "crowded-long",
            fundingRegime: "elevated",
          },
        },
        { type: "news", version: "v1", payload: newsObject },
      ],
      _priceFeedMetadata: {
        priceSource: "demo",
        venueType: "demo",
        marketType: "perp",
        technicalIndicators: technicalPayload,
        patternSignals: patternPayload,
      },
      _enrichmentSummary:
        "Applied enrichment legos: technical, pattern, sentiment, news. " +
        "Trend: bullish (EMA20=101.50, RSI=58). Pattern: hammer. " +
        "Regime: markup (trending, normal vol, greed)",
    });
    expect(result.degradations).toEqual([]);
  });

  it("skipped/degraded parents contribute nothing (empty namespaces, never fabricated data)", async () => {
    const node = createMergeEnrichedViewNode();
    const result = await node.run(
      {
        parents: {
          technical: {},
          pattern: {},
          sentiment: { category: "sentiment", sentiment: sentimentObject },
          news: {},
        },
      },
      ctx()
    );
    const view = result.output as Record<string, unknown> & {
      enrichmentMeta: { categories: string[] };
      _priceFeedMetadata: { priceSource: string };
    };
    expect(view.technical).toBeUndefined();
    expect(view.pattern).toBeUndefined();
    expect(view.news).toBeUndefined();
    expect(view.sentiment).toEqual(sentimentObject);
    expect(view.enrichmentMeta.categories).toEqual(["sentiment"]);
    expect(view._priceFeedMetadata.priceSource).toBe("unavailable");
  });

  it("two parents claiming the same category fail the merge (conflictRule 'error')", async () => {
    const node = createMergeEnrichedViewNode();
    await expect(
      node.run(
        {
          parents: {
            "news-a": { category: "news", news: newsObject, newsFeatures: undefined },
            "news-b": { category: "news", news: newsObject, newsFeatures: undefined },
          },
        },
        ctx()
      )
    ).rejects.toThrow(/merge conflict: category 'news'/);
  });
});

describe("scorer node — verbatim afi-core composition (RC-6)", () => {
  const enriched = (): FroggyEnrichedView =>
    ({
      signalId: "sig-scorer-node-test",
      symbol: "BTCUSDT",
      market: "crypto",
      timeframe: "4h",
      technical: {
        emaDistancePct: 1.5,
        isInValueSweetSpot: true,
        brokeEmaWithBody: false,
        indicators: { rsi: 55, ema_20: 100, ema_50: 98, volume_ratio: 1.2 },
      },
      pattern: { patternName: "hammer", patternConfidence: 0.8 },
      sentiment: { score: 0.6, tags: ["balanced", "normal"] },
      news: { hasShockEvent: false, shockDirection: "none", headlines: [] },
      enrichmentMeta: { categories: ["technical", "pattern", "sentiment", "news"] },
    }) as unknown as FroggyEnrichedView;

  it("emits analysis byte-identical to the direct afi-core call + uwrResolvedSource verbatim", async () => {
    const node = createScorerFroggyTrendPullbackNode();
    const view = enriched();
    const result = await node.run(view, ctx());
    const output = result.output as FroggyEnrichedView & {
      analysis: unknown;
      uwrResolvedSource: string;
    };

    const expected = scoreFroggyTrendPullback(
      buildFroggyTrendPullbackInputFromEnriched(view),
      defaultUwrConfig,
      view
    );
    // scoredAt is the only wall-clock field — mask it, everything else must
    // agree exactly (analystScore, uwrAxes, rationale, tags, ...).
    const mask = (analysis: Record<string, unknown>) => {
      const clone = JSON.parse(JSON.stringify(analysis));
      delete clone.analystScore.scoredAt;
      return clone;
    };
    expect(mask(output.analysis as Record<string, unknown>)).toEqual(
      mask(expected as unknown as Record<string, unknown>)
    );
    expect(output.uwrResolvedSource).toBe("builtin");
    expect(output.signalId).toBe("sig-scorer-node-test");
    expect(result.degradations).toEqual([]);
  });

  it("rejects non-view input honestly", async () => {
    const node = createScorerFroggyTrendPullbackNode();
    await expect(node.run(42, ctx())).rejects.toThrow(/FroggyEnrichedView/);
  });
});

describe("builtin plugin registry (build-time binding)", () => {
  it("binds exactly the seven governed plugin identities", () => {
    expect(builtinPluginRegistry().keys()).toEqual([
      "afi-analysis-aiml@1.0.0",
      "afi-analysis-news@1.0.0",
      "afi-analysis-pattern@1.0.0",
      "afi-analysis-sentiment@1.0.0",
      "afi-analysis-technical@1.0.0",
      "afi-merge-enriched-view@1.0.0",
      "afi-scorer-froggy-trend-pullback@1.0.0",
    ]);
  });
});
