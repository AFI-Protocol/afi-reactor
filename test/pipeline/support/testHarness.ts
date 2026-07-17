/**
 * Test harness for the GraphExecutor proofs: DETERMINISTIC test plugin
 * implementations registered through a test-registry overlay
 * (createPluginRegistry). These implementations exist ONLY under test/ —
 * production source contains NO mock implementations (D-FCP-8); injecting a
 * registry is data injection through the executor's public seam.
 */
import type { CanonicalUss } from "../../../src/types/canonicalUss.js";
import type {
  AnalysisNodePlugin,
  NodeResult,
  NodeRunContext,
} from "../../../src/pipeline/nodeSdk.js";
import {
  createPluginRegistry,
  type PluginRegistry,
} from "../../../src/pipeline/pluginRegistry.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AnalysisPluginManifest,
  PipelineManifest,
} from "../../../src/pipeline/manifestTypes.js";

/** The factory conformance proof graphs (read from the afi-factory file: dependency). */
export const CONFORMANCE_DIR = join(
  process.cwd(),
  "node_modules/afi-factory/fixtures/conformance"
);

export function loadConformanceFixture(name: string): PipelineManifest {
  return JSON.parse(readFileSync(join(CONFORMANCE_DIR, name), "utf-8"));
}

/** The authored fixture registries (test-only afi-config overlay). */
export const FIXTURE_CONFIG_ROOT = join(process.cwd(), "test/pipeline/fixtures/afi-config");

export function loadFixturePluginManifests(): Map<string, AnalysisPluginManifest> {
  const dir = join(FIXTURE_CONFIG_ROOT, "registries/analysis-plugins");
  const map = new Map<string, AnalysisPluginManifest>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const manifest = JSON.parse(readFileSync(join(dir, file), "utf-8")) as AnalysisPluginManifest;
    map.set(`${manifest.pluginId}@${manifest.pluginVersion}`, manifest);
  }
  return map;
}

/** A deterministic canonical USS signal for executor tests. */
export function testSignal(): CanonicalUss {
  return {
    schema: "afi.usignal.v1.1",
    provenance: {
      source: "test",
      providerId: "test-provider",
      signalId: "sig-graph-proof-0001",
    },
    facts: {
      symbol: "BTC/USDT",
      market: "perp",
      timeframe: "1h",
      strategy: "trend_pullback_v1",
      direction: "long",
    },
  } as CanonicalUss;
}

export interface TestRunEvent {
  nodeId: string;
  pluginId: string;
  startedAt: number;
  finishedAt: number;
  input: unknown;
  config: Record<string, unknown>;
}

export interface TestPluginBehavior {
  /** Deterministic output factory (default: category-tagged echo). */
  output?: (input: unknown, ctx: NodeRunContext) => unknown;
  /** Recorded degradations to return. */
  degradations?: NodeResult["degradations"];
  /** Throw this error (after `failuresBeforeSuccess` successes are exhausted). */
  error?: () => Error;
  /** Number of leading attempts that fail before succeeding (retry proofs). */
  failuresBeforeSuccess?: number;
  /** Artificial delay in ms (abort-aware). */
  delayMs?: number | (() => number);
  /** Never resolve until aborted (timeout proofs). */
  hangUntilAbort?: boolean;
}

export interface TestPluginSet {
  registry: PluginRegistry;
  events: TestRunEvent[];
  /** Current number of concurrently running plugins + observed maximum. */
  concurrency: { current: number; max: number };
  attemptCounts: Map<string, number>;
}

const SEVEN_PLUGIN_IDS = [
  "afi-analysis-technical",
  "afi-analysis-pattern",
  "afi-analysis-sentiment",
  "afi-analysis-news",
  "afi-analysis-aiml",
  "afi-merge-enriched-view",
  "afi-scorer-froggy-trend-pullback",
] as const;

function abortableDelay(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abort.aborted) return reject(abort.reason ?? new Error("aborted"));
    const t = setTimeout(() => {
      abort.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abort.reason ?? new Error("aborted"));
    };
    abort.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Builds a deterministic test plugin set for the seven governed plugin ids.
 * Default behavior: resolve `{ plugin: <pluginId>, echo: <input> }` so joins
 * and port routing are observable byte-for-byte.
 */
export function makeTestPluginSet(
  behaviors: Partial<Record<(typeof SEVEN_PLUGIN_IDS)[number], TestPluginBehavior>> = {}
): TestPluginSet {
  const events: TestRunEvent[] = [];
  const concurrency = { current: 0, max: 0 };
  const attemptCounts = new Map<string, number>();

  const plugins: AnalysisNodePlugin[] = SEVEN_PLUGIN_IDS.map((pluginId) => ({
    manifestRef: { pluginId, pluginVersion: "1.0.0" },
    async run(input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      const behavior = behaviors[pluginId] ?? {};
      const attempts = (attemptCounts.get(pluginId) ?? 0) + 1;
      attemptCounts.set(pluginId, attempts);

      concurrency.current += 1;
      concurrency.max = Math.max(concurrency.max, concurrency.current);
      const startedAt = Date.now();
      try {
        if (behavior.hangUntilAbort) {
          await new Promise((_, reject) => {
            const onAbort = () => reject(ctx.abort.reason ?? new Error("aborted"));
            if (ctx.abort.aborted) return onAbort();
            ctx.abort.addEventListener("abort", onAbort, { once: true });
          });
        }
        const delay =
          typeof behavior.delayMs === "function" ? behavior.delayMs() : behavior.delayMs ?? 0;
        if (delay > 0) await abortableDelay(delay, ctx.abort);

        if (behavior.error && attempts <= (behavior.failuresBeforeSuccess ?? Infinity)) {
          throw behavior.error();
        }

        const output = behavior.output
          ? behavior.output(input, ctx)
          : { plugin: pluginId, echo: input, config: ctx.config };
        return { output, degradations: behavior.degradations ?? [] };
      } finally {
        concurrency.current -= 1;
        events.push({
          nodeId: "(unknown)",
          pluginId,
          startedAt,
          finishedAt: Date.now(),
          input,
          config: ctx.config,
        });
      }
    },
  }));

  return { registry: createPluginRegistry(plugins), events, concurrency, attemptCounts };
}
