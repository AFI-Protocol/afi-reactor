/**
 * Provider-adapter layer — public surface (PBF-GOV foundation, activated as
 * the sole live enrichment-execution seam by FLPR-GOV).
 *
 * ONE bounded provider-adapter socket inside the Reactor, below the category
 * node: a trusted registered-adapter registry, provider-instance resolution, a
 * least-privilege SecretResolver, canonical category-output validation, and
 * the statically registered five-lane adapter set. It is NOT a second executor
 * and does NOT replace the GraphExecutor.
 */
import { createAdapterRegistry } from "./adapterRegistry.js";
import { createProviderRecordStore, type ProviderRecordStore } from "./records.js";
import { createCategoryOutputValidator } from "./outputValidation.js";
import { NoCredentialsResolver, type SecretResolver } from "./secretResolver.js";
import { ProviderRuntime } from "./providerRuntime.js";
import { technicalLocalAdapter } from "./adapters/technicalLocalAdapter.js";
import { httpNewsAdapter } from "./adapters/httpNewsAdapter.js";
import { newsSecEdgarAdapter } from "./adapters/newsSecEdgarAdapter.js";
import { patternCandlestickAdapter } from "./adapters/patternCandlestickAdapter.js";
import { patternTinyBrainsAdapter } from "./adapters/patternTinyBrainsAdapter.js";
import { sentimentCftcCotAdapter } from "./adapters/sentimentCftcCotAdapter.js";
import { sentimentCoinalyzeAdapter } from "./adapters/sentimentCoinalyzeAdapter.js";
import { aimlTinyBrainsAdapter } from "./adapters/aimlTinyBrainsAdapter.js";
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
export { createPatternCandlestickAdapter, patternCandlestickAdapter } from "./adapters/patternCandlestickAdapter.js";
export { createPatternTinyBrainsAdapter, patternTinyBrainsAdapter } from "./adapters/patternTinyBrainsAdapter.js";
export { createSentimentCftcCotAdapter, sentimentCftcCotAdapter } from "./adapters/sentimentCftcCotAdapter.js";
export { createSentimentCoinalyzeAdapter, sentimentCoinalyzeAdapter } from "./adapters/sentimentCoinalyzeAdapter.js";
export { createNewsSecEdgarAdapter, newsSecEdgarAdapter } from "./adapters/newsSecEdgarAdapter.js";
export { createAimlTinyBrainsAdapter, aimlTinyBrainsAdapter } from "./adapters/aimlTinyBrainsAdapter.js";

/**
 * The trusted, compiled, statically registered adapter set of the five-lane
 * provider runtime (FLPR-GOV D-FLPR-2): technical keyless-local, news BYOK +
 * keyless SEC-EDGAR, pattern first-party candlestick + tiny-brains service,
 * sentiment keyless CFTC-COT + Coinalyze BYOK, aiMl first-party tiny-brains.
 */
export function builtinProviderAdapters(): ProviderAdapter[] {
  return [
    technicalLocalAdapter,
    httpNewsAdapter,
    newsSecEdgarAdapter,
    patternCandlestickAdapter,
    patternTinyBrainsAdapter,
    sentimentCftcCotAdapter,
    sentimentCoinalyzeAdapter,
    aimlTinyBrainsAdapter,
  ];
}

export interface BuildProviderRuntimeOptions {
  /** Non-secret provider/instance/credential-ref records (deployment-local). */
  records?: ProviderRecordStore;
  /** Injected secret backend (defaults to fail-closed NoCredentialsResolver). */
  resolver?: SecretResolver;
  /** Extra adapters beyond the built-ins (still trusted + registered). */
  extraAdapters?: ReadonlyArray<ProviderAdapter>;
  /** Vendored governed-schema dir override (tests only). */
  schemaDir?: string;
}

/**
 * Construct the bounded provider runtime. The adapter registry is validated at
 * construction (duplicate registration fails closed — D-PBF-5). With no records
 * and the default resolver, provider-backed nodes fail closed; production boot
 * loads the governed provider/instance/credential-ref registries and injects
 * the env-backed reference secret resolver (FLPR-GOV D-FLPR-7).
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
