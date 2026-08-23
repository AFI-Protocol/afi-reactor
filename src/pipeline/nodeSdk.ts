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
import type { CanonicalUss } from "../types/canonicalUss.js";
import type { ProviderInvocationProofV1 } from "../providers/invocationProof.js";
import type { ResolvedUwrRuntimeConfig } from "../config/uwrRuntimeProfile.js";

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
  /**
   * OPTIONAL non-secret provider-instance reference from the manifest node
   * (identity + version only; PBF-GOV D-PBF-4). Present only on provider-backed
   * nodes; a credential value NEVER appears here. Resolution happens BELOW the
   * node in the provider-adapter layer.
   */
  providerInstanceRef?: { providerInstanceId: string; recordVersion: string };
  /**
   * OPTIONAL invocation-proof deposit sink (EV3-GOV D-EV3-5(2)): the executor
   * wires a per-node collector here so a provider-backed node can deposit the
   * afi.provider-invocation-proof.v1 the runtime captured inside THIS live
   * pass. Proofs travel with execution state to District Two; no node, join,
   * or scoring path ever reads them back (carried, never consumed —
   * D-EV3-2).
   */
  depositInvocationProof?: (proof: ProviderInvocationProofV1) => void;

  /**
   * OPTIONAL resolved UWR configuration for the determination in scope
   * (CFG-GOV D-CFG-4(4)): resolved above the executor from the strategy
   * registration's uwrProfileRef, never re-resolved or defaulted here.
   * This field carries resolved UWR configuration ONLY — it is not a general
   * node-parameter channel (node params remain schema-validated under
   * FCP-GOV D-FCP-2(7)); a guardrail asserts the scorer node is its sole
   * reader. Present on scorer-bearing runs; a scorer node that does not
   * receive it refuses to score (fail-closed, RC-4).
   */
  uwr?: ResolvedUwrRuntimeConfig;

  /**
   * OPTIONAL resolved enrichment mapping for the determination in scope
   * (DEM-GOV D-DEM-2(6)): resolved fail-closed at boot from the strategy
   * registration's mappingRef, never re-resolved or defaulted here. Carries
   * the AJV-validated registered document ONLY — not a general node-parameter
   * channel (node params remain schema-validated under FCP-GOV D-FCP-2(7));
   * a guardrail asserts the scorer node is its sole reader. Authorized by the
   * DEM-BIND scope item "the resolution seam", exactly as CFG-GOV's resolved
   * UWR carrier above.
   */
  mapping?: ResolvedMappingCarrier;
}

/** The bounded per-determination mapping carrier (DEM-GOV D-DEM-2(6)). */
export interface ResolvedMappingCarrier {
  mappingId: string;
  version: string;
  doc: Record<string, unknown>;
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
