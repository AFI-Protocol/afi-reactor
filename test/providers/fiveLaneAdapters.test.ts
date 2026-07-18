/**
 * FLPR-GOV — five-lane provider runtime proofs.
 *
 *  - the four NEW adapters (cftc-cot sentiment, coinalyze BYOK sentiment,
 *    sec-edgar news, tiny-brains aiMl) + the two pattern adapters
 *    (first-party candlestick, tiny-brains service): request construction,
 *    header-key placement, timeout/abort, transport failure, normalization,
 *    canonical schema validity, honesty on unmapped symbols
 *  - provider-selection proofs (same node code, different instances, correct
 *    adapter invoked, credentials never cross instances) for pattern,
 *    sentiment, and news
 *  - laneView projections (closed sentiment tag vocabulary — inertness)
 *  - scorer-input inertness: sentiment/news content cannot move the analyst
 *  - the five-lane graph: five lanes → one merge → scorer; exactly one result
 *    per category; aiMl joins as a lane; duplicate category fails the merge
 */
import { describe, it, expect, jest } from "@jest/globals";

jest.mock("ccxt", () => {
  class UnusedExchange {}
  return { __esModule: true, default: { blofin: UnusedExchange, coinbase: UnusedExchange } };
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProviderRuntime,
  createAdapterRegistry,
  createProviderRecordStore,
  createCategoryOutputValidator,
  createTechnicalLocalAdapter,
  createPatternCandlestickAdapter,
  createPatternTinyBrainsAdapter,
  createSentimentCftcCotAdapter,
  createSentimentCoinalyzeAdapter,
  createNewsSecEdgarAdapter,
  createHttpNewsAdapter,
  createAimlTinyBrainsAdapter,
  createProviderBackedNode,
  InMemorySecretResolver,
  CredentialUnavailableError,
  type ProviderRecord,
  type CredentialRefRecord,
  type ProviderInstanceRecord,
  type ProviderAdapter,
} from "../../src/providers/index.js";
import {
  viewAiMl,
  viewPattern,
  viewSentiment,
  viewTechnical,
  type SentimentAxisObservation,
} from "../../src/pipeline/nodes/laneView.js";
import { mergeEnrichedViewNode } from "../../src/pipeline/nodes/mergeEnrichedView.js";
import { detectPatterns } from "../../src/enrichment/patternRecognition.js";
import { computeTechnicalEnrichment } from "../../src/enrichment/technicalIndicators.js";
import { computeNewsFeatures } from "../../src/news/newsFeatures.js";
import { NewsDataProvider } from "../../src/providers/clients/newsdataNewsProvider.js";
import { GraphExecutor } from "../../src/pipeline/executor.js";
import { createPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import { ok, SILENT_NODE_LOGGER, type AnalysisNodePlugin } from "../../src/pipeline/nodeSdk.js";
import { demoPriceFeedAdapter } from "../support/deterministicPriceFeedAdapter.js";
import { testSignal } from "../pipeline/support/testHarness.js";
import { buildFroggyTrendPullbackInputFromEnriched } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { PipelineManifest } from "../../src/pipeline/manifestTypes.js";

const SECRET_COINALYZE = "zzAFI-COINALYZE-SECRET-91ac";
const SECRET_NEWSDATA = "zzAFI-NEWSDATA-SECRET-77fe";

// --------------------------------------------------------------------------
// Records (mirror the governed registry shapes; test-local fixtures).
// --------------------------------------------------------------------------
function provider(p: Partial<ProviderRecord> & { providerId: string; adapterId: string; supportedCategories: ProviderRecord["supportedCategories"] }): ProviderRecord {
  return {
    schema: "afi.provider.v1",
    recordVersion: "1.0.0",
    displayName: p.providerId,
    executionClass: "remote",
    deterministic: false,
    requiresCredential: false,
    status: "active",
    ...p,
  } as ProviderRecord;
}
function instance(i: Partial<ProviderInstanceRecord> & { providerInstanceId: string; category: ProviderInstanceRecord["category"]; providerId: string; adapterId: string }): ProviderInstanceRecord {
  return {
    schema: "afi.provider-instance.v1",
    recordVersion: "1.0.0",
    tenant: "reference",
    adapterVersion: "1.0.0",
    status: "active",
    ...i,
  } as ProviderInstanceRecord;
}

const PROVIDERS: ProviderRecord[] = [
  provider({ providerId: "afi-provider-technical-local", adapterId: "afi-adapter-technical-local", supportedCategories: ["technical"], executionClass: "local", deterministic: true }),
  provider({ providerId: "afi-provider-pattern-candlestick", adapterId: "afi-adapter-pattern-candlestick", supportedCategories: ["pattern"], executionClass: "local", deterministic: true }),
  provider({ providerId: "afi-provider-pattern-tiny-brains", adapterId: "afi-adapter-pattern-tiny-brains", supportedCategories: ["pattern"], deterministic: true }),
  provider({ providerId: "afi-provider-sentiment-cftc-cot", adapterId: "afi-adapter-sentiment-cftc-cot", supportedCategories: ["sentiment"] }),
  provider({ providerId: "afi-provider-sentiment-coinalyze", adapterId: "afi-adapter-sentiment-coinalyze", supportedCategories: ["sentiment"], requiresCredential: true, credentialKind: "apiKeyHeader" }),
  provider({ providerId: "afi-provider-news-sec-edgar", adapterId: "afi-adapter-news-sec-edgar", supportedCategories: ["news"] }),
  provider({ providerId: "afi-provider-news-http", adapterId: "afi-adapter-news-http", supportedCategories: ["news"], requiresCredential: true, credentialKind: "apiKeyHeader" }),
  provider({ providerId: "afi-provider-aiml-tiny-brains", adapterId: "afi-adapter-aiml-tiny-brains", supportedCategories: ["aiMl"] }),
];

const CREDENTIAL_REFS: CredentialRefRecord[] = [
  { schema: "afi.credential-ref.v1", credentialRef: "credential-coinalyze-reference", recordVersion: "1.0.0", tenant: "reference", providerId: "afi-provider-sentiment-coinalyze", credentialKind: "apiKeyHeader", status: "active" },
  { schema: "afi.credential-ref.v1", credentialRef: "credential-newsdata-reference", recordVersion: "1.0.0", tenant: "reference", providerId: "afi-provider-news-http", credentialKind: "apiKeyHeader", status: "active" },
];

const INSTANCES: ProviderInstanceRecord[] = [
  instance({ providerInstanceId: "pi-technical-local", category: "technical", providerId: "afi-provider-technical-local", adapterId: "afi-adapter-technical-local" }),
  instance({ providerInstanceId: "pi-pattern-candlestick", category: "pattern", providerId: "afi-provider-pattern-candlestick", adapterId: "afi-adapter-pattern-candlestick" }),
  instance({ providerInstanceId: "pi-pattern-tiny-brains", category: "pattern", providerId: "afi-provider-pattern-tiny-brains", adapterId: "afi-adapter-pattern-tiny-brains" }),
  instance({ providerInstanceId: "pi-sentiment-cftc", category: "sentiment", providerId: "afi-provider-sentiment-cftc-cot", adapterId: "afi-adapter-sentiment-cftc-cot" }),
  instance({ providerInstanceId: "pi-sentiment-coinalyze", category: "sentiment", providerId: "afi-provider-sentiment-coinalyze", adapterId: "afi-adapter-sentiment-coinalyze", credentialRef: "credential-coinalyze-reference" }),
  instance({ providerInstanceId: "pi-news-edgar", category: "news", providerId: "afi-provider-news-sec-edgar", adapterId: "afi-adapter-news-sec-edgar", invocation: { windowHours: 24 } }),
  instance({ providerInstanceId: "pi-news-newsdata", category: "news", providerId: "afi-provider-news-http", adapterId: "afi-adapter-news-http", credentialRef: "credential-newsdata-reference" }),
  instance({ providerInstanceId: "pi-aiml-tiny-brains", category: "aiMl", providerId: "afi-provider-aiml-tiny-brains", adapterId: "afi-adapter-aiml-tiny-brains" }),
];

function buildRuntime(adapters: ProviderAdapter[], resolver?: InMemorySecretResolver) {
  return new ProviderRuntime({
    adapters: createAdapterRegistry(adapters),
    records: createProviderRecordStore({ providers: PROVIDERS, credentialRefs: CREDENTIAL_REFS, providerInstances: INSTANCES }),
    resolver:
      resolver ??
      new InMemorySecretResolver([
        { tenant: "reference", credentialRef: "credential-coinalyze-reference", value: SECRET_COINALYZE },
        { tenant: "reference", credentialRef: "credential-newsdata-reference", value: SECRET_NEWSDATA },
      ]),
    outputValidator: createCategoryOutputValidator(),
  });
}

function ctx(extra: { input?: unknown; config?: Record<string, unknown> } = {}) {
  return {
    signal: testSignal(),
    input: extra.input,
    config: extra.config ?? {},
    logger: SILENT_NODE_LOGGER,
    abort: new AbortController().signal,
  };
}

/** 30 candles ending in a clean bullish engulfing (deterministic). */
function engulfingCandles(): AfiCandle[] {
  const candles: AfiCandle[] = [];
  for (let i = 0; i < 28; i++) {
    const base = 100 + Math.sin(i / 3) * 2;
    candles.push({ timestamp: 1700000000000 + i * 3600_000, open: base, high: base + 1.5, low: base - 1.5, close: base + 0.5, volume: 1000 + i });
  }
  // c2: bearish; c3: bullish body engulfing c2's body.
  candles.push({ timestamp: 1700000000000 + 28 * 3600_000, open: 105, high: 105.5, low: 99.5, close: 100, volume: 1500 });
  candles.push({ timestamp: 1700000000000 + 29 * 3600_000, open: 99.5, high: 106.5, low: 99, close: 106, volume: 2000 });
  return candles;
}

interface FetchCall {
  url: string;
  init: RequestInit;
}
function cannedFetch(calls: FetchCall[], body: unknown, okStatus = true): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: okStatus, status: okStatus ? 200 : 503, statusText: okStatus ? "OK" : "unavailable", json: async () => body } as Response;
  }) as typeof fetch;
}

const PATTERN_SERVICE_RESPONSE = JSON.parse(
  readFileSync(join(process.cwd(), "test/providers/fixtures/patternServiceResponse.golden.json"), "utf-8")
) as { series: unknown; motifs: unknown[]; discords: unknown[]; changePoints: unknown[]; pivots: unknown[] };

// --------------------------------------------------------------------------
// pattern — first-party candlestick adapter (the scoring-equivalence anchor)
// --------------------------------------------------------------------------
describe("FLPR-GOV — pattern candlestick adapter (first-party local)", () => {
  it("emits the governed result with the candlestick block computed by the SAME kernel", async () => {
    const rt = buildRuntime([createPatternCandlestickAdapter()]);
    const candles = engulfingCandles();
    const result = await rt.invoke({ providerInstanceId: "pi-pattern-candlestick", recordVersion: "1.0.0" }, ctx({ input: candles }));
    expect(result.category).toBe("pattern");
    expect(result.motifs).toEqual([]);
    const detection = detectPatterns(candles)!;
    const cs = result.candlestick as { patternName: string; patternConfidence: number };
    expect(cs.patternName).toBe(detection.patternName);
    expect(cs.patternName).toBe("bullish engulfing");
    expect(cs.patternConfidence).toBe(75);
  });

  it("omits the candlestick block when no dominant pattern fires (still governed-valid)", async () => {
    const rt = buildRuntime([createPatternCandlestickAdapter()]);
    // All-bullish candles with expanding ranges: no engulfing (no bearish
    // predecessor), no pin bar (small wicks), no inside bar (expanding range).
    const flat: AfiCandle[] = Array.from({ length: 24 }, (_, i) => ({
      timestamp: 1700000000000 + i * 3600_000,
      open: 100,
      high: 100.6 + i * 0.01,
      low: 99.9 - i * 0.01,
      close: 100.5,
      volume: 1000,
    }));
    const result = await rt.invoke({ providerInstanceId: "pi-pattern-candlestick", recordVersion: "1.0.0" }, ctx({ input: flat }));
    expect(result.category).toBe("pattern");
    expect(detectPatterns(flat)?.patternName).toBeUndefined();
    expect(result.candlestick).toBeUndefined();
  });

  it("fails closed on a missing candles input", async () => {
    const rt = buildRuntime([createPatternCandlestickAdapter()]);
    await expect(rt.invoke({ providerInstanceId: "pi-pattern-candlestick", recordVersion: "1.0.0" }, ctx())).rejects.toThrow(/candles/);
  });
});

// --------------------------------------------------------------------------
// pattern — tiny-brains service adapter
// --------------------------------------------------------------------------
describe("FLPR-GOV — pattern tiny-brains adapter (self-hosted service)", () => {
  it("derives the close series from the candles port and passes the service result through", async () => {
    const seen: unknown[] = [];
    const rt = buildRuntime([
      createPatternTinyBrainsAdapter({
        callService: (async (request: unknown) => {
          seen.push(request);
          return PATTERN_SERVICE_RESPONSE;
        }) as never,
      }),
    ]);
    const candles = engulfingCandles();
    const result = await rt.invoke({ providerInstanceId: "pi-pattern-tiny-brains", recordVersion: "1.0.0" }, ctx({ input: candles }));
    const req = seen[0] as { seriesId: string; values: number[]; timestamps?: number[] };
    expect(req.values).toEqual(candles.map((c) => c.close));
    expect(req.timestamps).toEqual(candles.map((c) => c.timestamp));
    expect(req.seriesId).toBe("sig-graph-proof-0001:candles:close");
    expect(result.category).toBe("pattern");
    expect(result.motifs).toEqual(PATTERN_SERVICE_RESPONSE.motifs);
    expect(result.candlestick).toBeUndefined();
  });

  it("fails CLOSED on service error (no fabricated result, no fallback)", async () => {
    const rt = buildRuntime([
      createPatternTinyBrainsAdapter({
        callService: (async () => {
          throw new Error("pattern service error: 503");
        }) as never,
      }),
    ]);
    await expect(
      rt.invoke({ providerInstanceId: "pi-pattern-tiny-brains", recordVersion: "1.0.0" }, ctx({ input: engulfingCandles() }))
    ).rejects.toThrow(/503/);
  });

  it("provider-selection proof: the SAME node code invokes either pattern instance by ref alone", async () => {
    const rt = buildRuntime([
      createPatternCandlestickAdapter(),
      createPatternTinyBrainsAdapter({ callService: (async () => PATTERN_SERVICE_RESPONSE) as never }),
    ]);
    const node = createProviderBackedNode({ pluginId: "afi-analysis-pattern", pluginVersion: "2.0.0" }, "pattern", rt);
    const candles = engulfingCandles();
    const run = (ref: string) =>
      node.run(candles, {
        signal: testSignal(),
        config: {},
        logger: SILENT_NODE_LOGGER,
        abort: new AbortController().signal,
        providerInstanceRef: { providerInstanceId: ref, recordVersion: "1.0.0" },
      });
    const a = await run("pi-pattern-candlestick");
    const b = await run("pi-pattern-tiny-brains");
    expect((a.output as { candlestick?: unknown }).candlestick).toBeDefined();
    expect((b.output as { candlestick?: unknown }).candlestick).toBeUndefined();
    expect((b.output as { motifs: unknown[] }).motifs).toEqual(PATTERN_SERVICE_RESPONSE.motifs);
  });
});

// --------------------------------------------------------------------------
// sentiment — CFTC COT (keyless reference)
// --------------------------------------------------------------------------
const COT_ROW = {
  market_and_exchange_names: "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
  report_date_as_yyyy_mm_dd: "2026-07-14T00:00:00.000",
  lev_money_positions_long: "60000",
  lev_money_positions_short: "40000",
  open_interest_all: "100000",
  change_in_open_interest_all: "5000",
};

describe("FLPR-GOV — sentiment CFTC COT adapter (keyless)", () => {
  it("derives weekly positioning/longShort/openInterest axes from the latest report (keyless, no secret anywhere)", async () => {
    const calls: FetchCall[] = [];
    const rt = buildRuntime([createSentimentCftcCotAdapter({ fetchImpl: cannedFetch(calls, [COT_ROW]) })]);
    const result = await rt.invoke({ providerInstanceId: "pi-sentiment-cftc", recordVersion: "1.0.0" }, ctx());
    expect(calls[0].url).toContain("publicreporting.cftc.gov");
    expect(calls[0].url).toContain("BITCOIN");
    const axes = result.axes as SentimentAxisObservation[];
    const byAxis = Object.fromEntries(axes.map((a) => [a.axis, a]));
    expect(byAxis.positioning.score).toBe(0.2); // (60k-40k)/(60k+40k)
    expect(byAxis.positioning.horizon).toBe("weekly");
    expect(byAxis.longShort.score).toBe(0.2);
    expect(byAxis.openInterest.score).toBe(0.05); // 5k/100k
  });

  it("an unmapped symbol yields an HONEST empty axes result (never a fabricated default market)", async () => {
    const calls: FetchCall[] = [];
    const rt = buildRuntime([createSentimentCftcCotAdapter({ fetchImpl: cannedFetch(calls, [COT_ROW]) })]);
    const signal = testSignal();
    (signal.facts as Record<string, unknown>).symbol = "FOO/USD";
    const result = await rt.invoke(
      { providerInstanceId: "pi-sentiment-cftc", recordVersion: "1.0.0" },
      { ...ctx(), signal }
    );
    expect(result.axes).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("fails CLOSED on transport error (degradation is the node policy's job)", async () => {
    const rt = buildRuntime([createSentimentCftcCotAdapter({ fetchImpl: cannedFetch([], {}, false) })]);
    await expect(rt.invoke({ providerInstanceId: "pi-sentiment-cftc", recordVersion: "1.0.0" }, ctx())).rejects.toThrow(/503/);
  });
});

// --------------------------------------------------------------------------
// sentiment — Coinalyze (BYOK header)
// --------------------------------------------------------------------------
function coinalyzeBody(values: number[]): unknown {
  return [{ history: values.map((v, i) => ({ t: 1700000000 + i, value: v })) }];
}

describe("FLPR-GOV — sentiment Coinalyze adapter (BYOK header)", () => {
  it("sends the key ONLY as the api-key header, derives the enum-coded axes, and never leaks the secret", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = String(url).includes("funding-rate") ? coinalyzeBody([0.001, 0.0015]) : coinalyzeBody([100, 110]);
      return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
    }) as typeof fetch;
    const rt = buildRuntime([createSentimentCoinalyzeAdapter({ fetchImpl })]);
    const result = await rt.invoke({ providerInstanceId: "pi-sentiment-coinalyze", recordVersion: "1.0.0" }, ctx());
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url).toContain("api.coinalyze.net");
      expect(call.url).toContain("BTCUSDT_PERP.A");
      expect(call.url).not.toContain(SECRET_COINALYZE);
      expect((call.init.headers as Record<string, string>)["api-key"]).toBe(SECRET_COINALYZE);
    }
    const axes = result.axes as SentimentAxisObservation[];
    const byAxis = Object.fromEntries(axes.map((a) => [a.axis, a]));
    expect(byAxis.funding.score).toBe(0.5); // 0.15% per period → elevated_positive
    expect(byAxis.openInterest.score).toBe(0.5); // +10% / 20
    expect(byAxis.positioning.score).toBe(0.6); // crowded_long (funding elevated + OI rising)
    expect(JSON.stringify(result)).not.toContain(SECRET_COINALYZE);
  });

  it("fails closed without a credential (resolver never provisioned)", async () => {
    const rt = buildRuntime(
      [createSentimentCoinalyzeAdapter({ fetchImpl: cannedFetch([], coinalyzeBody([0])) })],
      new InMemorySecretResolver([])
    );
    await expect(rt.invoke({ providerInstanceId: "pi-sentiment-coinalyze", recordVersion: "1.0.0" }, ctx())).rejects.toBeInstanceOf(
      CredentialUnavailableError
    );
  });

  it("provider-selection proof + credential isolation: the keyless CFTC instance NEVER touches the resolver", async () => {
    const resolver = new InMemorySecretResolver([
      { tenant: "reference", credentialRef: "credential-coinalyze-reference", value: SECRET_COINALYZE },
      { tenant: "reference", credentialRef: "credential-newsdata-reference", value: SECRET_NEWSDATA },
    ]);
    const spy = jest.spyOn(resolver, "resolve");
    const rt = buildRuntime(
      [
        createSentimentCftcCotAdapter({ fetchImpl: cannedFetch([], [COT_ROW]) }),
        createSentimentCoinalyzeAdapter({
          fetchImpl: (async (url: RequestInfo | URL) =>
            ({ ok: true, status: 200, statusText: "OK", json: async () => coinalyzeBody(String(url).includes("funding") ? [0.0001] : [100, 101]) }) as Response) as typeof fetch,
        }),
      ],
      resolver
    );
    const node = createProviderBackedNode({ pluginId: "afi-analysis-sentiment", pluginVersion: "2.0.0" }, "sentiment", rt);
    const run = (ref: string) =>
      node.run(undefined, {
        signal: testSignal(),
        config: {},
        logger: SILENT_NODE_LOGGER,
        abort: new AbortController().signal,
        providerInstanceRef: { providerInstanceId: ref, recordVersion: "1.0.0" },
      });
    const keyless = await run("pi-sentiment-cftc");
    expect(spy).not.toHaveBeenCalled();
    expect(((keyless.output as { axes: SentimentAxisObservation[] }).axes).length).toBeGreaterThan(0);
    const byok = await run("pi-sentiment-coinalyze");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].credentialRef).toBe("credential-coinalyze-reference");
    expect((byok.output as { category: string }).category).toBe("sentiment");
  });
});

// --------------------------------------------------------------------------
// news — SEC EDGAR (keyless government source)
// --------------------------------------------------------------------------
const EDGAR_BODY = {
  hits: {
    hits: [
      {
        _source: {
          adsh: "0001234567-26-000123",
          ciks: ["0001234567"],
          display_names: ["Example Digital Corp (EXDG) (CIK 0001234567)"],
          root_forms: ["8-K"],
          file_date: "2026-07-18",
        },
      },
      {
        _source: {
          adsh: "0001234567-26-000122",
          ciks: ["0001234567"],
          display_names: ["Example Digital Corp (EXDG) (CIK 0001234567)"],
          root_forms: ["10-Q"],
          file_date: "2026-07-17",
        },
      },
      {
        _source: {
          adsh: "0009999999-25-000001",
          ciks: ["0009999999"],
          display_names: ["Old Filer Inc"],
          root_forms: ["10-K"],
          file_date: "2025-01-01",
        },
      },
    ],
  },
};

describe("FLPR-GOV — news SEC EDGAR adapter (keyless)", () => {
  const NOW = new Date("2026-07-18T12:00:00.000Z");

  it("queries the fixed EDGAR host with the descriptive User-Agent and normalizes filings to the news shape", async () => {
    const calls: FetchCall[] = [];
    const rt = buildRuntime([
      createNewsSecEdgarAdapter({ fetchImpl: cannedFetch(calls, EDGAR_BODY), now: () => NOW }),
    ]);
    const result = await rt.invoke(
      { providerInstanceId: "pi-news-edgar", recordVersion: "1.0.0" },
      ctx({ config: { windowHours: 48 } })
    );
    expect(calls[0].url).toContain("efts.sec.gov");
    expect(calls[0].url).toContain("bitcoin");
    expect((calls[0].init.headers as Record<string, string>)["User-Agent"]).toContain("AFI-Protocol");
    const news = result.news as { hasShockEvent: boolean; shockDirection: string; items: { source: string; url: string; title: string }[] };
    expect(news.hasShockEvent).toBe(true);
    expect(news.shockDirection).toBe("unknown");
    expect(news.items).toHaveLength(2); // the 2025 filing is outside the window
    expect(news.items[0].source).toBe("sec-edgar");
    expect(news.items[0].url).toContain("https://www.sec.gov/Archives/edgar/data/1234567/");
    expect(result.newsFeatures).toBeDefined();
  });

  it("an unmapped symbol yields the honest empty summary (no fabricated query)", async () => {
    const calls: FetchCall[] = [];
    const rt = buildRuntime([createNewsSecEdgarAdapter({ fetchImpl: cannedFetch(calls, EDGAR_BODY), now: () => NOW })]);
    const signal = testSignal();
    (signal.facts as Record<string, unknown>).symbol = "FOO/USD";
    const result = await rt.invoke({ providerInstanceId: "pi-news-edgar", recordVersion: "1.0.0" }, { ...ctx(), signal });
    expect((result.news as { hasShockEvent: boolean }).hasShockEvent).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("fails SOFT to the honest empty summary on transport error (visible, never fabricated)", async () => {
    const rt = buildRuntime([createNewsSecEdgarAdapter({ fetchImpl: cannedFetch([], {}, false), now: () => NOW })]);
    const result = await rt.invoke({ providerInstanceId: "pi-news-edgar", recordVersion: "1.0.0" }, ctx());
    expect((result.news as { hasShockEvent: boolean }).hasShockEvent).toBe(false);
    expect((result.news as { items: unknown[] }).items).toEqual([]);
  });

  it("provider-selection proof: the SAME news node invokes edgar (keyless) or newsdata (BYOK) by ref alone", async () => {
    const resolver = new InMemorySecretResolver([
      { tenant: "reference", credentialRef: "credential-newsdata-reference", value: SECRET_NEWSDATA },
    ]);
    const spy = jest.spyOn(resolver, "resolve");
    const newsdataCalls: FetchCall[] = [];
    const rt = buildRuntime(
      [
        createNewsSecEdgarAdapter({ fetchImpl: cannedFetch([], EDGAR_BODY), now: () => NOW }),
        createHttpNewsAdapter({
          createProvider: ({ apiKey, fetchImpl }) => new NewsDataProvider(apiKey, { fetchImpl }),
          computeFeatures: computeNewsFeatures,
          fetchImpl: cannedFetch(newsdataCalls, { status: "success", totalResults: 0, results: [] }),
        }),
      ],
      resolver
    );
    const node = createProviderBackedNode({ pluginId: "afi-analysis-news", pluginVersion: "2.0.0" }, "news", rt);
    const run = (ref: string) =>
      node.run(undefined, {
        signal: testSignal(),
        config: {},
        logger: SILENT_NODE_LOGGER,
        abort: new AbortController().signal,
        providerInstanceRef: { providerInstanceId: ref, recordVersion: "1.0.0" },
      });
    const edgar = await run("pi-news-edgar");
    expect(spy).not.toHaveBeenCalled();
    expect((edgar.output as { category: string }).category).toBe("news");
    const newsdata = await run("pi-news-newsdata");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].credentialRef).toBe("credential-newsdata-reference");
    expect((newsdata.output as { category: string }).category).toBe("news");
    expect((newsdataCalls[0].init.headers as Record<string, string>)["X-ACCESS-KEY"]).toBe(SECRET_NEWSDATA);
  });
});

// --------------------------------------------------------------------------
// aiMl — tiny-brains adapter (first-party, joined lane)
// --------------------------------------------------------------------------
describe("FLPR-GOV — aiMl tiny-brains adapter (first-party)", () => {
  const TECHNICAL_RESULT = {
    category: "technical",
    candles: engulfingCandles(),
    priceSource: "demo",
    technical: computeTechnicalEnrichment(engulfingCandles()),
  };
  const PATTERN_RESULT = {
    category: "pattern",
    series: { seriesId: "s", length: 30, indexBasis: "position" },
    motifs: [],
    discords: [],
    changePoints: [],
    pivots: [],
    candlestick: { patternName: "bullish engulfing", patternConfidence: 75 },
  };
  const SENTIMENT_RESULT = {
    category: "sentiment",
    axes: [
      { axis: "positioning", score: 0.6 },
      { axis: "funding", score: 0.5 },
    ] as SentimentAxisObservation[],
  };
  const NEWS_RESULT = {
    category: "news",
    news: { hasShockEvent: false, shockDirection: "none", headlines: [], items: [] },
    newsFeatures: { hasNewsShock: false, headlineCount: 0, mostRecentMinutesAgo: null, oldestMinutesAgo: null, hasExchangeEvent: false, hasRegulatoryEvent: false, hasMacroEvent: false },
  };
  const JOINED_INPUT = {
    parents: { technical: TECHNICAL_RESULT, pattern: PATTERN_RESULT, sentiment: SENTIMENT_RESULT, news: NEWS_RESULT },
  };

  it("projects the sibling lanes through the SHARED laneView helpers and maps the prediction to the governed forecast (notes dropped)", async () => {
    const seen: unknown[] = [];
    const rt = buildRuntime([
      createAimlTinyBrainsAdapter({
        callService: (async (input: unknown) => {
          seen.push(input);
          return { convictionScore: 0.85, direction: "long", regime: "bull", riskFlag: false, notes: "free prose must not ride" };
        }) as never,
      }),
    ]);
    const result = await rt.invoke({ providerInstanceId: "pi-aiml-tiny-brains", recordVersion: "1.0.0" }, ctx({ input: JOINED_INPUT }));
    const sent = seen[0] as Record<string, unknown>;
    expect(sent.technical).toEqual(viewTechnical(TECHNICAL_RESULT.technical));
    expect(sent.pattern).toEqual(viewPattern(PATTERN_RESULT as never));
    expect(sent.sentiment).toEqual(viewSentiment(SENTIMENT_RESULT.axes));
    expect(sent.newsFeatures).toEqual(NEWS_RESULT.newsFeatures);
    expect(result).toEqual({
      category: "aiMl",
      forecast: { direction: "long", conviction: 0.85 },
      regime: { label: "bull" },
      riskFlag: false,
    });
    expect(JSON.stringify(result)).not.toContain("free prose");
  });

  it("fails CLOSED on service absence/error (no fabricated neutral)", async () => {
    const rt = buildRuntime([
      createAimlTinyBrainsAdapter({
        callService: (async () => {
          throw new Error("aiMl service unavailable: TINY_BRAINS_URL is not configured");
        }) as never,
      }),
    ]);
    await expect(rt.invoke({ providerInstanceId: "pi-aiml-tiny-brains", recordVersion: "1.0.0" }, ctx({ input: JOINED_INPUT }))).rejects.toThrow(
      /TINY_BRAINS_URL/
    );
  });
});

// --------------------------------------------------------------------------
// laneView — closed vocabulary + scorer-input inertness
// --------------------------------------------------------------------------
describe("FLPR-GOV — laneView projections + inertness", () => {
  it("viewSentiment's tag vocabulary is CLOSED and sweep-free over the whole axis domain", () => {
    const CLOSED = new Set(["crowded_long", "crowded_short", "balanced", "elevated_positive", "elevated_negative", "normal"]);
    const SWEEP = ["liquidity sweep", "stop hunt", "stop-hunt", "sweep"];
    for (let p = -1; p <= 1.0001; p += 0.1) {
      for (let f = -1; f <= 1.0001; f += 0.1) {
        const view = viewSentiment([
          { axis: "positioning", score: Math.round(p * 1e6) / 1e6 },
          { axis: "funding", score: Math.round(f * 1e6) / 1e6 },
        ])!;
        expect(view.tags).toHaveLength(2);
        for (const tag of view.tags!) {
          expect(CLOSED.has(tag!)).toBe(true);
          for (const hint of SWEEP) expect(tag!.toLowerCase()).not.toContain(hint);
        }
      }
    }
  });

  it("viewTechnical pins brokeEmaWithBody=false and preserves the scorer-visible renames", () => {
    const view = viewTechnical({ emaDistancePct: 1.2, isInValueSweetSpot: true, rsi14: 55, ema20: 100, ema50: 98, volumeRatio: 1.1, trendBias: "bullish" } as never)!;
    expect(view).toEqual({
      emaDistancePct: 1.2,
      isInValueSweetSpot: true,
      brokeEmaWithBody: false,
      indicators: { rsi: 55, ema_20: 100, ema_50: 98, volume_ratio: 1.1 },
    });
  });

  it("viewPattern carries EXACTLY the two scorer-visible candlestick fields; absent block → undefined", () => {
    expect(viewPattern({ series: { seriesId: "s", length: 1, indexBasis: "position" }, motifs: [], discords: [], changePoints: [], pivots: [] })).toBeUndefined();
    expect(
      viewPattern({ series: { seriesId: "s", length: 1, indexBasis: "position" }, motifs: [], discords: [], changePoints: [], pivots: [], candlestick: { patternName: "pin bar", patternConfidence: 65 } })
    ).toEqual({ patternName: "pin bar", patternConfidence: 65 });
  });

  it("viewAiMl maps the governed forecast to the analyst view shape", () => {
    expect(viewAiMl({ forecast: { direction: "long", conviction: 0.85 }, regime: { label: "bull" }, riskFlag: true })).toEqual({
      convictionScore: 0.85,
      direction: "long",
      regime: "bull",
      riskFlag: true,
    });
    expect(viewAiMl({ forecast: { direction: "neutral", conviction: 0.5 } })).toEqual({ convictionScore: 0.5, direction: "neutral" });
  });

  it("SCORER-INPUT INERTNESS: sentiment/news/aiMl content cannot move the analyst input (FLPR-GOV D-FLPR-5)", () => {
    const base: FroggyEnrichedView = {
      signalId: "sig-1",
      symbol: "BTC/USDT",
      market: "perp",
      timeframe: "1h",
      technical: { emaDistancePct: 1.5, isInValueSweetSpot: true, brokeEmaWithBody: false, indicators: { rsi: 50 } },
      pattern: { patternName: "bullish engulfing", patternConfidence: 75 },
      sentiment: viewSentiment([{ axis: "positioning", score: 0.6 }, { axis: "funding", score: 0.5 }]),
      news: { hasShockEvent: true, shockDirection: "bullish", headlines: ["a"], items: [] },
      aiMl: { convictionScore: 0.99, direction: "long" },
    } as FroggyEnrichedView;
    const variant: FroggyEnrichedView = {
      ...base,
      sentiment: viewSentiment([{ axis: "positioning", score: -1 }, { axis: "funding", score: -1 }, { axis: "openInterest", score: 1 }]),
      news: { hasShockEvent: false, shockDirection: "none", headlines: [], items: [] },
      aiMl: undefined,
      newsFeatures: undefined,
    } as FroggyEnrichedView;
    const a = buildFroggyTrendPullbackInputFromEnriched(base);
    const b = buildFroggyTrendPullbackInputFromEnriched(variant);
    expect(a).toEqual(b);
    expect(a.liquiditySwept).toBe(false);
  });
});

// --------------------------------------------------------------------------
// the five-lane graph: 5 lanes → merge → scorer
// --------------------------------------------------------------------------
describe("FLPR-GOV — five-lane graph execution", () => {
  function fiveLaneRuntime() {
    return buildRuntime([
      createTechnicalLocalAdapter({
        resolvePriceSource: () => "demo",
        getAdapter: () => demoPriceFeedAdapter,
        computeTechnical: computeTechnicalEnrichment,
      }),
      createPatternCandlestickAdapter(),
      createSentimentCftcCotAdapter({ fetchImpl: cannedFetch([], [COT_ROW]) }),
      createNewsSecEdgarAdapter({ fetchImpl: cannedFetch([], EDGAR_BODY), now: () => new Date("2026-07-18T12:00:00.000Z") }),
      createAimlTinyBrainsAdapter({
        callService: (async () => ({ convictionScore: 0.85, direction: "long", regime: "bull" })) as never,
      }),
    ]);
  }

  function fiveLaneManifest(): PipelineManifest {
    const lane = (id: string, category: string, pluginId: string, ref: string, extra: Record<string, unknown> = {}) => ({
      id,
      category,
      pluginId,
      pluginVersion: "2.0.0",
      critical: false,
      failurePolicy: "degrade",
      providerInstanceRef: { providerInstanceId: ref, recordVersion: "1.0.0" },
      ...extra,
    });
    return {
      schema: "afi.pipeline.v1",
      pipelineId: "five-lane-proof",
      pipelineVersion: "v1.0.0",
      entry: "technical",
      nodes: [
        lane("technical", "technical", "afi-analysis-technical", "pi-technical-local", { config: { candleLimit: 100 } }),
        lane("pattern", "pattern", "afi-analysis-pattern", "pi-pattern-candlestick"),
        lane("sentiment", "sentiment", "afi-analysis-sentiment", "pi-sentiment-cftc"),
        lane("news", "news", "afi-analysis-news", "pi-news-edgar", { config: { windowHours: 48 } }),
        lane("aiml", "aiMl", "afi-analysis-aiml", "pi-aiml-tiny-brains", {
          join: { policy: "all", merge: { strategy: "namespace-by-node", conflictRule: "error" } },
        }),
        {
          id: "merge",
          category: "merge",
          pluginId: "afi-merge-enriched-view",
          pluginVersion: "1.1.0",
          join: { policy: "all", merge: { strategy: "namespace-by-node", conflictRule: "error" } },
        },
        { id: "scorer", category: "scorer", pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
      ],
      edges: [
        { from: "technical", to: "pattern", fromPort: "candles" },
        { from: "technical", to: "sentiment" },
        { from: "technical", to: "news" },
        { from: "technical", to: "aiml", optional: true },
        { from: "pattern", to: "aiml", optional: true },
        { from: "sentiment", to: "aiml", optional: true },
        { from: "news", to: "aiml", optional: true },
        { from: "technical", to: "merge", optional: true },
        { from: "pattern", to: "merge", optional: true },
        { from: "sentiment", to: "merge", optional: true },
        { from: "news", to: "merge", optional: true },
        { from: "aiml", to: "merge", optional: true },
        { from: "merge", to: "scorer" },
      ],
    } as PipelineManifest;
  }

  function registryWith(rt: ProviderRuntime, scorer: AnalysisNodePlugin) {
    return createPluginRegistry([
      createProviderBackedNode({ pluginId: "afi-analysis-technical", pluginVersion: "2.0.0" }, "technical", rt),
      createProviderBackedNode({ pluginId: "afi-analysis-pattern", pluginVersion: "2.0.0" }, "pattern", rt),
      createProviderBackedNode({ pluginId: "afi-analysis-sentiment", pluginVersion: "2.0.0" }, "sentiment", rt),
      createProviderBackedNode({ pluginId: "afi-analysis-news", pluginVersion: "2.0.0" }, "news", rt),
      createProviderBackedNode({ pluginId: "afi-analysis-aiml", pluginVersion: "2.0.0" }, "aiMl", rt),
      mergeEnrichedViewNode,
      scorer,
    ]);
  }

  it("all five lanes fire, the merge joins exactly one result per category (aiMl last), and the scorer sees the assembled view", async () => {
    let seenView: FroggyEnrichedView | undefined;
    const capturingScorer: AnalysisNodePlugin = {
      manifestRef: { pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
      async run(input: unknown) {
        seenView = input as FroggyEnrichedView;
        return ok({ scored: true });
      },
    };
    const executor = new GraphExecutor({ registry: registryWith(fiveLaneRuntime(), capturingScorer), logger: SILENT_NODE_LOGGER });
    const exec = await executor.execute({ manifest: fiveLaneManifest(), input: {}, signal: testSignal() });
    expect((exec.result as { scored: boolean }).scored).toBe(true);
    expect(seenView).toBeDefined();
    expect(seenView!.enrichmentMeta?.categories).toEqual(["technical", "pattern", "sentiment", "news", "aiMl"]);
    expect(seenView!.aiMl).toEqual({ convictionScore: 0.85, direction: "long", regime: "bull" });
    expect(seenView!.technical?.brokeEmaWithBody).toBe(false);
    const lenses = (seenView as unknown as { lenses: { type: string }[] }).lenses.map((l) => l.type);
    expect(lenses).toEqual(["technical", "pattern", "sentiment", "news", "aiMl"]);
  });

  it("a SECOND aiMl contributor fails the merge (exactly one result per category, incl. aiMl)", async () => {
    await expect(
      mergeEnrichedViewNode.run(
        {
          parents: {
            a: { category: "aiMl", forecast: { direction: "long", conviction: 0.5 } },
            b: { category: "aiMl", forecast: { direction: "short", conviction: 0.5 } },
          },
        },
        { signal: testSignal(), config: {}, logger: SILENT_NODE_LOGGER, abort: new AbortController().signal }
      )
    ).rejects.toThrow(/conflict/);
  });

  it("a degraded aiMl lane degrades honestly: the view simply carries no aiMl (never fabricated)", async () => {
    const rt = buildRuntime([
      createTechnicalLocalAdapter({
        resolvePriceSource: () => "demo",
        getAdapter: () => demoPriceFeedAdapter,
        computeTechnical: computeTechnicalEnrichment,
      }),
      createPatternCandlestickAdapter(),
      createSentimentCftcCotAdapter({ fetchImpl: cannedFetch([], [COT_ROW]) }),
      createNewsSecEdgarAdapter({ fetchImpl: cannedFetch([], EDGAR_BODY), now: () => new Date("2026-07-18T12:00:00.000Z") }),
      createAimlTinyBrainsAdapter({
        callService: (async () => {
          throw new Error("aiMl service unavailable");
        }) as never,
      }),
    ]);
    let seenView: FroggyEnrichedView | undefined;
    const capturingScorer: AnalysisNodePlugin = {
      manifestRef: { pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
      async run(input: unknown) {
        seenView = input as FroggyEnrichedView;
        return ok({ scored: true });
      },
    };
    const executor = new GraphExecutor({ registry: registryWith(rt, capturingScorer), logger: SILENT_NODE_LOGGER });
    const exec = await executor.execute({ manifest: fiveLaneManifest(), input: {}, signal: testSignal() });
    const aimlEntry = exec.summary.nodes.find((n) => n.nodeId === "aiml");
    expect(aimlEntry?.status).toBe("failed-optional");
    expect(seenView!.aiMl).toBeUndefined();
    expect(seenView!.enrichmentMeta?.categories).toEqual(["technical", "pattern", "sentiment", "news"]);
  });
});
