/**
 * Shared Evidence V3 fixture world (EV3-GOV §15 proof layers).
 *
 * ONE deterministic, schema-valid five-lane invocation world reused by the
 * submission suite, the D-EV3-5(3) contract suite, the §15.2 mutation-matrix
 * suite, the D-EV3-6 redaction suite, and the EV3 guard block: a complete
 * scored signal, five lane results, five boot-verified lane bindings, five
 * self-consistent invocation proofs (real CanonicalHash refs computed by the
 * production projections), and a complete composition context. Every helper
 * builds FRESH objects so suites can mutate freely.
 */

import type { ReactorScoredSignalV1 } from "../../../src/types/ReactorScoredSignalV1.js";
import type {
  EvidenceCompositionContext,
  EvidenceInvocationCapture,
  LaneBindingExpectation,
} from "../../../src/evidence/reactorEvidenceRecord.js";
import {
  buildInvocationInputProjection,
  categoryResultHash,
  invocationInputHash,
  providerInstanceRecordFingerprint,
  providerRecordFingerprint,
  providerResultHash,
} from "../../../src/evidence/provenance/invocationProofHashes.js";
import {
  PROOF_CATEGORY_ORDER,
  RESULT_SCHEMA_BY_CATEGORY,
  type ProviderInvocationProofV1,
} from "../../../src/providers/invocationProof.js";
import type { AnalysisCategory } from "../../../src/providers/types.js";
import { canonicalHashOf, DOMAIN_TAGS } from "../../../src/pipeline/hashing.js";
import type { CompositionRefV1 } from "../../../src/pipeline/manifestTypes.js";

export const DECAY = { halfLifeMinutes: 240, greeksTemplateId: "decay-swing-v1" } as const;

export const HEX64 = "cd".repeat(32);

export function makeScored(overrides: Record<string, unknown> = {}): ReactorScoredSignalV1 {
  const signalId = (overrides.signalId as string) ?? "sig-reactor-unit-1";
  const analystScore = {
    analystId: "froggy",
    strategyId: "trend_pullback_v1",
    strategyVersion: "1.0.0",
    direction: "long",
    riskBucket: "medium",
    conviction: 0.72,
    uwrScore: 0.81,
    uwrAxes: { structure: 0.8, execution: 0.7, risk: 0.85, insight: 0.9 },
    ...((overrides.analystScore as Record<string, unknown>) ?? {}),
  };
  return {
    signalId,
    rawUss: {
      schema: "afi.usignal.v1.1",
      provenance: { signalId, providerId: "prov-test", source: "test" },
      facts: { symbol: "BTCUSDT", timeframe: "1h", direction: "long", strategy: "trend_pullback_v1" },
    },
    analystScore,
    // RC-6 source PROPAGATED from the composition path (default: builtin).
    // `in` (not ??) so a test can force an explicitly-absent source.
    uwrResolvedSource:
      "uwrResolvedSource" in overrides ? overrides.uwrResolvedSource : "builtin",
    scoredAt: "2026-01-15T12:00:00Z",
    decayParams: "decayParams" in overrides ? overrides.decayParams : { ...DECAY },
    meta: { symbol: "BTCUSDT", timeframe: "1h", strategy: "trend_pullback_v1", direction: "long", source: "test" },
  } as unknown as ReactorScoredSignalV1;
}

/** Fresh five-lane category results (schema-valid ids; deterministic content). */
export function makeLaneResults(): Record<AnalysisCategory, Record<string, unknown>> {
  return {
    technical: { category: "technical", candles: [{ timestamp: 1, close: 100.5 }], priceSource: "demo" },
    pattern: { category: "pattern", series: { seriesId: "s", length: 1, indexBasis: "position" }, motifs: [] },
    sentiment: { category: "sentiment", axes: [{ axis: "positioning", score: 0.5 }] },
    news: { category: "news", news: { hasShockEvent: false, headlines: [] } },
    aiMl: { category: "aiMl", forecast: { direction: "long", conviction: 0.85 } },
  };
}

export function makeBinding(category: AnalysisCategory): LaneBindingExpectation {
  const slug = category.toLowerCase();
  const binding: LaneBindingExpectation = {
    category,
    nodeId: slug,
    providerInstanceId: `pi-${slug}-unit`,
    instanceRecordVersion: "1.0.0",
    providerId: `provider-${slug}-unit`,
    providerRecordVersion: "1.0.0",
    adapterId: `adapter-${slug}-unit`,
    adapterVersion: "1.0.0",
  };
  if (category === "aiMl") binding.model = "froggy-reference-v1";
  return binding;
}

/**
 * Build one self-consistent proof for a lane: every hash is REALLY computed
 * by the production projection functions over the same facts the builder
 * recomputes from, so the baseline world passes every D-EV3-5(3) cross-check.
 */
export function makeProof(
  category: AnalysisCategory,
  binding: LaneBindingExpectation,
  laneResult: { category: string }
): ProviderInvocationProofV1 {
  const providerRecord = { providerId: binding.providerId, recordVersion: binding.providerRecordVersion };
  const instanceRecord = {
    providerInstanceId: binding.providerInstanceId,
    recordVersion: binding.instanceRecordVersion,
    model: binding.model,
  };
  const proof: ProviderInvocationProofV1 = {
    schema: "afi.provider-invocation-proof.v1",
    category,
    resultSchema: RESULT_SCHEMA_BY_CATEGORY[category],
    provider: {
      providerId: binding.providerId,
      recordVersion: binding.providerRecordVersion,
      recordFingerprint: providerRecordFingerprint(providerRecord),
      executionClass: category === "technical" || category === "pattern" ? "local" : "remote",
      deterministic: category === "technical" || category === "pattern",
    },
    providerInstance: {
      providerInstanceId: binding.providerInstanceId,
      recordVersion: binding.instanceRecordVersion,
      recordFingerprint: providerInstanceRecordFingerprint(instanceRecord),
      ...(binding.model !== undefined ? { model: binding.model } : {}),
    },
    adapter: {
      adapterId: binding.adapterId,
      adapterVersion: binding.adapterVersion,
      transportKind: category === "technical" || category === "pattern" ? "in-process" : "http",
    },
    credential: { mode: "keyless" },
    invocationInputHash: invocationInputHash(
      buildInvocationInputProjection({
        category,
        adapterId: binding.adapterId,
        adapterVersion: binding.adapterVersion,
        model: binding.model,
        params: {},
        signal: { schema: "afi.usignal.v1.1" },
      })
    ),
    providerResultHash: providerResultHash(laneResult),
    categoryResultHash: categoryResultHash(laneResult),
    status: "succeeded",
  };
  if (category === "technical") {
    proof.priceSource = (laneResult as { priceSource?: string }).priceSource;
  }
  if (category === "aiMl") {
    proof.aimlInvocation = {
      schema: "afi.aiml-invocation-proof.v1",
      // The orchestration profile that ran IS the governed instance model
      // (D-EV3-3) — follow the binding so consistent world mutations hold.
      profileId: binding.model ?? "froggy-reference-v1",
      profileVersion: "1.0.0",
      resolverId: "froggy-agreement",
      resolverVersion: "1.0.0",
      codeConfigFingerprint: HEX64,
      hashLaw: "tiny-brains.hash.v1",
      inputHash: HEX64,
      outputHash: HEX64,
      status: "succeeded",
      experts: [
        {
          expertId: "chronos-bolt-forecaster",
          expertVersion: "1.0.0",
          posture: "probabilistic",
          status: "succeeded",
          outputHash: HEX64,
        },
        {
          expertId: "trend-baseline",
          expertVersion: "1.0.0",
          posture: "deterministic",
          status: "succeeded",
          outputHash: HEX64,
        },
      ],
    };
  }
  return proof;
}

export function makeInvocations(): EvidenceInvocationCapture {
  const laneResults = makeLaneResults();
  const laneBindings = PROOF_CATEGORY_ORDER.map((c) => makeBinding(c));
  const proofs = PROOF_CATEGORY_ORDER.map((c) =>
    makeProof(c, laneBindings.find((b) => b.category === c)!, laneResults[c] as { category: string })
  );
  return {
    proofs,
    laneResults: { ...laneResults },
    laneBindings,
    decay: { ...DECAY },
  };
}

/** A complete, schema-valid composition context (real CanonicalHash refs). */
export function makeContext(
  overrides: Partial<EvidenceCompositionContext> = {}
): EvidenceCompositionContext {
  const composition: CompositionRefV1 = {
    schema: "afi.composition-ref.v1",
    pipelineId: "froggy-trend-pullback",
    pipelineVersion: "v1.3.0",
    manifestHash: canonicalHashOf({ fixture: "manifest" }, DOMAIN_TAGS.compositionManifest),
    analystConfigHash: canonicalHashOf({ fixture: "config" }, DOMAIN_TAGS.analystConfig),
    scorerPluginId: "afi-scorer-froggy-trend-pullback",
    scorerPluginVersion: "1.0.0",
    pluginSetHash: canonicalHashOf({ fixture: "plugins" }, DOMAIN_TAGS.pluginSet),
    executionSummaryHash: canonicalHashOf({ fixture: "summary" }, DOMAIN_TAGS.executionSummary),
    enrichmentHash: canonicalHashOf({ fixture: "enrichment" }, DOMAIN_TAGS.enrichmentBundle),
  };
  return {
    composition: (overrides.composition as CompositionRefV1) ?? composition,
    registration:
      overrides.registration ??
      ({
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        strategyVersion: "1.0.0",
        uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
      } as EvidenceCompositionContext["registration"]),
    invocations: overrides.invocations ?? makeInvocations(),
  };
}
