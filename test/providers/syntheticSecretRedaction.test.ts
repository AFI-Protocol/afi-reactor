/**
 * EV3-GOV §15.3 REDACTION — the D-EV3-6 credential-safety law proven
 * empirically with a synthetic secret marker.
 *
 * The marker is injected as the ENV-RESOLVED credential of a BYOK news
 * instance (EnvSecretResolver — the honestly non-production dev backend,
 * D-FLPR-7) and driven through the six governed paths: success,
 * transport-error, timeout, adapter-error, builder-validation-error, and
 * persistence-error. The marker must escape into NO tested surface:
 *
 *   - the built afi.scored-signal-evidence.v3 record (JSON);
 *   - EVERY hash preimage (the composition-law hashing module is
 *     instrumented in-test: every canonicalHashOf preimage string and every
 *     evidence-law preimage value is captured and scanned);
 *   - thrown error messages (runtime + builder + persistence, incl. causes);
 *   - the log sink (the scrubbing logger boundary) and the console;
 *   - the outbound transport URL (header-only law — the credential travels
 *     ONLY as a header value; a credentialed URL is never constructed).
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ---------------------------------------------------------------------------
// Hash-preimage instrumentation (D-EV3-4(8) structural-exclusion proof):
// wrap the composition-law entry point so every preimage the projections
// hash is captured for marker scanning, then delegate to the real law.
// ---------------------------------------------------------------------------
const mockPreimages: string[] = [];
jest.mock("../../src/pipeline/hashing.js", () => {
  const actual = jest.requireActual(
    "../../src/pipeline/hashing.js"
  ) as typeof import("../../src/pipeline/hashing.js");
  return {
    ...actual,
    canonicalHashOf: (
      value: unknown,
      domainTag: string,
      excludedFields: readonly string[] = []
    ) => {
      const material =
        excludedFields.length > 0 &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
          ? actual.stripExcluded(value as object, excludedFields)
          : value;
      mockPreimages.push(actual.canonicalize(material));
      return actual.canonicalHashOf(value, domainTag, excludedFields);
    },
  };
});
// The evidence-law preimages (inputHash/outputHash) — capture the projected
// value; a marker in the preimage implies a marker in the value.
jest.mock("../../src/evidence/provenance/canonicalHashV1.js", () => {
  const actual = jest.requireActual(
    "../../src/evidence/provenance/canonicalHashV1.js"
  ) as typeof import("../../src/evidence/provenance/canonicalHashV1.js");
  return {
    ...actual,
    computeCanonicalHashV1: (value: unknown, options: never) => {
      mockPreimages.push(JSON.stringify(value));
      return (actual.computeCanonicalHashV1 as (v: unknown, o: never) => unknown)(
        value,
        options
      );
    },
  };
});

import {
  ProviderRuntime,
  createAdapterRegistry,
  createProviderRecordStore,
  createCategoryOutputValidator,
  createHttpNewsAdapter,
  EnvSecretResolver,
  ProviderOutputInvalidError,
  type ProviderAdapter,
  type ProviderRecord,
  type CredentialRefRecord,
  type ProviderInstanceRecord,
} from "../../src/providers/index.js";
import { NewsDataProvider } from "../../src/providers/clients/newsdataNewsProvider.js";
import { computeNewsFeatures } from "../../src/news/newsFeatures.js";
import type { NodeLogger } from "../../src/pipeline/nodeSdk.js";
import {
  buildReactorEvidenceRecord,
  EvidenceProofViolationError,
} from "../../src/evidence/reactorEvidenceRecord.js";
import { validateEvidenceRecordV3 } from "../../src/evidence/evidenceV3Schema.js";
import {
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  type EvidenceStorePort,
  type EvidenceSubmitResult,
} from "../../src/evidence/submitScoredSignalEvidence.js";
import type { ProviderInvocationProofV1 } from "../../src/providers/invocationProof.js";
import { testSignal } from "../pipeline/support/testHarness.js";
import {
  makeBinding,
  makeContext,
  makeInvocations,
  makeScored,
} from "../evidence/support/evidenceV3World.js";

/** The governed synthetic marker (mission §15.3). */
const MARKER = "AFI-SYNTHETIC-SECRET-DO-NOT-LEAK-9f2c";

// --------------------------- BYOK fixture records ---------------------------
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
const credentialRef: CredentialRefRecord = {
  schema: "afi.credential-ref.v1",
  credentialRef: "newsdata-key-tenant-a",
  recordVersion: "1.0.0",
  tenant: "tenant-a",
  providerId: "afi-provider-news-http",
  credentialKind: "apiKeyHeader",
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

/** The env-backed dev resolver with an INJECTED env dict (never process.env). */
function envResolver(): EnvSecretResolver {
  return new EnvSecretResolver(
    [{ tenant: "tenant-a", credentialRef: "newsdata-key-tenant-a", envVar: "AFI_TEST_SYNTHETIC_NEWS_KEY" }],
    { AFI_TEST_SYNTHETIC_NEWS_KEY: MARKER } as NodeJS.ProcessEnv
  );
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function goodNewsFetch(calls: FetchCall[]): typeof fetch {
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

function newsAdapter(fetchImpl: typeof fetch): ProviderAdapter {
  return createHttpNewsAdapter({
    createProvider: ({ apiKey, fetchImpl: f, timeoutMs }) =>
      new NewsDataProvider(apiKey, { fetchImpl: f, timeoutMs }),
    computeFeatures: computeNewsFeatures,
    fetchImpl,
  });
}

function buildRuntime(adapter: ProviderAdapter, instance: ProviderInstanceRecord = instNews) {
  return new ProviderRuntime({
    adapters: createAdapterRegistry([adapter]),
    records: createProviderRecordStore({
      providers: [providerNews],
      credentialRefs: [credentialRef],
      providerInstances: [instance],
    }),
    resolver: envResolver(),
    outputValidator: createCategoryOutputValidator(),
  });
}

function capturingLogger(): { logger: NodeLogger; sink: unknown[] } {
  const sink: unknown[] = [];
  const rec = (level: string) => (message: string, fields?: Record<string, unknown>) =>
    sink.push({ level, message, fields });
  return {
    sink,
    logger: { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") },
  };
}

/** Console capture: the runtime must not write secrets to the global console. */
function captureConsole(): { restore: () => void; lines: unknown[][] } {
  const lines: unknown[][] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args);
    })
  );
  return { restore: () => spies.forEach((s) => s.mockRestore()), lines };
}

function invokeCtx(logger: NodeLogger, onInvocationProof?: (p: ProviderInvocationProofV1) => void) {
  return {
    signal: testSignal(),
    logger,
    abort: new AbortController().signal,
    onInvocationProof,
  };
}

/** Build the full V3 context around a LIVE BYOK news invocation. */
function contextWithLiveNewsLane(proof: ProviderInvocationProofV1, newsResult: unknown) {
  const invocations = makeInvocations();
  const newsBinding = makeBinding("news");
  newsBinding.providerInstanceId = instNews.providerInstanceId;
  newsBinding.instanceRecordVersion = instNews.recordVersion;
  newsBinding.providerId = providerNews.providerId;
  newsBinding.providerRecordVersion = providerNews.recordVersion;
  newsBinding.adapterId = instNews.adapterId;
  newsBinding.adapterVersion = instNews.adapterVersion;
  newsBinding.credentialRef = instNews.credentialRef;
  invocations.laneBindings = invocations.laneBindings.map((b) =>
    b.category === "news" ? newsBinding : b
  );
  invocations.proofs = invocations.proofs.map((p) => (p.category === "news" ? proof : p));
  invocations.laneResults.news = newsResult;
  return makeContext({ invocations });
}

function expectNoMarker(surface: unknown, label: string): void {
  const text = typeof surface === "string" ? surface : JSON.stringify(surface);
  if (text.includes(MARKER)) {
    throw new Error(`synthetic secret marker escaped into ${label}`);
  }
  expect(text).not.toContain(MARKER);
}

beforeEach(() => {
  mockPreimages.length = 0;
});

describe("EV3-GOV 15.3 — success path (BYOK env-resolved credential → full v3 record)", () => {
  it("the marker reaches ONLY the transport header; record, every hash preimage, proof, logs, and console stay marker-free", async () => {
    const calls: FetchCall[] = [];
    const { logger, sink } = capturingLogger();
    const consoleCapture = captureConsole();
    try {
      const rt = buildRuntime(newsAdapter(goodNewsFetch(calls)));
      let captured: ProviderInvocationProofV1 | undefined;
      const result = await rt.invoke(
        { providerInstanceId: instNews.providerInstanceId, recordVersion: instNews.recordVersion },
        invokeCtx(logger, (p) => (captured = p))
      );

      // the header-only law: the credential is the header VALUE, never the URL
      expect(calls).toHaveLength(1);
      expect((calls[0].init.headers as Record<string, string>)["X-ACCESS-KEY"]).toBe(MARKER);
      expectNoMarker(calls[0].url, "the transport URL (credentialed-URL ban, D-EV3-6)");

      // the captured proof binds the OPAQUE CredentialRef facts — never the value
      expect(captured).toBeDefined();
      expect(captured!.credential).toEqual({
        mode: "credentialRef",
        credentialKind: "apiKeyHeader",
        credentialRef: "newsdata-key-tenant-a",
        recordVersion: "1.0.0",
        status: "active",
      });
      expectNoMarker(captured, "the captured invocation proof");
      expectNoMarker(result, "the validated category result");

      // the full v3 record around the live BYOK lane
      const context = contextWithLiveNewsLane(captured!, result);
      const record = buildReactorEvidenceRecord(makeScored(), context);
      expect(validateEvidenceRecordV3(record).ok).toBe(true);
      expectNoMarker(record, "the built afi.scored-signal-evidence.v3 record");
      // no secret-shaped member ever appears on the record
      expect(JSON.stringify(record)).not.toContain("headerValue");

      // EVERY captured hash preimage (composition + evidence law) is marker-free
      expect(mockPreimages.length).toBeGreaterThan(10);
      expectNoMarker(mockPreimages.join(" "), "a hash preimage");

      expectNoMarker(sink, "the scrubbing-logger sink");
      expectNoMarker(consoleCapture.lines, "the console");
    } finally {
      consoleCapture.restore();
    }
  });
});

describe("EV3-GOV 15.3 — transport-error path (worst-case error body + Authorization echo)", () => {
  it("a transport error embedding the marker and an Authorization header echo is scrubbed at every sink", async () => {
    const { logger, sink } = capturingLogger();
    const consoleCapture = captureConsole();
    try {
      const throwingFetch = (async () => {
        throw new Error(
          `connect failed: request was {"headers":{"Authorization":"Bearer ${MARKER}","X-ACCESS-KEY":"${MARKER}"},"url":"https://newsdata.io/api/1/latest?apikey=${MARKER}"}`
        );
      }) as typeof fetch;
      const rt = buildRuntime(newsAdapter(throwingFetch));
      const result = await rt.invoke(
        { providerInstanceId: instNews.providerInstanceId, recordVersion: instNews.recordVersion },
        invokeCtx(logger)
      );
      // fail-soft to the declared fallback; the failure is RECORDED, scrubbed
      expect(result.category).toBe("news");
      expectNoMarker(result, "the fail-soft category result");
      // The provider catches its own transport error and records it through
      // redactSecrets at the console boundary — assert the scrub ENGAGED
      // (the error was logged, redacted) and the marker escaped nowhere.
      const consoleFlat = JSON.stringify(
        consoleCapture.lines.map((args) =>
          args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : a))
        )
      );
      expect(consoleFlat).toContain("REDACTED");
      expectNoMarker(consoleFlat, "the console");
      expectNoMarker(sink, "the scrubbing-logger sink");
      expectNoMarker(mockPreimages.join(" "), "a hash preimage");
    } finally {
      consoleCapture.restore();
    }
  });
});

describe("EV3-GOV 15.3 — timeout path", () => {
  it("an operator timeout whose abort error echoes the request headers is scrubbed", async () => {
    const { logger, sink } = capturingLogger();
    const consoleCapture = captureConsole();
    try {
      const hangingFetch = ((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new Error(`aborted after timeout; in-flight headers: X-ACCESS-KEY=${MARKER}`)
            )
          );
        })) as typeof fetch;
      const tunedInstance: ProviderInstanceRecord = {
        ...instNews,
        invocation: { timeoutMs: 25 },
      };
      const rt = buildRuntime(newsAdapter(hangingFetch), tunedInstance);
      const result = await rt.invoke(
        { providerInstanceId: instNews.providerInstanceId, recordVersion: instNews.recordVersion },
        invokeCtx(logger)
      );
      expect(result.category).toBe("news"); // fail-soft fallback, honestly recorded
      expectNoMarker(result, "the timeout fail-soft result");
      expectNoMarker(sink, "the scrubbing-logger sink");
      expectNoMarker(consoleCapture.lines, "the console");
    } finally {
      consoleCapture.restore();
    }
  }, 10_000);
});

describe("EV3-GOV 15.3 — adapter-error path", () => {
  it("a malformed provider output that ECHOES the credential is rejected with a marker-free error", async () => {
    const { logger, sink } = capturingLogger();
    const echoAdapter: ProviderAdapter = {
      adapterId: "afi-adapter-news-http",
      adapterVersion: "1.0.0",
      transportKind: "http",
      category: "news",
      providerCompatibility: ["afi-provider-news-http"],
      requiresCredential: true,
      async run(ctx) {
        // worst case: a hostile/buggy provider echoes the key into its payload
        return {
          category: "news",
          news: `unauthorized key ${ctx.credential?.headerValue}`,
          newsFeatures: {},
        } as never;
      },
    };
    const rt = buildRuntime(echoAdapter);
    let caught: unknown;
    try {
      await rt.invoke(
        { providerInstanceId: instNews.providerInstanceId, recordVersion: instNews.recordVersion },
        invokeCtx(logger)
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderOutputInvalidError);
    expectNoMarker((caught as Error).message, "the thrown adapter/output-validation error");
    expectNoMarker(sink, "the scrubbing-logger sink");
    // the malformed echo never reached any hash projection
    expectNoMarker(mockPreimages.join(" "), "a hash preimage");
  });

  it("a category-marker spoof fails with an error naming only governed identifiers", async () => {
    const { logger } = capturingLogger();
    const spoofAdapter: ProviderAdapter = {
      adapterId: "afi-adapter-news-http",
      adapterVersion: "1.0.0",
      transportKind: "http",
      category: "news",
      providerCompatibility: ["afi-provider-news-http"],
      requiresCredential: true,
      async run(ctx) {
        return { category: `technical ${ctx.credential?.headerValue}` } as never;
      },
    };
    const rt = buildRuntime(spoofAdapter);
    let caught: unknown;
    try {
      await rt.invoke(
        { providerInstanceId: instNews.providerInstanceId, recordVersion: instNews.recordVersion },
        invokeCtx(logger)
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderOutputInvalidError);
    expectNoMarker((caught as Error).message, "the thrown category-spoof error");
  });
});

describe("EV3-GOV 15.3 — builder-validation-error path", () => {
  it("a D-EV3-5(3) cross-check failure over marker-bearing lane content throws WITHOUT echoing any payload", () => {
    // Worst case: a provider response smuggled the key into content the
    // join consumed; the proof was computed over DIFFERENT bytes. The
    // builder must refuse with an error naming only the category — never
    // the payload, never the marker.
    const context = makeContext();
    (context.invocations.laneResults.news as Record<string, unknown>).news = {
      hasShockEvent: false,
      headlines: [`leaked ${MARKER}`],
    };
    let caught: unknown;
    try {
      buildReactorEvidenceRecord(makeScored(), context);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EvidenceProofViolationError);
    expect((caught as EvidenceProofViolationError).reason).toBe("category-result-hash-mismatch");
    expectNoMarker((caught as Error).message, "the builder validation error");
    expectNoMarker((caught as Error).stack ?? "", "the builder validation error stack");
  });
});

describe("EV3-GOV 15.3 — persistence-error path (fake store failure)", () => {
  it("a BYOK-credentialed run whose store fails surfaces a marker-free typed error; the record that reached the store is marker-free", async () => {
    const calls: FetchCall[] = [];
    const { logger, sink } = capturingLogger();
    const rt = buildRuntime(newsAdapter(goodNewsFetch(calls)));
    let captured: ProviderInvocationProofV1 | undefined;
    const result = await rt.invoke(
      { providerInstanceId: instNews.providerInstanceId, recordVersion: instNews.recordVersion },
      invokeCtx(logger, (p) => (captured = p))
    );
    const context = contextWithLiveNewsLane(captured!, result);

    const submitted: unknown[] = [];
    const failingStore: EvidenceStorePort = {
      async submit(record): Promise<EvidenceSubmitResult> {
        submitted.push(record);
        const err = new Error("MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017") as Error & {
          code: string;
        };
        err.code = "PERSISTENCE_FAILURE";
        throw err;
      },
    };
    const logSink: unknown[] = [];
    const persistenceLogger = {
      info: (...a: unknown[]) => logSink.push(a),
      error: (...a: unknown[]) => logSink.push(a),
    };

    let caught: unknown;
    try {
      await submitScoredSignalEvidence(makeScored(), failingStore, context, persistenceLogger);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ReactorEvidencePersistenceError);
    expect((caught as ReactorEvidencePersistenceError).category).toBe("persistence");
    expectNoMarker((caught as Error).message, "the persistence error message");
    expectNoMarker(
      ((caught as { cause?: unknown }).cause as Error | undefined)?.message ?? "",
      "the persistence error cause"
    );
    expect(submitted).toHaveLength(1);
    expectNoMarker(submitted[0], "the record submitted to the store");
    expectNoMarker(logSink, "the persistence log sink");
    expectNoMarker(sink, "the invocation log sink");
    expectNoMarker(mockPreimages.join(" "), "a hash preimage");
  });
});
