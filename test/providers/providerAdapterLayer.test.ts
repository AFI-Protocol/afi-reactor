/**
 * PBF-GOV Wave 1 — provider-adapter layer proofs (afi-reactor).
 *
 * Proves the bounded provider socket + BYOK boundary end-to-end:
 *  - keyless technical adapter (no credential; resolver never invoked)
 *  - credentialed news adapter (BYOK; key in HEADER not URL; fake transport)
 *  - the synthetic secret marker escapes NO tested surface (logs/errors/URL/
 *    output/serialization) — outside the resolver→adapter boundary
 *  - tenant isolation + least-privilege resolution + no enumeration
 *  - adapter security (unknown/duplicate/category-mismatch/spoof/malformed)
 *  - canonical category-output validation before scoring
 *  - scoring equivalence (provider output == legacy node output)
 *  - executor resolution + execution of a provider-backed node
 *  - Evidence V2 freeze
 */
import { describe, it, expect, jest } from "@jest/globals";

// Repo idiom (see test/pipeline/graphProofs.test.ts): importing the executor
// transitively touches the price-feed registry, whose ccxt dist pulls ESM-only
// crypto deps jest cannot parse. This provider suite never issues a ccxt
// request (it uses a deterministic price feed + fake news transport), so ccxt
// is stubbed out.
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
  createHttpNewsAdapter,
  createProviderBackedNode,
  InMemorySecretResolver,
  NoCredentialsResolver,
  redactSecrets,
  AdapterNotRegisteredError,
  CredentialUnavailableError,
  CredentialScopeError,
  ProviderResolutionError,
  ProviderOutputInvalidError,
  type ProviderRecord,
  type CredentialRefRecord,
  type ProviderInstanceRecord,
  type ProviderAdapter,
} from "../../src/providers/index.js";
import { GraphExecutor } from "../../src/pipeline/executor.js";
import { createPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import { ok, SILENT_NODE_LOGGER, type NodeLogger, type AnalysisNodePlugin } from "../../src/pipeline/nodeSdk.js";
import { computeTechnicalEnrichment } from "../../src/enrichment/technicalIndicators.js";
import { computeNewsFeatures } from "../../src/news/newsFeatures.js";
import { NewsDataProvider } from "../../src/providers/clients/newsdataNewsProvider.js";
import { DEFAULT_NEWS_SUMMARY } from "../../src/news/newsProvider.js";
import { demoPriceFeedAdapter } from "../support/deterministicPriceFeedAdapter.js";
import { testSignal } from "../pipeline/support/testHarness.js";
import type { PipelineManifest } from "../../src/pipeline/manifestTypes.js";

// A distinctive synthetic secret marker — must appear NOWHERE outside the
// resolver -> adapter boundary (the header value sent to the transport).
const SECRET_MARKER = "zzAFI-TOPSECRET-DO-NOT-LOG-4f3a9c2e";
const OTHER_TENANT_SECRET = "zzOTHER-TENANT-SECRET-b17e";

// --------------------------------------------------------------------------
// Records (schema-valid; deployment-local fixtures).
// --------------------------------------------------------------------------
const providerTechnical: ProviderRecord = {
  schema: "afi.provider.v1",
  providerId: "afi-provider-technical-local",
  recordVersion: "1.0.0",
  displayName: "AFI Local Technical Indicators (keyless)",
  supportedCategories: ["technical"],
  executionClass: "local",
  deterministic: true,
  adapterId: "afi-adapter-technical-local",
  requiresCredential: false,
  status: "active",
};
const providerNews: ProviderRecord = {
  schema: "afi.provider.v1",
  providerId: "afi-provider-news-http",
  recordVersion: "1.0.0",
  displayName: "AFI HTTP News Provider (BYOK)",
  supportedCategories: ["news"],
  executionClass: "remote",
  deterministic: false,
  adapterId: "afi-adapter-news-http",
  requiresCredential: true,
  credentialKind: "apiKeyHeader",
  status: "active",
};
const credA: CredentialRefRecord = {
  schema: "afi.credential-ref.v1",
  credentialRef: "newsdata-key-tenant-a",
  recordVersion: "1.0.0",
  tenant: "tenant-a",
  providerId: "afi-provider-news-http",
  credentialKind: "apiKeyHeader",
  status: "active",
};
const credB: CredentialRefRecord = { ...credA, credentialRef: "newsdata-key-tenant-b", tenant: "tenant-b" };
const instTechnical: ProviderInstanceRecord = {
  schema: "afi.provider-instance.v1",
  providerInstanceId: "pi-technical-local-tenant-a",
  recordVersion: "1.0.0",
  tenant: "tenant-a",
  category: "technical",
  providerId: "afi-provider-technical-local",
  adapterId: "afi-adapter-technical-local",
  adapterVersion: "1.0.0",
  status: "active",
};
const instNews: ProviderInstanceRecord = {
  schema: "afi.provider-instance.v1",
  providerInstanceId: "pi-news-http-tenant-a",
  recordVersion: "1.0.0",
  tenant: "tenant-a",
  category: "news",
  providerId: "afi-provider-news-http",
  adapterId: "afi-adapter-news-http",
  adapterVersion: "1.0.0",
  credentialRef: "newsdata-key-tenant-a",
  status: "active",
};

// --------------------------------------------------------------------------
// Fake transports / loggers.
// --------------------------------------------------------------------------
interface FetchCall {
  url: string;
  init: RequestInit;
}
function fakeNewsFetch(calls: FetchCall[]): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        status: "success",
        totalResults: 1,
        results: [
          {
            article_id: "n1",
            title: "BTC ETF inflows rise",
            source_name: "CoinDesk",
            link: "https://example.com/n1",
            pubDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;
}
/** A logger that captures every message + fields for secret-leak scanning. */
function capturingLogger(): { logger: NodeLogger; sink: unknown[] } {
  const sink: unknown[] = [];
  const rec = (level: string) => (message: string, fields?: Record<string, unknown>) =>
    sink.push({ level, message, fields });
  return {
    sink,
    logger: { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") },
  };
}

function technicalAdapter(): ProviderAdapter {
  return createTechnicalLocalAdapter({
    resolvePriceSource: () => "demo",
    getAdapter: () => demoPriceFeedAdapter,
    computeTechnical: computeTechnicalEnrichment,
  });
}
function newsAdapter(calls: FetchCall[]): ProviderAdapter {
  return createHttpNewsAdapter({
    createProvider: ({ apiKey, fetchImpl }) => new NewsDataProvider(apiKey, { fetchImpl }),
    computeFeatures: computeNewsFeatures,
    fetchImpl: fakeNewsFetch(calls),
  });
}

function buildRuntime(opts: {
  adapters: ProviderAdapter[];
  resolver?: InMemorySecretResolver | NoCredentialsResolver;
  providers?: ProviderRecord[];
  credentialRefs?: CredentialRefRecord[];
  providerInstances?: ProviderInstanceRecord[];
}) {
  const resolver =
    opts.resolver ??
    new InMemorySecretResolver([
      { tenant: "tenant-a", credentialRef: "newsdata-key-tenant-a", value: SECRET_MARKER },
      { tenant: "tenant-b", credentialRef: "newsdata-key-tenant-b", value: OTHER_TENANT_SECRET },
    ]);
  const records = createProviderRecordStore({
    providers: opts.providers ?? [providerTechnical, providerNews],
    credentialRefs: opts.credentialRefs ?? [credA, credB],
    providerInstances: opts.providerInstances ?? [instTechnical, instNews],
  });
  return new ProviderRuntime({
    adapters: createAdapterRegistry(opts.adapters),
    records,
    resolver,
    outputValidator: createCategoryOutputValidator(),
  });
}

function ctx(logger: NodeLogger = SILENT_NODE_LOGGER) {
  return { signal: testSignal(), logger, abort: new AbortController().signal };
}

describe("PBF-GOV — technical keyless proof", () => {
  it("resolves the instance, dispatches the adapter, and returns one canonical technical result", async () => {
    const rt = buildRuntime({ adapters: [technicalAdapter()] });
    const result = await rt.invoke({ providerInstanceId: "pi-technical-local-tenant-a", recordVersion: "1.0.0" }, ctx());
    expect(result.category).toBe("technical");
    expect(Array.isArray(result.candles)).toBe(true);
    expect(result.priceSource).toBe("demo");
  });

  it("NEVER invokes the SecretResolver for a keyless provider", async () => {
    const resolver = new InMemorySecretResolver([]);
    const spy = jest.spyOn(resolver, "resolve");
    const rt = buildRuntime({ adapters: [technicalAdapter()], resolver });
    await rt.invoke({ providerInstanceId: "pi-technical-local-tenant-a", recordVersion: "1.0.0" }, ctx());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("PBF-GOV — news BYOK proof", () => {
  it("resolves the credential, sends it in the HEADER (never the URL), and returns a canonical news result", async () => {
    const calls: FetchCall[] = [];
    const rt = buildRuntime({ adapters: [newsAdapter(calls)] });
    const result = await rt.invoke({ providerInstanceId: "pi-news-http-tenant-a", recordVersion: "1.0.0" }, ctx());

    expect(result.category).toBe("news");
    expect(result.news).toBeDefined();
    expect(result.newsFeatures).toBeDefined();

    expect(calls).toHaveLength(1);
    // The credential is in the header — NEVER in the URL.
    expect(calls[0].url).not.toContain(SECRET_MARKER);
    expect(calls[0].url).not.toContain("apikey");
    expect((calls[0].init.headers as Record<string, string>)["X-ACCESS-KEY"]).toBe(SECRET_MARKER);
  });

  it("the resolved credential and the returned result never share a surface (result is secret-free)", async () => {
    const calls: FetchCall[] = [];
    const rt = buildRuntime({ adapters: [newsAdapter(calls)] });
    const result = await rt.invoke({ providerInstanceId: "pi-news-http-tenant-a", recordVersion: "1.0.0" }, ctx());
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
  });
});

describe("PBF-GOV — NewsData provider leak fix (§8.1: key in header, never URL)", () => {
  it("sends the credential in the X-ACCESS-KEY header and NEVER in the request URL", async () => {
    const calls: FetchCall[] = [];
    const provider = new NewsDataProvider(SECRET_MARKER, { fetchImpl: fakeNewsFetch(calls) });
    const summary = await provider.fetchRecentNews({ symbol: "BTCUSDT", windowHours: 4 });
    expect(summary).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain(SECRET_MARKER);
    expect(calls[0].url).not.toContain("apikey");
    expect((calls[0].init.headers as Record<string, string>)["X-ACCESS-KEY"]).toBe(SECRET_MARKER);
  });
});

describe("PBF-GOV — secret-marker escapes NO tested surface", () => {
  it("the marker never appears in any log field during a BYOK invocation", async () => {
    const calls: FetchCall[] = [];
    const { logger, sink } = capturingLogger();
    const rt = buildRuntime({ adapters: [newsAdapter(calls)] });
    await rt.invoke({ providerInstanceId: "pi-news-http-tenant-a", recordVersion: "1.0.0" }, ctx(logger));
    expect(JSON.stringify(sink)).not.toContain(SECRET_MARKER);
  });

  it("even a fetch error carrying the marker is scrubbed before it reaches the logger", async () => {
    const { logger, sink } = capturingLogger();
    // Transport throws an error whose message embeds the secret (worst case).
    const throwingFetch = (async () => {
      throw new Error(`connect failed to https://newsdata.io?apikey=${SECRET_MARKER}`);
    }) as typeof fetch;
    const adapter = createHttpNewsAdapter({
      createProvider: ({ apiKey, fetchImpl }) => new NewsDataProvider(apiKey, { fetchImpl }),
      computeFeatures: computeNewsFeatures,
      fetchImpl: throwingFetch,
    });
    const rt = buildRuntime({ adapters: [adapter] });
    const result = await rt.invoke({ providerInstanceId: "pi-news-http-tenant-a", recordVersion: "1.0.0" }, ctx(logger));
    // fail-soft to the declared fallback; and NO secret in any log.
    expect(result.category).toBe("news");
    expect(JSON.stringify(sink)).not.toContain(SECRET_MARKER);
  });

  it("redactSecrets removes the marker from nested objects, URLs, and error causes", () => {
    const shaped = redactSecrets(
      {
        headerValue: SECRET_MARKER,
        url: `https://x?apikey=${SECRET_MARKER}`,
        nested: { authorization: `Bearer ${SECRET_MARKER}` },
        err: new Error(`boom token=${SECRET_MARKER}`),
      },
      [SECRET_MARKER]
    );
    expect(JSON.stringify(shaped)).not.toContain(SECRET_MARKER);
  });
});

describe("PBF-GOV — tenant isolation + least privilege", () => {
  it("a tenant-a instance referencing tenant-b's credential fails closed (scope mismatch)", async () => {
    const crossInstance: ProviderInstanceRecord = { ...instNews, providerInstanceId: "pi-news-cross", credentialRef: "newsdata-key-tenant-b" };
    const calls: FetchCall[] = [];
    const rt = buildRuntime({ adapters: [newsAdapter(calls)], providerInstances: [crossInstance] });
    await expect(
      rt.invoke({ providerInstanceId: "pi-news-cross", recordVersion: "1.0.0" }, ctx())
    ).rejects.toBeInstanceOf(CredentialScopeError);
    expect(calls).toHaveLength(0);
  });

  it("the resolver refuses a cross-tenant (tenant, ref) pair — a node cannot resolve another tenant's secret", async () => {
    const resolver = new InMemorySecretResolver([
      { tenant: "tenant-a", credentialRef: "newsdata-key-tenant-a", value: SECRET_MARKER },
      { tenant: "tenant-b", credentialRef: "newsdata-key-tenant-b", value: OTHER_TENANT_SECRET },
    ]);
    await expect(
      resolver.resolve({ tenant: "tenant-a", providerInstanceId: "x", credentialRef: "newsdata-key-tenant-b", credentialKind: "apiKeyHeader", headerName: "X-ACCESS-KEY" })
    ).rejects.toBeInstanceOf(CredentialUnavailableError);
  });

  it("the SecretResolver exposes no way to enumerate or resolve arbitrary secrets", () => {
    const resolver = new InMemorySecretResolver([]);
    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(resolver));
    expect(keys).toContain("resolve");
    for (const forbidden of ["list", "listSecrets", "all", "keys", "enumerate", "read", "write", "delete", "rotate"]) {
      expect((resolver as unknown as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });
});

describe("PBF-GOV — adapter security", () => {
  it("an unknown adapter fails closed", () => {
    const reg = createAdapterRegistry([technicalAdapter()]);
    expect(() => reg.require("afi-adapter-missing", "1.0.0")).toThrow(AdapterNotRegisteredError);
    expect(reg.get("afi-adapter-missing", "1.0.0")).toBeUndefined();
  });

  it("a duplicate adapter registration fails closed at construction", () => {
    expect(() => createAdapterRegistry([technicalAdapter(), technicalAdapter()])).toThrow(AdapterNotRegisteredError);
  });

  it("an adapter whose category disagrees with the instance fails closed", async () => {
    // provider 'news' but bound to the technical adapter → category-incompatible.
    const badProvider: ProviderRecord = { ...providerNews, providerId: "bad-news", adapterId: "afi-adapter-technical-local" };
    const badInstance: ProviderInstanceRecord = { ...instNews, providerInstanceId: "pi-bad", providerId: "bad-news", adapterId: "afi-adapter-technical-local", credentialRef: undefined };
    const rt = buildRuntime({ adapters: [technicalAdapter()], providers: [badProvider], providerInstances: [badInstance], credentialRefs: [] });
    await expect(rt.invoke({ providerInstanceId: "pi-bad", recordVersion: "1.0.0" }, ctx())).rejects.toBeInstanceOf(ProviderResolutionError);
  });

  it("provider spoofing (adapter not compatible with the provider) fails closed", async () => {
    const spoof: ProviderRecord = { ...providerTechnical, providerId: "spoof-provider", adapterId: "afi-adapter-technical-local" };
    const spoofInstance: ProviderInstanceRecord = { ...instTechnical, providerInstanceId: "pi-spoof", providerId: "spoof-provider" };
    const rt = buildRuntime({ adapters: [technicalAdapter()], providers: [spoof], providerInstances: [spoofInstance], credentialRefs: [] });
    await expect(rt.invoke({ providerInstanceId: "pi-spoof", recordVersion: "1.0.0" }, ctx())).rejects.toBeInstanceOf(ProviderResolutionError);
  });

  it("a malformed provider output never reaches scoring (canonical validation fails closed)", async () => {
    const badAdapter: ProviderAdapter = {
      adapterId: "afi-adapter-technical-local",
      adapterVersion: "1.0.0",
      category: "technical",
      providerCompatibility: ["afi-provider-technical-local"],
      requiresCredential: false,
      transportKind: "in-process",
      async run() {
        return { category: "technical" }; // missing required candles + priceSource
      },
    };
    const rt = buildRuntime({ adapters: [badAdapter] });
    await expect(
      rt.invoke({ providerInstanceId: "pi-technical-local-tenant-a", recordVersion: "1.0.0" }, ctx())
    ).rejects.toBeInstanceOf(ProviderOutputInvalidError);
  });

  it("a keyless provider carrying a credential reference fails closed (unauthorized)", async () => {
    const badKeyless: ProviderInstanceRecord = { ...instTechnical, providerInstanceId: "pi-keyless-cred", credentialRef: "newsdata-key-tenant-a" };
    const rt = buildRuntime({ adapters: [technicalAdapter()], providerInstances: [badKeyless] });
    await expect(rt.invoke({ providerInstanceId: "pi-keyless-cred", recordVersion: "1.0.0" }, ctx())).rejects.toBeInstanceOf(CredentialScopeError);
  });

  it("the record store rejects an arbitrary endpoint / raw URL (anti-SSRF, schema fail closed)", () => {
    const ssrf = { ...instNews, invocation: { endpoint: "http://169.254.169.254/" } } as unknown as ProviderInstanceRecord;
    expect(() => createProviderRecordStore({ providerInstances: [ssrf] })).toThrow();
  });

  it("the default runtime resolver fails closed when a credential is required but no backend is configured", async () => {
    const rt = buildRuntime({ adapters: [newsAdapter([])], resolver: new NoCredentialsResolver() });
    await expect(rt.invoke({ providerInstanceId: "pi-news-http-tenant-a", recordVersion: "1.0.0" }, ctx())).rejects.toBeInstanceOf(CredentialUnavailableError);
  });
});

describe("PBF-GOV/FLPR-GOV — scoring equivalence + one result per category", () => {
  it("the provider-backed technical output is exactly the kernel output over the deterministic feed (unchanged scoring input)", async () => {
    const rt = buildRuntime({ adapters: [technicalAdapter()] });
    const providerResult = await rt.invoke({ providerInstanceId: "pi-technical-local-tenant-a", recordVersion: "1.0.0" }, ctx());

    // The adapter must add/remove NOTHING relative to the trusted kernel over
    // the same candles: same deterministic feed + same kernel ⇒ identical
    // category output ⇒ a deterministic scorer produces an identical score.
    const signal = testSignal();
    const raw = await demoPriceFeedAdapter.getOHLCV({
      symbol: signal.facts!.symbol as string,
      timeframe: signal.facts!.timeframe as string,
      limit: 100,
    });
    const candles = raw.map((c) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const kernel = computeTechnicalEnrichment(candles);
    expect(JSON.parse(JSON.stringify(providerResult))).toEqual(
      JSON.parse(
        JSON.stringify({
          category: "technical",
          technical: kernel ?? undefined,
          candles,
          priceSource: "demo",
        })
      )
    );
  });
});

describe("PBF-GOV — executor resolution + execution of a provider-backed node", () => {
  it("the GraphExecutor threads the manifest providerInstanceRef into the node and scores it", async () => {
    const rt = buildRuntime({ adapters: [technicalAdapter()] });
    const providerTechnicalNode = createProviderBackedNode(
      { pluginId: "afi-analysis-technical", pluginVersion: "1.0.0" },
      "technical",
      rt
    );
    const trivialScorer: AnalysisNodePlugin = {
      manifestRef: { pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
      async run(input: unknown) {
        return ok({ scored: true, technicalSeen: input });
      },
    };
    const registry = createPluginRegistry([providerTechnicalNode, trivialScorer]);
    const executor = new GraphExecutor({ registry, logger: SILENT_NODE_LOGGER });

    const manifest: PipelineManifest = {
      schema: "afi.pipeline.v1",
      pipelineId: "provider-backed-technical",
      pipelineVersion: "v1.0.0",
      entry: "technical",
      nodes: [
        {
          id: "technical",
          category: "technical",
          pluginId: "afi-analysis-technical",
          pluginVersion: "1.0.0",
          providerInstanceRef: { providerInstanceId: "pi-technical-local-tenant-a", recordVersion: "1.0.0" },
        },
        { id: "scorer", category: "scorer", pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
      ],
      edges: [{ from: "technical", to: "scorer" }],
    };

    const exec = await executor.execute({ manifest, input: {}, signal: testSignal() });
    const result = exec.result as { scored: boolean; technicalSeen: { category: string; candles: unknown[] } };
    expect(result.scored).toBe(true);
    // Exactly one technical result flowed to the scorer.
    expect(result.technicalSeen.category).toBe("technical");
    expect(Array.isArray(result.technicalSeen.candles)).toBe(true);
  });
});

describe("PBF-GOV — operational controls on the BYOK path (abort + configured timeout)", () => {
  it("threads the operator-configured invocation.timeoutMs and ctx.abort to the news transport", async () => {
    let seenTimeout: number | undefined;
    let seenAbortAborted: boolean | undefined;
    const recordingAdapter = createHttpNewsAdapter({
      createProvider: ({ timeoutMs }) => {
        seenTimeout = timeoutMs;
        return {
          async fetchRecentNews(p) {
            seenAbortAborted = p.abort?.aborted;
            return DEFAULT_NEWS_SUMMARY;
          },
        };
      },
      computeFeatures: computeNewsFeatures,
    });
    const tuned: ProviderInstanceRecord = { ...instNews, providerInstanceId: "pi-news-tuned", invocation: { timeoutMs: 250 } };
    const rt = buildRuntime({ adapters: [recordingAdapter], providerInstances: [tuned] });
    const ac = new AbortController();
    ac.abort();
    await rt.invoke(
      { providerInstanceId: "pi-news-tuned", recordVersion: "1.0.0" },
      { signal: testSignal(), logger: SILENT_NODE_LOGGER, abort: ac.signal }
    );
    // operator timeout is functional (reaches the provider), and executor abort propagates to the request
    expect(seenTimeout).toBe(250);
    expect(seenAbortAborted).toBe(true);
  });
});

describe("PBF-GOV — provider-backed node enforces its declared category", () => {
  it("fails closed when the resolved instance category differs from the node's declared lane", async () => {
    const rt = buildRuntime({ adapters: [technicalAdapter()] });
    // node DECLARES 'news' but references a TECHNICAL provider instance
    const node = createProviderBackedNode({ pluginId: "afi-analysis-news", pluginVersion: "1.0.0" }, "news", rt);
    await expect(
      node.run(
        {},
        {
          signal: testSignal(),
          config: {},
          logger: SILENT_NODE_LOGGER,
          abort: new AbortController().signal,
          providerInstanceRef: { providerInstanceId: "pi-technical-local-tenant-a", recordVersion: "1.0.0" },
        }
      )
    ).rejects.toThrow(/category/);
  });
});

describe("PBF-GOV — Evidence V2 freeze", () => {
  it("the vendored scored-signal-evidence schema is still v2 and carries no provider field", () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), "src/pipeline/governed-schema/scored-signal-evidence.v2.schema.json"), "utf-8")
    ) as { $id: string; properties: { schema: { const: string } } };
    expect(schema.$id).toBe(
      "https://afi-protocol.org/schemas/scored-signal-evidence/v2/scored-signal-evidence.schema.json"
    );
    expect(schema.properties.schema.const).toBe("afi.scored-signal-evidence.v2");
    // No provider/credential surface was added to the evidence record.
    for (const forbidden of ["provider", "providerInstance", "credential", "credentialRef", "providerProvenance"]) {
      expect(Object.keys(schema.properties)).not.toContain(forbidden);
    }
  });
});
