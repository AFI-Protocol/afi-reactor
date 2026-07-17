/**
 * Node SDK — the fixed plugin contract every category-node implementation
 * satisfies (W3 spec section 1).
 *
 * A node implementation is a build-time-bound object keyed by
 * pluginId@pluginVersion (src/pipeline/pluginRegistry.ts). It receives its
 * (already routed/joined) input value plus a NodeRunContext, and returns a
 * NodeResult envelope: the output value and an explicit degradation ledger.
 *
 * Failure taxonomy (D-FCP-8 honest failure):
 *  - NodeConfigurationError (missing REQUIRED env/infrastructure) is ALWAYS
 *    fatal — pipeline abort — regardless of the node's failurePolicy.
 *  - Any other thrown error is a provider/data failure: retried per policy,
 *    then abort (critical, the default) or recorded as failed-optional
 *    (critical:false + failurePolicy 'degrade').
 *  - A resolved NodeResult with a non-empty degradations list marks the node
 *    'degraded' in the execution summary; its OUTPUT is still used (it is
 *    real, partial data such as a declared fallback summary — never
 *    fabricated success data).
 */
import type { CanonicalUss } from "../services/pipelineRunner.js";

export type { CanonicalUss };

/** Structured, operational-only logger handed to every node. */
export interface NodeLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** No-op logger (default when the caller provides none). */
export const SILENT_NODE_LOGGER: NodeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** The fixed per-invocation context (W3 spec section 1). */
export interface NodeRunContext {
  /** The canonical USS v1.1 signal being scored (read-only source of truth). */
  signal: CanonicalUss;
  /** The node's validated manifest config (node.config, possibly {}). */
  config: Record<string, unknown>;
  /** Structured operational logger. */
  logger: NodeLogger;
  /** Abort signal: per-node timeout and pipeline-wide cancellation. */
  abort: AbortSignal;
}

/** One recorded degradation — never silent, never fabricated data. */
export interface NodeDegradation {
  /** Machine-checkable class, e.g. 'service-unconfigured', 'provider-unavailable'. */
  class: string;
  /** Human-readable detail. */
  detail: string;
}

/** The result envelope every node resolves with. */
export interface NodeResult {
  output: unknown;
  degradations: NodeDegradation[];
}

/** The build-time-bound implementation of one afi.analysis-plugin.v1 manifest. */
export interface AnalysisNodePlugin {
  manifestRef: { pluginId: string; pluginVersion: string };
  run(input: unknown, ctx: NodeRunContext): Promise<NodeResult>;
}

/**
 * Missing REQUIRED configuration/infrastructure. ALWAYS fatal: the executor
 * aborts the whole pipeline regardless of failurePolicy — an unconfigured
 * dependency must surface as an honest failure, never as a degraded score
 * (D-FCP-8).
 */
export class NodeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeConfigurationError";
  }
}

/** Convenience: a clean successful result. */
export function ok(output: unknown, degradations: NodeDegradation[] = []): NodeResult {
  return { output, degradations };
}
