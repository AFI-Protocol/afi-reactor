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
 * Production source contains NO mock implementations: the builtin bindings
 * below are the five vendor-neutral provider-backed category lanes (each a
 * createProviderBackedNode over the boot-built ProviderRuntime — FLPR-GOV
 * D-FLPR-1), the deterministic five-category merge, and the scorer. Tests
 * inject their own registries via createPluginRegistry (a test-registry
 * overlay), which is data injection — not a production code path.
 */
import type { AnalysisNodePlugin } from "./nodeSdk.js";
import { createProviderBackedNode } from "../providers/providerBackedNode.js";
import type { ProviderRuntime } from "../providers/providerRuntime.js";
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
 * The production build-time binding (FLPR-GOV five-lane provider runtime):
 * five vendor-neutral provider-backed category lanes @2.0.0 (each requires an
 * explicit providerInstanceRef on its manifest node — fail closed), the
 * five-category merge @1.1.0, and the scorer @1.0.0.
 */
export function builtinPluginRegistry(providerRuntime: ProviderRuntime): PluginRegistry {
  return createPluginRegistry([
    createProviderBackedNode(
      { pluginId: "afi-analysis-technical", pluginVersion: "2.0.0" },
      "technical",
      providerRuntime
    ),
    createProviderBackedNode(
      { pluginId: "afi-analysis-pattern", pluginVersion: "2.0.0" },
      "pattern",
      providerRuntime
    ),
    createProviderBackedNode(
      { pluginId: "afi-analysis-sentiment", pluginVersion: "2.0.0" },
      "sentiment",
      providerRuntime
    ),
    createProviderBackedNode(
      { pluginId: "afi-analysis-news", pluginVersion: "2.0.0" },
      "news",
      providerRuntime
    ),
    createProviderBackedNode(
      { pluginId: "afi-analysis-aiml", pluginVersion: "2.0.0" },
      "aiMl",
      providerRuntime
    ),
    mergeEnrichedViewNode,
    scorerFroggyTrendPullbackNode,
  ]);
}
