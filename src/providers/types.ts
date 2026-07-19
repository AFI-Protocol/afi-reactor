/**
 * Provider-adapter layer — core types (PBF-GOV D-PBF-4/D-PBF-5/D-PBF-7).
 *
 * A bounded provider-adapter socket that lives INSIDE the Reactor, BELOW the
 * category node. It never becomes a second executor and never replaces the
 * GraphExecutor: a provider-backed node resolves its ProviderInstance, the
 * runtime resolves ONLY the authorized credential (least-privilege), invokes
 * the trusted registered adapter, validates the category output, and returns
 * exactly ONE category result to the existing scorer-facing path.
 *
 * The credential boundary is structural: an adapter receives a bounded,
 * provider-specific credential BUNDLE (never a resolver handle, never a
 * secret-management client). It cannot enumerate or resolve arbitrary secrets.
 */
import type { CanonicalUss } from "../types/canonicalUss.js";
import type { NodeLogger } from "../pipeline/nodeSdk.js";
import type { NodeCategory } from "../pipeline/manifestTypes.js";

/** The five open analysis lanes a provider may supply (never merge/scorer). */
export type AnalysisCategory = Extract<
  NodeCategory,
  "technical" | "pattern" | "sentiment" | "news" | "aiMl"
>;

/** The only credential kind v0.1 supports: an API key carried in a request header. */
export interface ApiKeyHeaderCredential {
  kind: "apiKeyHeader";
  /** The header the adapter must set (e.g. "X-ACCESS-KEY"). Non-secret. */
  headerName: string;
  /** The secret value — NEVER logged, NEVER returned, NEVER placed in a URL. */
  headerValue: string;
}

/**
 * A bounded, provider-specific credential bundle. The Reactor resolves the
 * exact authorized credential and hands the adapter ONLY this — never a
 * resolver, never a secret-management client (PBF-GOV D-PBF-7 "Preferred").
 */
export type ProviderCredentialBundle = ApiKeyHeaderCredential;

/** One resolved category result — the ONE value a provider contributes to the join. */
export interface CategoryResult {
  category: string;
  [field: string]: unknown;
}

/**
 * The per-invocation context handed to a provider adapter. It carries the
 * signal, the non-secret invocation settings, a SCRUBBING logger, the abort
 * signal, and — only when the provider requires one — the already-resolved,
 * bounded credential. There is NO resolver handle here.
 */
export interface ProviderAdapterContext {
  /** Canonical USS v1.1 signal (read-only). */
  signal: CanonicalUss;
  /**
   * The executor node input for the invoking category node (parent outputs /
   * port selection), passed through VERBATIM by the provider-backed node.
   * Graph data only — never vendor configuration and never credential
   * material. Absent for lanes whose adapters are signal-driven.
   */
  input?: unknown;
  /** Non-secret invocation settings (from the provider instance + node config). */
  config: Record<string, unknown>;
  /**
   * The resolved instance's governed model/profile identity (afi.provider-instance.v1
   * `model`, validated against the provider's supportedModels). First-party services
   * with internal orchestration (e.g. Tiny Brains) receive it verbatim as their
   * explicit orchestration-profile selection. Absent when the instance names none.
   */
  model?: string;
  /** Scrubbing operational logger (secrets never reach console). */
  logger: NodeLogger;
  /** Per-invocation abort signal. */
  abort: AbortSignal;
  /** The ONLY authorized credential, present iff the provider requires one. */
  credential?: ProviderCredentialBundle;
}

/**
 * A trusted, compiled, registered provider adapter. Adapter identity is
 * explicit; there is no dynamic import, no arbitrary module path, no user code.
 */
export interface ProviderAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly category: AnalysisCategory;
  /** Provider ids this adapter is compatible with. */
  readonly providerCompatibility: readonly string[];
  /** Whether invoking this adapter requires a credential bundle. */
  readonly requiresCredential: boolean;
  /** Execute the provider and return exactly one category result. */
  run(ctx: ProviderAdapterContext): Promise<CategoryResult>;
}

/** A versioned, non-secret reference a pipeline node carries to a provider instance. */
export interface ProviderInstanceRef {
  providerInstanceId: string;
  recordVersion: string;
}
