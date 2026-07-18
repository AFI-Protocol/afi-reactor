/**
 * TypeScript views of the vendored governed FACTORY-CONTRACT artifacts
 * (src/pipeline/governed-schema/*.schema.json, pinned from
 * afi-config@e462c4e8). Hand-maintained mirrors — the schemas remain the
 * single authority; AJV validation over the vendored bytes is what admits a
 * document, never these types.
 */

/** afi.pipeline.v1 — node categories (five analysis + merge + scorer). */
export type NodeCategory =
  | "technical"
  | "pattern"
  | "sentiment"
  | "news"
  | "aiMl"
  | "merge"
  | "scorer";

export type BackoffPolicy = "none" | "fixed" | "exponential";
export type FailurePolicy = "abort" | "degrade";

export interface JoinDeclaration {
  policy: "all";
  merge: {
    strategy: "namespace-by-node" | "declared-fields";
    /** 'error' or 'prefer:<nodeId>' */
    conflictRule: string;
  };
}

export interface PipelineNode {
  id: string;
  category: NodeCategory;
  pluginId: string;
  pluginVersion: string;
  config?: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  backoff?: BackoffPolicy;
  critical?: boolean;
  failurePolicy?: FailurePolicy;
  resourceLimits?: Record<string, unknown>;
  join?: JoinDeclaration;
  /**
   * OPTIONAL non-secret reference to an afi.provider-instance.v1 record
   * (identity + version only; PBF-GOV D-PBF-4). Admissible only on the five
   * analysis-category nodes. NEVER a credential value.
   */
  providerInstanceRef?: { providerInstanceId: string; recordVersion: string };
}

/** Governed predicate tree (afi.pipeline.v1 #/definitions/predicate). */
export type Predicate = Record<string, unknown>;

export interface PipelineEdge {
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
  condition?: Predicate;
  optional?: boolean;
}

export interface PipelineManifest {
  schema: "afi.pipeline.v1";
  pipelineId: string;
  pipelineVersion: string;
  description?: string;
  entry: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  metadata?: Record<string, unknown>;
}

/** afi.analysis-plugin.v1 (the declarative plugin manifest). */
export interface AnalysisPluginManifest {
  schema: "afi.analysis-plugin.v1";
  pluginId: string;
  pluginVersion: string;
  implementationVersion: string;
  category: NodeCategory;
  description?: string;
  inputSchemaRef: string;
  outputSchemaRef: string;
  deterministic: boolean;
  capabilities?: string[];
  defaultTimeoutMs?: number;
  defaultRetryPolicy?: {
    maxRetries: number;
    retryDelayMs?: number;
    backoff?: BackoffPolicy;
  };
  permittedFailurePolicies?: FailurePolicy[];
  paramsSchema: Record<string, unknown>;
  multiInstance?: boolean;
  orderingConstraints?: {
    mustRunBefore?: NodeCategory[];
    mustRunAfter?: NodeCategory[];
  };
  mayFeedScorer: boolean;
  metadata?: Record<string, unknown>;
}

/** CanonicalHash v1 reference (vendored canonical-hash.schema.json). */
export interface CanonicalHashDoc {
  algorithm: "sha256";
  canonicalizationVersion: string;
  domainTag: string;
  value: string;
  legacyHashRef?: string;
}

/** afi.analyst-strategy-config.v1 (the analyst's selection object). */
export interface AnalystStrategyConfig {
  schema: "afi.analyst-strategy-config.v1";
  analystId: string;
  strategyId: string;
  strategyVersion: string;
  pipelineRef: {
    pipelineId: string;
    pipelineVersion: string;
    manifestHash: CanonicalHashDoc;
  };
  scorerRef: { pluginId: string; pluginVersion: string };
  uwrProfileRef: { profileId: string };
  decayConfig:
    | { ref: { templateId: string } }
    | Record<string, unknown>;
  nodeOverrides?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
  metadata?: Record<string, unknown>;
}

/** afi.analyst-strategy-registration.v1 (registry entry). */
export interface AnalystStrategyRegistration {
  schema: "afi.analyst-strategy-registration.v1";
  analystId: string;
  strategyId: string;
  strategyVersion: string;
  analystConfigHash: CanonicalHashDoc;
  configRef: string;
  providerBindingPolicy: {
    mode: "explicit" | "any-authenticated";
    allowedBindings?: string[];
  };
  status: "active" | "inactive";
  registeredAt: string;
  registrationRef: string;
}

export interface StrategyTriple {
  analystId: string;
  strategyId: string;
  strategyVersion: string;
}

/**
 * afi.composition-ref.v1 (vendored composition-ref.schema.json) — the
 * COMPLETE, hash-pinned identity of the composition that produced one scored
 * signal. Every field REQUIRED (all-or-nothing: partial composition
 * provenance is inadmissible — a submitter that cannot produce every pin
 * refuses to submit).
 */
export interface CompositionRefV1 {
  schema: "afi.composition-ref.v1";
  pipelineId: string;
  pipelineVersion: string;
  manifestHash: CanonicalHashDoc;
  analystConfigHash: CanonicalHashDoc;
  scorerPluginId: string;
  scorerPluginVersion: string;
  pluginSetHash: CanonicalHashDoc;
  executionSummaryHash: CanonicalHashDoc;
  enrichmentHash: CanonicalHashDoc;
}

/** afi.provider-strategy-binding.v1 (provider-to-strategy routing). */
export interface ProviderStrategyBinding {
  schema: "afi.provider-strategy-binding.v1";
  bindingId: string;
  providerId: string;
  providerType: "webhook" | "cpj" | "gateway";
  authenticatedBy: "route-secret" | "gateway-tenant" | "integration-key";
  allowedStrategies: StrategyTriple[];
  defaultStrategy?: StrategyTriple;
  status: "active" | "inactive";
}
