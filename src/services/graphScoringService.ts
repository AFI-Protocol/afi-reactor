/**
 * Graph scoring service — the LIVE scoring path of the configurable-pipelines
 * program (W3 spec sections 4-7; superseded and replaced the hardcoded
 * scoring service, removed under D-FCP-9).
 *
 * ingest → (strategy already resolved by src/config/strategyResolution.ts)
 * → GraphExecutor over the REGISTERED pipeline manifest → ReactorScoredSignalV1
 * + the afi.composition-ref.v1 provenance stamp for the evidence v2 record.
 *
 * Everything identity-shaped comes from the boot-validated registry
 * composition: NO hardcoded pipeline, NO hardcoded strategy triple, NO
 * hardcoded decay horizon (resolveDecayParams over the registration's
 * decayConfig), NO froggy conditionals.
 *
 * enrichment-bundle projection (documented; see also src/evidence/README.md):
 *   enrichmentHash = canonical-json-hashing.v1 hash (domain tag
 *   afi.d2.enrichment-bundle) of
 *     { schema: 'afi.enrichment-bundle.v1',
 *       signalId,
 *       lenses:            [the run's USS lens objects, sorted by lens type],
 *       enrichedCategories: [enrichmentMeta.categories, sorted] }
 *   The projection is TIMESTAMP-FREE by construction: it carries only the
 *   lens payloads and category names — enrichmentMeta.enrichedAt (and every
 *   other volatile processing timestamp) is never part of it. Domain-declared
 *   evidence timestamps inside lens payloads (e.g. news items' publishedAt)
 *   are admissible hash material per the D2 hash doctrine. The value is
 *   JSON-round-tripped first, so the hash covers exactly the JSON semantics
 *   of the bundle (Dates as ISO strings, undefined dropped).
 */
import type { ReactorScoredSignalV1 } from "../types/ReactorScoredSignalV1.js";
import type { CanonicalUss } from "../types/canonicalUss.js";
import { getRuntimeComposition, type RuntimeComposition } from "../config/runtimeComposition.js";
import { canonicalHashOf, DOMAIN_TAGS } from "../pipeline/hashing.js";
import type { CompositionRefV1, PipelineManifest } from "../pipeline/manifestTypes.js";
import { resolveDecayParams, type ResolvedStrategy } from "../pipeline/registryLoader.js";
import type { AnalysisCategory, ProviderRecordStore } from "../providers/index.js";
import type {
  EvidenceInvocationCapture,
  LaneBindingExpectation,
} from "../evidence/reactorEvidenceRecord.js";

/** The registration identity the evidence stamp site consumes (registry-backed
 *  UWR recognition — src/config/uwrProfilePin.ts). */
export interface ResolvedRegistrationIdentity {
  analystId: string;
  strategyId: string;
  strategyVersion: string;
  uwrProfileRef: { profileId: string };
}

/** One completed scoring run: the response contract + composition provenance. */
export interface ScoredCompositionRun {
  scored: ReactorScoredSignalV1;
  /** The complete afi.composition-ref.v1 stamp for the evidence record. */
  composition: CompositionRefV1;
  /** The resolved registration identity (evidence stamp recognition input). */
  registration: ResolvedRegistrationIdentity;
  /**
   * The run's captured invocation facts (EV3-GOV D-EV3-5(2)): per-lane
   * proofs from the one live graph pass, the actual lane results the join
   * consumed, the boot-verified expected lane bindings, and the
   * registration-resolved decay identity. Carried to the sole District Two
   * Evidence V3 builder — never consumed by any scoring path (D-EV3-2).
   */
  invocations: EvidenceInvocationCapture;
}

/** The five governed analysis lanes (D-FCP-1 namespace, casing exact). */
const ANALYSIS_LANES: ReadonlySet<string> = new Set([
  "technical",
  "pattern",
  "sentiment",
  "news",
  "aiMl",
]);

/**
 * Assemble the per-lane EXPECTED identity facts from the manifest's explicit
 * provider selections + the boot-validated record store (the D-FLPR-4 chain).
 * The evidence layer cross-checks captured proofs against these — it never
 * reads registries itself (RC-7).
 */
function laneBindingExpectations(
  manifest: PipelineManifest,
  records: ProviderRecordStore
): LaneBindingExpectation[] {
  const bindings: LaneBindingExpectation[] = [];
  for (const node of manifest.nodes) {
    if (!ANALYSIS_LANES.has(node.category) || !node.providerInstanceRef) continue;
    const ref = node.providerInstanceRef;
    const instance = records.getProviderInstance(ref.providerInstanceId, ref.recordVersion);
    if (!instance) {
      // Boot validation guarantees resolution; reaching here is a defensive
      // impossibility — refuse rather than emit an unverifiable expectation.
      throw new Error(
        `lane '${node.id}' names unresolvable provider instance '${ref.providerInstanceId}@${ref.recordVersion}'`
      );
    }
    const provider = records.getProvider(instance.providerId);
    if (!provider) {
      throw new Error(
        `provider instance '${instance.providerInstanceId}' names unresolvable provider '${instance.providerId}'`
      );
    }
    const binding: LaneBindingExpectation = {
      category: node.category as AnalysisCategory,
      nodeId: node.id,
      providerInstanceId: instance.providerInstanceId,
      instanceRecordVersion: instance.recordVersion,
      providerId: provider.providerId,
      providerRecordVersion: provider.recordVersion,
      adapterId: instance.adapterId,
      adapterVersion: instance.adapterVersion,
    };
    if (instance.model !== undefined) binding.model = instance.model;
    if (instance.credentialRef !== undefined) binding.credentialRef = instance.credentialRef;
    bindings.push(binding);
  }
  return bindings;
}

/** The scorer sink's output envelope (identical to the live analyst plugin's). */
interface ScorerOutput {
  analysis?: { analystScore?: ReactorScoredSignalV1["analystScore"] };
  uwrResolvedSource?: unknown;
  lenses?: unknown[];
  _priceFeedMetadata?: Record<string, unknown>;
  enrichmentMeta?: { categories?: string[] };
  [key: string]: unknown;
}

/**
 * Apply the registration's validated nodeOverrides to the registered manifest
 * (config merge per node). `enabled:false` is not supported by this runtime —
 * fail closed rather than silently serving a different graph.
 */
function effectiveManifest(resolved: ResolvedStrategy): PipelineManifest {
  const overrides = resolved.config.nodeOverrides ?? {};
  if (Object.keys(overrides).length === 0) return resolved.pipeline;
  return {
    ...resolved.pipeline,
    nodes: resolved.pipeline.nodes.map((node) => {
      const override = overrides[node.id];
      if (!override) return node;
      if (override.enabled === false) {
        throw new Error(
          `nodeOverrides['${node.id}'].enabled=false is not supported by this runtime — refusing to serve a silently altered graph.`
        );
      }
      return override.config
        ? { ...node, config: { ...(node.config ?? {}), ...override.config } }
        : node;
    }),
  };
}

/**
 * Execute the resolved registered strategy over the canonical USS signal and
 * assemble the ReactorScoredSignalV1 response + composition provenance.
 */
export async function scoreRegisteredStrategyFromCanonicalUss(
  canonicalUss: CanonicalUss,
  resolved: ResolvedStrategy,
  composition: RuntimeComposition = getRuntimeComposition()
): Promise<ScoredCompositionRun> {
  const manifest = effectiveManifest(resolved);
  const execution = await composition.executor.execute({
    manifest,
    input: {},
    signal: canonicalUss,
  });

  const scorerOutput = execution.result as ScorerOutput;
  const analystScore = scorerOutput?.analysis?.analystScore;
  if (!analystScore) {
    throw new Error("the scorer sink did not produce analysis.analystScore");
  }

  // RC-6: the UWR source the scorer ACTUALLY scored with, propagated verbatim
  // from the composition path. Never re-derived downstream (the canonical
  // evidence stamp site consumes this; it must not re-read the flag or the
  // environment). Resolution is fail-closed (RC-4): a failed/invalid
  // resolution throws inside the scorer node before any scoring, so reaching
  // here means it succeeded.
  const uwrResolvedSource = scorerOutput.uwrResolvedSource;
  if (uwrResolvedSource !== "builtin" && uwrResolvedSource !== "registry") {
    throw new Error(
      `the scorer sink did not propagate a recognized uwrResolvedSource ` +
        `(got ${JSON.stringify(uwrResolvedSource)}) — refusing to produce a scored ` +
        `signal whose UWR provenance cannot be stamped honestly.`
    );
  }

  // Decay from the REGISTRATION's decayConfig (governed template or validated
  // inline surface) — no horizon inference, no hardcoded template.
  const decayParams = resolveDecayParams(resolved.decay);

  const scoredAt = new Date().toISOString();
  const provenance = (canonicalUss as { provenance?: Record<string, unknown> }).provenance ?? {};
  const facts = (canonicalUss as { facts?: Record<string, unknown> }).facts ?? {};
  const signalId = String(provenance.signalId ?? "");

  const lenses = Array.isArray(scorerOutput.lenses) ? scorerOutput.lenses : [];
  const priceFeedMetadata = scorerOutput._priceFeedMetadata ?? {};

  const scored: ReactorScoredSignalV1 = {
    signalId,
    rawUss: canonicalUss,
    lenses: lenses.length > 0 ? (lenses as unknown[]) : undefined,
    _priceFeedMetadata: {
      priceSource: priceFeedMetadata.priceSource as string | undefined,
      venueType: priceFeedMetadata.venueType as string | undefined,
      marketType: priceFeedMetadata.marketType as string | undefined,
      technicalIndicators: priceFeedMetadata.technicalIndicators,
      patternSignals: priceFeedMetadata.patternSignals,
    },
    analystScore,
    uwrResolvedSource,
    scoredAt,
    decayParams: {
      halfLifeMinutes: decayParams.halfLifeMinutes,
      greeksTemplateId: decayParams.greeksTemplateId,
    },
    meta: {
      symbol: (facts.symbol as string) ?? "UNKNOWN",
      timeframe: (facts.timeframe as string) ?? "1h",
      strategy: (facts.strategy as string) ?? "unknown",
      direction: (facts.direction as ReactorScoredSignalV1["meta"]["direction"]) ?? "neutral",
      source: (provenance.source as string) ?? "tradingview-webhook",
    },
  };

  // enrichment-bundle projection (documented in the module header): the run's
  // lenses sorted by type + the sorted enriched category names — timestamp-free.
  const enrichmentBundle = JSON.parse(
    JSON.stringify({
      schema: "afi.enrichment-bundle.v1",
      signalId,
      lenses: [...lenses].sort((a, b) => {
        const ta = String((a as { type?: unknown })?.type ?? "");
        const tb = String((b as { type?: unknown })?.type ?? "");
        return ta < tb ? -1 : ta > tb ? 1 : 0;
      }),
      enrichedCategories: [...(scorerOutput.enrichmentMeta?.categories ?? [])].sort(),
    })
  );
  const enrichmentHash = canonicalHashOf(enrichmentBundle, DOMAIN_TAGS.enrichmentBundle);

  const compositionRef: CompositionRefV1 = {
    schema: "afi.composition-ref.v1",
    pipelineId: resolved.pipeline.pipelineId,
    pipelineVersion: resolved.pipeline.pipelineVersion,
    manifestHash: resolved.manifestHash,
    analystConfigHash: resolved.analystConfigHash,
    scorerPluginId: resolved.config.scorerRef.pluginId,
    scorerPluginVersion: resolved.config.scorerRef.pluginVersion,
    pluginSetHash: resolved.pluginSetHash,
    executionSummaryHash: execution.executionSummaryHash,
    enrichmentHash,
  };

  // The ACTUAL per-lane category results the join consumed (EV3-GOV
  // D-EV3-5(3) recomputation source): the settled lane-node outputs from the
  // one live pass. First-write-wins per category — a manifest with duplicate
  // lane categories fails the builder's duplicate-proof law anyway.
  const laneResults: Partial<Record<AnalysisCategory, unknown>> = {};
  for (const node of manifest.nodes) {
    if (!ANALYSIS_LANES.has(node.category)) continue;
    const category = node.category as AnalysisCategory;
    if (laneResults[category] !== undefined) continue;
    const record = execution.nodes.find((r) => r.nodeId === node.id);
    if (
      record &&
      (record.status === "executed" || record.status === "degraded") &&
      record.output !== undefined
    ) {
      laneResults[category] = record.output;
    }
  }

  return {
    scored,
    composition: compositionRef,
    registration: {
      analystId: resolved.registration.analystId,
      strategyId: resolved.registration.strategyId,
      strategyVersion: resolved.registration.strategyVersion,
      uwrProfileRef: { profileId: resolved.config.uwrProfileRef.profileId },
    },
    invocations: {
      proofs: execution.invocationProofs,
      laneResults,
      laneBindings: laneBindingExpectations(manifest, composition.providerRecordStore),
      decay: {
        halfLifeMinutes: decayParams.halfLifeMinutes,
        greeksTemplateId: decayParams.greeksTemplateId,
      },
    },
  };
}
