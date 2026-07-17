/**
 * The FIFTEEN graph proofs (program section 9.3) over the factory conformance
 * fixtures (vendored byte-copies of afi-factory@9f88ede fixtures/conformance/
 * under test/pipeline/fixtures/conformance/) with injected DETERMINISTIC test
 * plugin implementations via a test-registry overlay — production source
 * contains NO mocks.
 */
import { jest } from "@jest/globals";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse; the test
// harness's registry module transitively touches the price-feed registry
// (repo idiom — see test/oracle/*.test.ts). No ccxt request is ever issued.
jest.mock("ccxt", () => {
  class UnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: UnusedExchange, coinbase: UnusedExchange },
  };
});

import {
  GraphExecutor,
  NodeExecutionError,
  PipelineAbortedError,
  type GraphExecutionResult,
  type GraphExecutorOptions,
} from "../../src/pipeline/executor.js";
import { canonicalize } from "../../src/pipeline/hashing.js";
import type { AnalysisPluginManifest } from "../../src/pipeline/manifestTypes.js";
import { NodeConfigurationError } from "../../src/pipeline/nodeSdk.js";
import {
  loadConformanceFixture,
  makeTestPluginSet,
  testSignal,
  type TestPluginSet,
} from "./support/testHarness.js";

const ENTRY_INPUT = { seed: "entry-input" };

function executorFor(
  set: TestPluginSet,
  overrides: Partial<GraphExecutorOptions> = {}
): GraphExecutor {
  return new GraphExecutor({ registry: set.registry, ...overrides });
}

async function run(
  fixture: string,
  set: TestPluginSet,
  options: Partial<GraphExecutorOptions> = {},
  context?: Record<string, unknown>,
  abortSignal?: AbortSignal
): Promise<GraphExecutionResult> {
  return executorFor(set, options).execute({
    manifest: loadConformanceFixture(fixture),
    input: ENTRY_INPUT,
    signal: testSignal(),
    context,
    abortSignal,
  });
}

function nodeRecord(result: GraphExecutionResult, nodeId: string) {
  const record = result.nodes.find((n) => n.nodeId === nodeId);
  if (!record) throw new Error(`no record for node '${nodeId}'`);
  return record;
}

function summaryStatuses(result: GraphExecutionResult): Array<[string, string]> {
  return result.summary.nodes.map((n) => [n.nodeId, n.status]);
}

function manifestsFor(
  entries: Record<string, Partial<AnalysisPluginManifest>>
): Map<string, AnalysisPluginManifest> {
  const map = new Map<string, AnalysisPluginManifest>();
  for (const [pluginId, partial] of Object.entries(entries)) {
    map.set(`${pluginId}@1.0.0`, {
      schema: "afi.analysis-plugin.v1",
      pluginId,
      pluginVersion: "1.0.0",
      implementationVersion: "1.0.0",
      category: "technical",
      inputSchemaRef: "afi.test.input.v1",
      outputSchemaRef: "afi.test.output.v1",
      deterministic: true,
      paramsSchema: {},
      mayFeedScorer: true,
      ...partial,
    } as AnalysisPluginManifest);
  }
  return map;
}

describe("the fifteen graph proofs (factory conformance fixtures + test-registry overlay)", () => {
  it("proof 01 — one category feeds the scorer directly; result extracted from the single scorer sink", async () => {
    const set = makeTestPluginSet();
    const result = await run("01-one-category.json", set);

    expect(summaryStatuses(result)).toEqual([
      ["technical", "executed"],
      ["scorer", "executed"],
    ]);
    // The scorer sink's output IS the pipeline result.
    const scorerOut = result.result as { plugin: string; echo: { plugin: string } };
    expect(scorerOut.plugin).toBe("afi-scorer-froggy-trend-pullback");
    expect(scorerOut.echo.plugin).toBe("afi-analysis-technical");
    // Node config reached the technical node.
    expect((nodeRecord(result, "technical").output as { config: unknown }).config).toEqual({
      candleLimit: 200,
    });
    expect(result.executionSummaryHash.domainTag).toBe("afi.d2.execution-summary");
  });

  it("proof 02 — sequential chain: pattern consumes technical's 'candles' output port", async () => {
    const candles = [1, 2, 3, 4];
    const set = makeTestPluginSet({
      "afi-analysis-technical": { output: () => ({ category: "technical", candles }) },
    });
    const result = await run("02-sequential-multi-category.json", set);

    // The edge's fromPort routed ONLY the named port value to pattern.
    const patternInput = (nodeRecord(result, "pattern").output as { echo: unknown }).echo;
    expect(patternInput).toEqual(candles);

    // Strict sequential ordering: pattern started after technical finished.
    const technicalEvent = set.events.find((e) => e.pluginId === "afi-analysis-technical")!;
    const patternEvent = set.events.find((e) => e.pluginId === "afi-analysis-pattern")!;
    expect(patternEvent.startedAt).toBeGreaterThanOrEqual(technicalEvent.finishedAt);
    expect(nodeRecord(result, "pattern").wave).toBeGreaterThan(nodeRecord(result, "technical").wave);
  });

  it("proof 03 — concurrency derives from dependency structure: sentiment and news share a wave and overlap", async () => {
    const set = makeTestPluginSet({
      "afi-analysis-sentiment": { delayMs: 40 },
      "afi-analysis-news": { delayMs: 40 },
    });
    const result = await run("03-parallel-multi-category.json", set);

    expect(nodeRecord(result, "sentiment").wave).toBe(nodeRecord(result, "news").wave);
    expect(set.concurrency.max).toBeGreaterThanOrEqual(2);
    expect(summaryStatuses(result)).toEqual([
      ["technical", "executed"],
      ["news", "executed"],
      ["sentiment", "executed"],
      ["merge", "executed"],
      ["scorer", "executed"],
    ]);
  });

  it("proof 04 — multi-parent join delivers { parents } keyed by nodeId (no hardcoded parent ids)", async () => {
    const set = makeTestPluginSet();
    const result = await run("04-branch-deterministic-join.json", set);

    const mergeInput = (nodeRecord(result, "merge").output as { echo: { parents: Record<string, unknown> } })
      .echo;
    expect(Object.keys(mergeInput.parents).sort()).toEqual(["pattern", "sentiment"]);
    expect((mergeInput.parents.pattern as { plugin: string }).plugin).toBe("afi-analysis-pattern");
    expect((mergeInput.parents.sentiment as { plugin: string }).plugin).toBe(
      "afi-analysis-sentiment"
    );
  });

  it("proof 05 — conditional edge true activates the gated branch", async () => {
    const set = makeTestPluginSet({
      "afi-analysis-technical": { output: () => ({ category: "technical", atrPct: 2.5 }) },
    });
    const result = await run("05-conditional-node.json", set);

    expect(nodeRecord(result, "news").status).toBe("executed");
    const mergeInput = (nodeRecord(result, "merge").output as { echo: { parents: Record<string, unknown> } })
      .echo;
    expect((mergeInput.parents.news as { plugin: string }).plugin).toBe("afi-analysis-news");
  });

  it("proof 06 — conditional edge false skips the branch; the optional join edge contributes an empty namespace", async () => {
    const set = makeTestPluginSet({
      "afi-analysis-technical": { output: () => ({ category: "technical", atrPct: 1.0 }) },
    });
    const result = await run("05-conditional-node.json", set);

    expect(nodeRecord(result, "news").status).toBe("skipped");
    expect(summaryStatuses(result)).toContainEqual(["news", "skipped"]);
    const mergeInput = (nodeRecord(result, "merge").output as { echo: { parents: Record<string, unknown> } })
      .echo;
    expect(mergeInput.parents.news).toEqual({});
    expect(nodeRecord(result, "scorer").status).toBe("executed");
    expect(result.result).toBeDefined();
  });

  it("proof 07 — repeated same-category nodes run under distinct namespaces with their own configs", async () => {
    const set = makeTestPluginSet();
    const result = await run("06-repeated-same-category.json", set);

    const mergeInput = (nodeRecord(result, "merge").output as { echo: { parents: Record<string, unknown> } })
      .echo;
    expect(Object.keys(mergeInput.parents).sort()).toEqual(["news-fast", "news-slow", "technical"]);
    expect((mergeInput.parents["news-fast"] as { config: unknown }).config).toEqual({ windowHours: 4 });
    expect((mergeInput.parents["news-slow"] as { config: unknown }).config).toEqual({ windowHours: 24 });
  });

  it("proof 08 — fail-soft optional category: a declared degrade policy records failed-optional and the join proceeds", async () => {
    const set = makeTestPluginSet({
      "afi-analysis-sentiment": { error: () => new Error("provider exploded") },
    });
    const result = await run("07-fail-soft-optional-category.json", set);

    const sentiment = nodeRecord(result, "sentiment");
    expect(sentiment.status).toBe("failed-optional");
    expect(sentiment.degradations).toEqual([
      { class: "node-failure", detail: "provider exploded" },
    ]);
    expect(summaryStatuses(result)).toContainEqual(["sentiment", "failed-optional"]);
    const mergeInput = (nodeRecord(result, "merge").output as { echo: { parents: Record<string, unknown> } })
      .echo;
    expect(mergeInput.parents.sentiment).toEqual({}); // empty namespace, never fabricated data
    expect(nodeRecord(result, "scorer").status).toBe("executed");
  });

  it("proof 09 — critical category failure aborts the whole run honestly", async () => {
    const set = makeTestPluginSet({
      "afi-analysis-pattern": { error: () => new Error("pattern kernel failure") },
    });
    await expect(run("08-critical-category-failure.json", set)).rejects.toThrow(
      NodeExecutionError
    );
    // The scorer never ran.
    expect(set.events.some((e) => e.pluginId === "afi-scorer-froggy-trend-pullback")).toBe(false);
  });

  it("proof 10 — NodeConfigurationError is fatal even under a declared degrade policy (D-FCP-8)", async () => {
    const set = makeTestPluginSet({
      "afi-analysis-sentiment": {
        error: () => new NodeConfigurationError("COINALYZE_API_KEY missing"),
      },
    });
    // Fixture 07 declares sentiment critical:false + degrade — configuration
    // failures must STILL abort the pipeline.
    const failure = run("07-fail-soft-optional-category.json", set);
    await expect(failure).rejects.toThrow(NodeExecutionError);
    await expect(failure).rejects.toMatchObject({ fatalReason: "configuration" });
  });

  it("proof 11 — per-node timeout aborts the attempt via AbortController", async () => {
    const set = makeTestPluginSet({
      "afi-analysis-technical": { hangUntilAbort: true },
    });
    const failure = run("01-one-category.json", set, {
      pluginManifests: manifestsFor({ "afi-analysis-technical": { defaultTimeoutMs: 50 } }),
    });
    await expect(failure).rejects.toThrow(/timed out after 50ms/);
  });

  it("proof 12 — retries honor maxRetries + exponential backoff, no retry beyond policy", async () => {
    const sleeps: number[] = [];
    const set = makeTestPluginSet({
      "afi-analysis-technical": {
        error: () => new Error("transient provider error"),
        failuresBeforeSuccess: 2,
      },
    });
    const result = await run("01-one-category.json", set, {
      pluginManifests: manifestsFor({
        "afi-analysis-technical": {
          defaultRetryPolicy: { maxRetries: 2, retryDelayMs: 10, backoff: "exponential" },
        },
      }),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(set.attemptCounts.get("afi-analysis-technical")).toBe(3);
    expect(sleeps).toEqual([10, 20]); // exponential from retryDelayMs 10
    expect(nodeRecord(result, "technical").status).toBe("executed");
    expect(nodeRecord(result, "technical").attempts).toBe(3);
  });

  it("proof 13 — external cancellation aborts the run through the root AbortController", async () => {
    const controller = new AbortController();
    const set = makeTestPluginSet({
      "afi-analysis-technical": {
        output: () => {
          // Cancel while wave 1 is still pending.
          setTimeout(() => controller.abort(new Error("operator cancelled")), 5);
          return { category: "technical" };
        },
      },
      "afi-analysis-sentiment": { delayMs: 5_000 },
      "afi-analysis-news": { delayMs: 5_000 },
    });
    await expect(
      run("03-parallel-multi-category.json", set, {}, undefined, controller.signal)
    ).rejects.toThrow(PipelineAbortedError);
    expect(set.events.some((e) => e.pluginId === "afi-scorer-froggy-trend-pullback")).toBe(false);
  });

  it("proof 14 — the concurrency limit bounds a wave (limit 1 serializes parallel branches)", async () => {
    const serialized = makeTestPluginSet({
      "afi-analysis-news": { delayMs: 15 },
    });
    await run("06-repeated-same-category.json", serialized, { concurrency: 1 });
    expect(serialized.concurrency.max).toBe(1);

    const parallel = makeTestPluginSet({
      "afi-analysis-news": { delayMs: 15 },
    });
    await run("06-repeated-same-category.json", parallel); // default limit 4
    expect(parallel.concurrency.max).toBeGreaterThanOrEqual(2);
  });

  it("proof 15 — branch-permutation determinism: opposite branch completion orders yield identical result bytes and executionSummaryHash", async () => {
    const runWith = async (patternDelay: number, sentimentDelay: number) => {
      const set = makeTestPluginSet({
        "afi-analysis-pattern": {
          delayMs: patternDelay,
          output: () => ({ category: "pattern", patternName: "hammer" }),
        },
        "afi-analysis-sentiment": {
          delayMs: sentimentDelay,
          output: () => ({ category: "sentiment", score: 0.75 }),
        },
        "afi-analysis-technical": { output: () => ({ category: "technical", atrPct: 2 }) },
      });
      return run("04-branch-deterministic-join.json", set);
    };

    const fastPattern = await runWith(1, 40); // pattern completes first
    const fastSentiment = await runWith(40, 1); // sentiment completes first

    expect(canonicalize(fastPattern.result)).toBe(canonicalize(fastSentiment.result));
    expect(fastPattern.executionSummaryHash).toEqual(fastSentiment.executionSummaryHash);
    expect(fastPattern.summary).toEqual(fastSentiment.summary);
  });
});
