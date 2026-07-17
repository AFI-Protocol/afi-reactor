/**
 * Build-time plugin registry — the ONLY place a pluginId@pluginVersion is
 * bound to code (afi.analysis-plugin.v1 x-afiConstraints.buildTimeBinding).
 *
 * The manifest layer never carries filesystem paths or module specifiers; a
 * pipeline node names pluginId+pluginVersion and the consuming runtime binds
 * it HERE, statically, at build time. There is no dynamic import and no
 * lazy discovery — an unbound plugin fails boot validation
 * (src/pipeline/registryLoader.ts), never a request.
 *
 * Production source contains NO mock implementations: the seven builtin
 * bindings below wrap the EXISTING production kernels (W3 spec section 5).
 * Tests inject their own registries via createPluginRegistry (a test-registry
 * overlay), which is data injection — not a production code path.
 */
import type { AnalysisNodePlugin } from "./nodeSdk.js";
import { technicalNode } from "./nodes/technical.js";
import { patternNode } from "./nodes/pattern.js";
import { sentimentNode } from "./nodes/sentiment.js";
import { newsNode } from "./nodes/news.js";
import { aimlNode } from "./nodes/aiml.js";
import { mergeEnrichedViewNode } from "./nodes/mergeEnrichedView.js";
import { scorerFroggyTrendPullbackNode } from "./nodes/scorerFroggyTrendPullback.js";

export interface PluginRegistry {
  get(pluginId: string, pluginVersion: string): AnalysisNodePlugin | undefined;
  has(pluginId: string, pluginVersion: string): boolean;
  /** All bound keys, 'pluginId@pluginVersion', sorted. */
  keys(): string[];
}

export function pluginKey(pluginId: string, pluginVersion: string): string {
  return `${pluginId}@${pluginVersion}`;
}

/** Builds an immutable registry from a static list of implementations. */
export function createPluginRegistry(
  plugins: ReadonlyArray<AnalysisNodePlugin>
): PluginRegistry {
  const byKey = new Map<string, AnalysisNodePlugin>();
  for (const plugin of plugins) {
    const key = pluginKey(plugin.manifestRef.pluginId, plugin.manifestRef.pluginVersion);
    if (byKey.has(key)) {
      throw new Error(`duplicate plugin binding: ${key}`);
    }
    byKey.set(key, plugin);
  }
  return {
    get: (id, version) => byKey.get(pluginKey(id, version)),
    has: (id, version) => byKey.has(pluginKey(id, version)),
    keys: () => [...byKey.keys()].sort(),
  };
}

/**
 * The production build-time binding: the seven governed category plugins of
 * the V1 program (kebab-case ids, all pluginVersion 1.0.0 — W3 spec
 * section 10), each wrapping the existing production kernels.
 */
export function builtinPluginRegistry(): PluginRegistry {
  return createPluginRegistry([
    technicalNode,
    patternNode,
    sentimentNode,
    newsNode,
    aimlNode,
    mergeEnrichedViewNode,
    scorerFroggyTrendPullbackNode,
  ]);
}
