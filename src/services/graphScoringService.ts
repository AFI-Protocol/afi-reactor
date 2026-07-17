/**
 * Graph scoring service — the LIVE scoring path of the configurable-pipelines
 * program (W3 spec sections 4-7; supersedes froggyScoringService, which stays
 * present-but-unreferenced until the cleanup PR).
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
  /** The complete afi.composition-ref.v1 stamp for the evidence v2 record. */
  composition: CompositionRefV1;
  /** The resolved registration identity (evidence stamp recognition input). */
  registration: ResolvedRegistrationIdentity;
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
  const execution = await composition.executor.execute({
    manifest: effectiveManifest(resolved),
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

  return {
    scored,
    composition: compositionRef,
    registration: {
      analystId: resolved.registration.analystId,
      strategyId: resolved.registration.strategyId,
      strategyVersion: resolved.registration.strategyVersion,
      uwrProfileRef: { profileId: resolved.config.uwrProfileRef.profileId },
    },
  };
}
