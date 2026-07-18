/**
 * Provider-adapter layer — public surface (PBF-GOV Wave 1).
 *
 * ONE bounded provider-adapter socket inside the Reactor, below the category
 * node: a trusted registered-adapter registry, provider-instance resolution, a
 * least-privilege SecretResolver, canonical category-output validation, and the
 * two reference adapters (keyless technical, credentialed news). It is NOT a
 * second executor and does NOT replace the GraphExecutor.
 */
import { createAdapterRegistry } from "./adapterRegistry.js";
import { createProviderRecordStore, type ProviderRecordStore } from "./records.js";
import { createCategoryOutputValidator } from "./outputValidation.js";
import { NoCredentialsResolver, type SecretResolver } from "./secretResolver.js";
import { ProviderRuntime } from "./providerRuntime.js";
import { technicalLocalAdapter } from "./adapters/technicalLocalAdapter.js";
import { httpNewsAdapter } from "./adapters/httpNewsAdapter.js";
import type { ProviderAdapter } from "./types.js";

export * from "./types.js";
export * from "./errors.js";
export * from "./redaction.js";
export * from "./secretResolver.js";
export * from "./adapterRegistry.js";
export * from "./records.js";
export * from "./outputValidation.js";
export * from "./providerRuntime.js";
export * from "./providerBackedNode.js";
export { createTechnicalLocalAdapter, technicalLocalAdapter } from "./adapters/technicalLocalAdapter.js";
export { createHttpNewsAdapter, httpNewsAdapter } from "./adapters/httpNewsAdapter.js";

/** The two trusted, compiled, registered reference adapters. */
export function builtinProviderAdapters(): ProviderAdapter[] {
  return [technicalLocalAdapter, httpNewsAdapter];
}

export interface BuildProviderRuntimeOptions {
  /** Non-secret provider/instance/credential-ref records (deployment-local). */
  records?: ProviderRecordStore;
  /** Injected secret backend (defaults to fail-closed NoCredentialsResolver). */
  resolver?: SecretResolver;
  /** Extra adapters beyond the two built-ins (still trusted + registered). */
  extraAdapters?: ReadonlyArray<ProviderAdapter>;
  /** Vendored governed-schema dir override (tests only). */
  schemaDir?: string;
}

/**
 * Construct the bounded provider runtime. The adapter registry is validated at
 * construction (duplicate registration fails closed — D-PBF-5). With no records
 * and the default resolver, provider-backed nodes fail closed until a
 * deployment configures them; the froggy production pipeline uses none.
 */
export function buildProviderRuntime(options: BuildProviderRuntimeOptions = {}): ProviderRuntime {
  const adapters = createAdapterRegistry([
    ...builtinProviderAdapters(),
    ...(options.extraAdapters ?? []),
  ]);
  const records = options.records ?? createProviderRecordStore({}, options.schemaDir);
  const resolver = options.resolver ?? new NoCredentialsResolver();
  const outputValidator = createCategoryOutputValidator(options.schemaDir);
  return new ProviderRuntime({ adapters, records, resolver, outputValidator });
}
