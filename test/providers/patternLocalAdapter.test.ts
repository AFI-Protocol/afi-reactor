/**
 * Mission 4 — keyless local pattern adapter proofs (afi-reactor).
 *
 * Proves the first live 'pattern' implementation on the PBF-GOV provider socket:
 *  - static registration of afi-adapter-pattern-local@1.0.0 (category 'pattern')
 *  - explicit ProviderInstance selection (never from asset metadata)
 *  - keyless: the SecretResolver is NEVER invoked
 *  - the adapter extracts ONLY the bounded canonical series + a trusted profile
 *  - canonical afi.enrichment.pattern.v1 validation at the adapter edge
 *  - exactly ONE resolved 'pattern' result reaches the scorer-facing join
 *  - deterministic replay from a fixture; malformed output fails closed; a
 *    service error fails closed with no silent fallback; no secret leaks
 *  - the executor threads the manifest providerInstanceRef and the join topology
 *    is unchanged (one category result per node → scorer)
 */
import { describe, it, expect, jest } from "@jest/globals";

// Repo idiom (see providerAdapterLayer.test.ts): importing the executor
// transitively touches the price-feed registry, whose ccxt dist pulls ESM-only
// deps jest cannot parse. This suite issues no ccxt request, so ccxt is stubbed.
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
  createProviderBackedNode,
  buildProviderRuntime,
  builtinProviderAdapters,
  patternLocalAdapter,
  createPatternLocalAdapter,
  ProviderOutputInvalidError,
  type SecretResolver,
  type SecretResolveRequest,
  type ProviderRecord,
  type ProviderInstanceRecord,
  type ProviderAdapter,
} from "../../src/providers/index.js";
import type {
  callPatternService,
  PatternAnalyzeRequest,
  PatternAnalyzeResponse,
} from "../../src/aiMl/patternServiceClient.js";
import { GraphExecutor } from "../../src/pipeline/executor.js";
import { createPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import { ok, NodeConfigurationError, SILENT_NODE_LOGGER, type AnalysisNodePlugin } from "../../src/pipeline/nodeSdk.js";
import { testSignal } from "../pipeline/support/testHarness.js";
import type { CanonicalUss } from "../../src/types/canonicalUss.js";
import type { PipelineManifest } from "../../src/pipeline/manifestTypes.js";

const FIX = join(process.cwd(), "test/providers/fixtures");
const GOLDEN = JSON.parse(
  readFileSync(join(FIX, "patternServiceResponse.golden.json"), "utf-8")
) as PatternAnalyzeResponse;
const SERIES_INPUT = JSON.parse(readFileSync(join(FIX, "patternSeriesInput.json"), "utf-8")) as {
  seriesId: string;
  values: number[];
  timestamps: number[];
};

// --------------------------------------------------------------------------
// Records (schema-valid; deployment-local fixtures). Keyless pattern provider.
// --------------------------------------------------------------------------
const providerPattern: ProviderRecord = {
  schema: "afi.provider.v1",
  providerId: "afi-provider-pattern-local",
  recordVersion: "1.0.0",
  displayName: "AFI Local Pattern Analysis (keyless)",
  supportedCategories: ["pattern"],
  executionClass: "local",
  deterministic: true,
  adapterId: "afi-adapter-pattern-local",
  requiresCredential: false,
  status: "active",
};
const instPattern: ProviderInstanceRecord = {
  schema: "afi.provider-instance.v1",
  providerInstanceId: "pattern-cross-local",
  recordVersion: "1.0.0",
  tenant: "tenant-a",
  category: "pattern",
  providerId: "afi-provider-pattern-local",
  adapterId: "afi-adapter-pattern-local",
  adapterVersion: "1.0.0",
  status: "active",
};
const PATTERN_REF = { providerInstanceId: "pattern-cross-local", recordVersion: "1.0.0" };

// A resolver that MUST never be called for a keyless provider — calling it fails.
class ThrowingResolver implements SecretResolver {
  invoked = false;
  async resolve(_request: SecretResolveRequest): Promise<never> {
    this.invoked = true;
    throw new Error("SecretResolver invoked for a keyless pattern provider");
  }
}

function fakeClient(
  response: unknown,
  capture?: { req?: PatternAnalyzeRequest },
  behavior: "ok" | "throw" = "ok"
): typeof callPatternService {
  return (async (req: PatternAnalyzeRequest) => {
    if (capture) capture.req = req;
    if (behavior === "throw") throw new Error("pattern service error: 503 Service Unavailable");
    return response as PatternAnalyzeResponse;
  }) as typeof callPatternService;
}

function patternAdapter(
  response: unknown = GOLDEN,
  capture?: { req?: PatternAnalyzeRequest },
  behavior: "ok" | "throw" = "ok"
): ProviderAdapter {
  return createPatternLocalAdapter({ callService: fakeClient(response, capture, behavior) });
}

function buildRuntime(adapter: ProviderAdapter, resolver: SecretResolver = new ThrowingResolver()) {
  const records = createProviderRecordStore({
    providers: [providerPattern],
    providerInstances: [instPattern],
  });
  return new ProviderRuntime({
    adapters: createAdapterRegistry([adapter]),
    records,
    resolver,
    outputValidator: createCategoryOutputValidator(),
  });
}

/** A canonical signal carrying the bounded pattern series on facts.series. */
function patternSignal(overrides: Record<string, unknown> = {}): CanonicalUss {
  const s = testSignal() as CanonicalUss & { facts: Record<string, unknown> };
  s.facts = {
    ...s.facts,
    ...overrides,
    series: { seriesId: SERIES_INPUT.seriesId, values: SERIES_INPUT.values, timestamps: SERIES_INPUT.timestamps },
  };
  return s;
}

function ctx(signal: CanonicalUss = patternSignal(), config: Record<string, unknown> = {}) {
  return { signal, config, logger: SILENT_NODE_LOGGER, abort: new AbortController().signal };
}

describe("Mission 4 — pattern adapter registration + compatibility", () => {
  it("is a statically registered builtin adapter (category 'pattern', keyless)", () => {
    const ids = builtinProviderAdapters().map((a) => `${a.adapterId}@${a.adapterVersion}`);
    expect(ids).toContain("afi-adapter-pattern-local@1.0.0");
    expect(patternLocalAdapter.category).toBe("pattern");
    expect(patternLocalAdapter.requiresCredential).toBe(false);
    expect(patternLocalAdapter.providerCompatibility).toContain("afi-provider-pattern-local");
  });

  it("resolves through the default buildProviderRuntime registry", () => {
    // buildProviderRuntime wires the three builtins; a pattern instance resolves.
    const rt = buildProviderRuntime({
      records: createProviderRecordStore({ providers: [providerPattern], providerInstances: [instPattern] }),
      resolver: new ThrowingResolver(),
    });
    expect(rt).toBeInstanceOf(ProviderRuntime);
  });
});

describe("Mission 4 — pattern adapter execution (keyless, edge-validated, one result)", () => {
  it("extracts the bounded series + trusted profile and emits exactly one validated pattern result", async () => {
    const resolver = new ThrowingResolver();
    const capture: { req?: PatternAnalyzeRequest } = {};
    const rt = buildRuntime(patternAdapter(GOLDEN, capture), resolver);

    const result = await rt.invoke(PATTERN_REF, ctx());

    // exactly one 'pattern' category result
    expect(result.category).toBe("pattern");
    expect(Array.isArray(result.motifs)).toBe(true);
    expect(Array.isArray(result.discords)).toBe(true);
    expect(Array.isArray(result.changePoints)).toBe(true);
    expect(Array.isArray(result.pivots)).toBe(true);

    // keyless: resolver never touched
    expect(resolver.invoked).toBe(false);

    // extracted ONLY the bounded canonical series + the fixed trusted profile
    expect(capture.req?.values).toEqual(SERIES_INPUT.values);
    expect(capture.req?.timestamps).toEqual(SERIES_INPUT.timestamps);
    expect(capture.req?.seriesId).toBe(SERIES_INPUT.seriesId);
    expect(capture.req?.params).toEqual({
      windowSize: 16,
      maxObservations: 8,
      changePointPenalty: 12.0,
      peakProminence: 0.05,
    });
  });

  it("the emitted result equals the golden response with the 'pattern' marker (deterministic replay)", async () => {
    const rt = buildRuntime(patternAdapter());
    const a = await rt.invoke(PATTERN_REF, ctx());
    const b = await rt.invoke(PATTERN_REF, ctx());
    const expected = { category: "pattern", ...GOLDEN };
    expect(JSON.parse(JSON.stringify(a))).toEqual(expected);
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it("carries no secret/credential-shaped field in the output", async () => {
    const rt = buildRuntime(patternAdapter());
    const result = await rt.invoke(PATTERN_REF, ctx());
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ["apikey", "authorization", "headervalue", "credential", "secret", "token", "password"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("does not select the provider from asset metadata (same instance ref regardless of symbol/market)", async () => {
    const capA: { req?: PatternAnalyzeRequest } = {};
    const capB: { req?: PatternAnalyzeRequest } = {};
    const rtA = buildRuntime(patternAdapter(GOLDEN, capA));
    const rtB = buildRuntime(patternAdapter(GOLDEN, capB));
    const rA = await rtA.invoke(PATTERN_REF, ctx(patternSignal({ symbol: "ETH/USDT", market: "spot" })));
    const rB = await rtB.invoke(PATTERN_REF, ctx(patternSignal({ symbol: "SOL/USDT", market: "perp" })));
    // Same explicitly-selected instance → same adapter → same category, independent of the asset.
    expect(rA.category).toBe("pattern");
    expect(rB.category).toBe("pattern");
    expect(capA.req?.values).toEqual(capB.req?.values);
  });

  it("threads the operator-configured invocation.timeoutMs to the client", async () => {
    let seenTimeout: number | undefined;
    const adapter = createPatternLocalAdapter({
      callService: (async (_req, opts) => {
        seenTimeout = opts?.timeoutMs;
        return GOLDEN;
      }) as typeof callPatternService,
    });
    const rt = buildRuntime(adapter);
    const tuned: ProviderInstanceRecord = { ...instPattern, providerInstanceId: "pattern-tuned", invocation: { timeoutMs: 250 } };
    const rt2 = new ProviderRuntime({
      adapters: createAdapterRegistry([adapter]),
      records: createProviderRecordStore({ providers: [providerPattern], providerInstances: [tuned] }),
      resolver: new ThrowingResolver(),
      outputValidator: createCategoryOutputValidator(),
    });
    await rt2.invoke({ providerInstanceId: "pattern-tuned", recordVersion: "1.0.0" }, ctx());
    expect(seenTimeout).toBe(250);
    void rt;
  });
});

describe("Mission 4 — pattern adapter fails closed", () => {
  it("rejects malformed Tiny Brains output at the schema edge (never reaches scoring)", async () => {
    // missing required 'series' + an unknown top-level field
    const malformed = { motifs: [], discords: [], changePoints: [], pivots: [], rawMatrixProfile: [1, 2, 3] };
    const rt = buildRuntime(patternAdapter(malformed));
    await expect(rt.invoke(PATTERN_REF, ctx())).rejects.toBeInstanceOf(ProviderOutputInvalidError);
  });

  it("rejects an out-of-range normalized value at the schema edge", async () => {
    const bad = { ...GOLDEN, motifs: [{ windowSize: 16, index: 0, neighborIndex: 1, similarity: 1.5 }] };
    const rt = buildRuntime(patternAdapter(bad));
    await expect(rt.invoke(PATTERN_REF, ctx())).rejects.toBeInstanceOf(ProviderOutputInvalidError);
  });

  it("propagates a service error with no silent provider fallback", async () => {
    const rt = buildRuntime(patternAdapter(GOLDEN, undefined, "throw"));
    await expect(rt.invoke(PATTERN_REF, ctx())).rejects.toThrow(/pattern service error/);
  });

  it("fails closed when the signal carries no bounded series", async () => {
    const rt = buildRuntime(patternAdapter());
    const bare = testSignal(); // no facts.series
    await expect(rt.invoke(PATTERN_REF, ctx(bare))).rejects.toBeInstanceOf(NodeConfigurationError);
  });

  it("fails closed when a series value is non-finite", async () => {
    const rt = buildRuntime(patternAdapter());
    const sig = patternSignal();
    (sig as unknown as { facts: { series: { values: unknown[] } } }).facts.series.values = [1, 2, Number.POSITIVE_INFINITY];
    await expect(rt.invoke(PATTERN_REF, ctx(sig))).rejects.toBeInstanceOf(NodeConfigurationError);
  });
});

describe("Mission 4 — executor threads providerInstanceRef; join topology unchanged", () => {
  it("the GraphExecutor resolves the pattern node and one pattern result flows to the scorer", async () => {
    const rt = buildRuntime(patternAdapter());
    const patternNode = createProviderBackedNode(
      { pluginId: "afi-analysis-pattern", pluginVersion: "1.0.0" },
      "pattern",
      rt
    );
    const trivialScorer: AnalysisNodePlugin = {
      manifestRef: { pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
      async run(input: unknown) {
        return ok({ scored: true, patternSeen: input });
      },
    };
    const registry = createPluginRegistry([patternNode, trivialScorer]);
    const executor = new GraphExecutor({ registry, logger: SILENT_NODE_LOGGER });

    const manifest: PipelineManifest = {
      schema: "afi.pipeline.v1",
      pipelineId: "provider-backed-pattern",
      pipelineVersion: "v1.0.0",
      entry: "pattern",
      nodes: [
        {
          id: "pattern",
          category: "pattern",
          pluginId: "afi-analysis-pattern",
          pluginVersion: "1.0.0",
          providerInstanceRef: PATTERN_REF,
        },
        { id: "scorer", category: "scorer", pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0" },
      ],
      edges: [{ from: "pattern", to: "scorer" }],
    };

    const exec = await executor.execute({ manifest, input: {}, signal: patternSignal() });
    const result = exec.result as { scored: boolean; patternSeen: { category: string; motifs: unknown[] } };
    expect(result.scored).toBe(true);
    expect(result.patternSeen.category).toBe("pattern");
    expect(Array.isArray(result.patternSeen.motifs)).toBe(true);
  });
});

describe("Mission 4 — vendored pattern schema provenance", () => {
  it("the vendored enrichment-pattern schema keeps its governed $id", () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), "src/pipeline/governed-schema/enrichment-pattern.schema.json"), "utf-8")
    ) as { $id: string; properties: { category: { const: string } } };
    expect(schema.$id).toBe("https://afi-protocol.org/schemas/enrichment/pattern/v1/enrichment-pattern.schema.json");
    expect(schema.properties.category.const).toBe("pattern");
  });
});
