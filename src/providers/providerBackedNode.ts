/**
 * Provider-backed category node (PBF-GOV D-PBF-2/D-PBF-8).
 *
 * A thin AnalysisNodePlugin that binds a category to the provider-adapter
 * runtime: it reads the node's non-secret providerInstanceRef, delegates to the
 * ProviderRuntime (resolution → least-privilege credential → adapter →
 * canonical output validation), and returns exactly ONE validated category
 * result to the existing scorer-facing join. It performs no credential handling
 * itself; the runtime owns the secret boundary.
 */
import {
  NodeConfigurationError,
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../pipeline/nodeSdk.js";
import type { AnalysisCategory } from "./types.js";
import type { ProviderRuntime } from "./providerRuntime.js";

export function createProviderBackedNode(
  manifestRef: { pluginId: string; pluginVersion: string },
  category: AnalysisCategory,
  runtime: ProviderRuntime
): AnalysisNodePlugin {
  return {
    manifestRef,
    async run(_input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      if (!ctx.providerInstanceRef) {
        // A provider-backed node with no reference is a configuration error
        // (ALWAYS fatal, D-FCP-8) — never a silently degraded score.
        throw new NodeConfigurationError(
          `provider-backed '${category}' node requires a providerInstanceRef on its manifest node`
        );
      }
      const result = await runtime.invoke(ctx.providerInstanceRef, {
        signal: ctx.signal,
        config: ctx.config,
        logger: ctx.logger,
        abort: ctx.abort,
      });
      // The runtime already enforced result.category === instance.category and
      // validated the canonical category contract — one result per category.
      return ok(result);
    },
  };
}
