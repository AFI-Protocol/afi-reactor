/**
 * D2 artifact builders — construct District 2 provenance artifacts from the
 * existing signal-evaluation intermediates WITHOUT changing scoring math.
 *
 * REFERENCE IMPLEMENTATION BOUNDARY: everything in this module is one example
 * signal-evaluation path (an implementation profile) demonstrating how a
 * pipeline can emit D2-compatible artifacts. Canonical status belongs only to
 * the merged afi-config schemas, validation rules, and hash doctrine — never
 * to this pipeline topology, lane set, strategy, FroggyEnrichedView, or the
 * ingestion/normalization method used here. Other analysts, validators,
 * institutions, and AFI-compatible agents are free to implement different
 * pipelines as long as they emit valid artifacts.
 *
 * NO CIRCULAR PROVENANCE HASHING (acyclic commitment order, by construction):
 *  1. `provenanceRecordRefFor(signalId)` is deterministic and derived ONLY
 *     from the signalId — never from any digest of the ProvenanceRecord.
 *  2. The ScoredSignal v1 projection is built FIRST and carries only that
 *     string ref (never a `provenanceRecordHash` and never any digest of the
 *     record).
 *  3. `ProvenanceRecord.outputHash` then commits to the FINISHED ScoredSignal
 *     projection. Record -> ScoredSignal commitment is one-directional, so a
 *     ScoredSignal <-> ProvenanceRecord hash cycle cannot exist.
 *
 * ESM: relative imports use `.js`; afi-core is never imported here.
 */

import type { AfiCandle } from "../../types/AfiCandle.js";
import type {
  AnalysisBundle,
  AnalysisLaneId,
  AnalysisLaneResult,
  InternalScoringResult,
} from "../types.js";
import { ANALYSIS_LANE_IDS } from "../types.js";
import { isDegradedLaneResult, LANE_PROVISIONAL } from "../fanOut.js";
import {
  computeCanonicalHashV1,
  D2_DOMAIN_TAGS,
  AFI_HASH_V1,
  type CanonicalHashV1,
} from "./canonicalHashV1.js";
import {
  projectDecimalFieldsForHash,
  ENRICHMENT_DECIMAL_KEYS,
  OHLCV_DECIMAL_KEYS,
  SCORE_DECIMAL_KEYS,
} from "./hashProjection.js";
import {
  ANALYST_INPUT_ENVELOPE_SCHEMA,
  PROVENANCE_RECORD_SCHEMA,
  REPLAY_PROFILE_SCHEMA,
  SCORED_SIGNAL_SCHEMA,
  type AnalystInputEnvelopeV1,
  type EnrichmentProvenanceV1,
  type EvidenceRefV1,
  type ProvenanceRecordV1,
  type ReplayProfileV1,
  type ScoredSignalV1,
  type SourceDisclosureProfileV1,
} from "./types.js";

/** Engine identity pins for this reference implementation. */
export const PIPEHEAD_ENGINE_ID = "afi-reactor.pipeheads";
export const PIPEHEAD_ENGINE_VERSION = "1.0.0";

/** Per-lane definition/version pins (reference implementation profile). */
export const LANE_VERSIONS: Record<AnalysisLaneId, string> = {
  "technical-indicators": "1.0.0",
  "pattern-recognition": "1.0.0",
  news: "1.0.0",
  social: "1.0.0",
  "ai-ml": "1.0.0",
};

/** Committed fixture dataset pin used by the ReplayProfile. */
export const FIXTURE_DATASET_ID =
  "afi-reactor.pipeheads.fixtures.btc-usdt-perp-4h@v1";

/** Reference analyst/strategy identity this example path targets. */
export const REFERENCE_ANALYST_ID = "froggy";
export const REFERENCE_STRATEGY_ID = "trend_pullback_v1";

/** Declared (non-canonical, strategy-owned) view type of the opaque payload. */
export const STRATEGY_VIEW_TYPE = "froggy-enriched-view";

/** Strategy-owned schema declaration for the opaque view (non-canonical ref). */
export const ENRICHED_VIEW_SCHEMA_REF =
  "afi-core://analysts/froggy.enrichment_adapter.js#FroggyEnrichedView";

/** Self-label carried on emitted ProvenanceRecord notes. */
export const REFERENCE_IMPLEMENTATION_NOTE =
  "Reference implementation / implementation profile: one example " +
  "signal-evaluation path emitting a D2-compatible artifact surface. " +
  "Not the canonical AFI pipeline — canonical status belongs to the merged " +
  "afi-config schemas, validation rules, and hash doctrine only. The " +
  "ingestion/normalization method used here is a reference adapter/profile; " +
  "USS v1.1 compatibility (not this normalization method) is the canonical " +
  "requirement.";

/** Fixture-backed evidence source ids (reference implementation profile). */
export const FIXTURE_SOURCE_IDS = {
  ohlcv: "src-fixture-ohlcv",
  news: "src-fixture-news",
  social: "src-fixture-social",
  aiml: "src-fixture-aiml",
} as const;

/**
 * Keys that must NEVER appear in D2 canonical outputs (runtime/storage
 * baggage, debug fields, and out-of-scope protocol areas). The merged schemas
 * already reject these structurally via `additionalProperties: false`; this
 * guard is the defensive in-process check (it also scans the opaque
 * strategy-local view).
 */
export const FORBIDDEN_ARTIFACT_KEYS = [
  "rawUss",
  "lenses",
  "_priceFeedMetadata",
  "_id",
  "createdAt",
  "updatedAt",
  "rawPayload",
  "claimRoot",
  "rewardAmount",
  "vaultAddress",
  "validatorDecision",
  "demoOnly",
] as const;

const FORBIDDEN_KEY_SET: ReadonlySet<string> = new Set(FORBIDDEN_ARTIFACT_KEYS);

/** Recursively collect the paths of any forbidden keys present in a value. */
export function findForbiddenArtifactKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      hits.push(...findForbiddenArtifactKeys(item, `${path}[${index}]`))
    );
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_SET.has(key)) {
        hits.push(`${path}.${key}`);
      }
      hits.push(...findForbiddenArtifactKeys(child, `${path}.${key}`));
    }
  }
  return hits;
}

/** Deterministic ref to the ReplayProfile for a signal (id-derived only). */
export function replayProfileRefFor(signalId: string): string {
  return `replay-profile:${signalId}`;
}

/**
 * Deterministic ref to the ProvenanceRecord for a signal. Derived ONLY from
 * the signalId — never from any digest of the record — so the ScoredSignal
 * projection can carry it without creating a hash cycle (see module header).
 */
export function provenanceRecordRefFor(signalId: string): string {
  return `provenance-record:${signalId}`;
}

function isoFromEpochMs(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function laneResult(
  bundleLanes: Record<AnalysisLaneId, AnalysisLaneResult>,
  lane: AnalysisLaneId
): AnalysisLaneResult | undefined {
  return bundleLanes[lane];
}

/** Inputs to {@link buildEvidenceRefs}. */
export interface EvidenceBuildInput {
  signalId: string;
  /** Committed OHLCV consumed by the wired lanes. */
  candles: AfiCandle[];
  /** Lane results (fixture payloads for the provisional lanes). */
  lanes: Record<AnalysisLaneId, AnalysisLaneResult>;
}

/**
 * Build hash-only EvidenceRef v1 objects for the committed fixture inputs the
 * lanes actually consumed. Evidence timestamps are normalized DOMAIN
 * timestamps derived from the evidence content itself (candle close time,
 * item publish time) — never runtime wall-clock.
 */
export function buildEvidenceRefs(input: EvidenceBuildInput): EvidenceRefV1[] {
  const refs: EvidenceRefV1[] = [];
  const { signalId, candles, lanes } = input;

  if (candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    refs.push({
      evidenceId: `ev-${signalId}-ohlcv`,
      sourceRef: FIXTURE_SOURCE_IDS.ohlcv,
      evidenceHash: computeCanonicalHashV1(
        projectDecimalFieldsForHash(candles, OHLCV_DECIMAL_KEYS),
        { domainTag: D2_DOMAIN_TAGS.evidence }
      ),
      asOf: isoFromEpochMs(lastCandle.timestamp),
      mediaType: "application/json",
      redactionStatus: "disclosed",
      notes: "Committed OHLCV fixture (reference implementation input).",
    });
  }

  const fixtureLanes: Array<{
    lane: AnalysisLaneId;
    sourceRef: string;
    suffix: string;
  }> = [
    { lane: "news", sourceRef: FIXTURE_SOURCE_IDS.news, suffix: "news" },
    { lane: "social", sourceRef: FIXTURE_SOURCE_IDS.social, suffix: "social" },
    { lane: "ai-ml", sourceRef: FIXTURE_SOURCE_IDS.aiml, suffix: "aiml" },
  ];

  for (const { lane, sourceRef, suffix } of fixtureLanes) {
    const result = laneResult(lanes, lane);
    if (result === undefined || isDegradedLaneResult(result)) {
      continue; // no fixture evidence when the lane degraded
    }
    const ref: EvidenceRefV1 = {
      evidenceId: `ev-${signalId}-${suffix}`,
      sourceRef,
      evidenceHash: computeCanonicalHashV1(
        projectDecimalFieldsForHash(result.payload, ENRICHMENT_DECIMAL_KEYS),
        { domainTag: D2_DOMAIN_TAGS.evidence }
      ),
      mediaType: "application/json",
      redactionStatus: "disclosed",
      notes: "Committed lane fixture (reference implementation input).",
    };
    if (lane === "news") {
      const postedAt = newestPublishedAt(result.payload);
      if (postedAt !== undefined) {
        ref.postedAt = postedAt;
      }
    }
    refs.push(ref);
  }

  return refs;
}

/** Newest `publishedAt` among news fixture items (deterministic; ISO strings sort lexicographically). */
function newestPublishedAt(payload: unknown): string | undefined {
  const items =
    payload !== null && typeof payload === "object"
      ? (payload as { items?: Array<{ publishedAt?: unknown }> }).items
      : undefined;
  if (!Array.isArray(items)) {
    return undefined;
  }
  const stamps = items
    .map((item) => item?.publishedAt)
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .sort();
  return stamps.length > 0 ? stamps[stamps.length - 1] : undefined;
}

/**
 * Descriptive SourceDisclosureProfile v1 objects for the committed fixture
 * sources. Fully disclosed (the fixtures live in the repo) and deterministic
 * to replay. Descriptive metadata only — no evaluation/weighting semantics.
 */
export function buildSourceDisclosureProfiles(): SourceDisclosureProfileV1[] {
  const common = {
    disclosureLevel: "full" as const,
    replayabilityLevel: "deterministic" as const,
    providerAttestation: "none" as const,
  };
  return [
    {
      sourceId: FIXTURE_SOURCE_IDS.ohlcv,
      sourceClass: "market-data-vendor",
      ...common,
      analystVisibleSummary:
        "Committed OHLCV fixture (BTC/USDT perp 4h) consumed by the wired lanes.",
      notes: "Reference implementation fixture source; payload committed in-repo.",
    },
    {
      sourceId: FIXTURE_SOURCE_IDS.news,
      sourceClass: "news",
      ...common,
      analystVisibleSummary: "Committed news fixture consumed by the news lane.",
      notes: "Reference implementation fixture source; payload committed in-repo.",
    },
    {
      sourceId: FIXTURE_SOURCE_IDS.social,
      sourceClass: "social",
      ...common,
      analystVisibleSummary:
        "Committed social/sentiment fixture consumed by the social lane.",
      notes: "Reference implementation fixture source; payload committed in-repo.",
    },
    {
      sourceId: FIXTURE_SOURCE_IDS.aiml,
      sourceClass: "model-output",
      ...common,
      analystVisibleSummary: "Committed AI/ML fixture consumed by the ai-ml lane.",
      notes: "Reference implementation fixture source; payload committed in-repo.",
    },
  ];
}

/** Which fixture source (and evidence suffix) backs each lane. */
const LANE_EVIDENCE_BINDING: Record<
  AnalysisLaneId,
  { sourceRef: string; evidenceSuffix: string }
> = {
  "technical-indicators": {
    sourceRef: FIXTURE_SOURCE_IDS.ohlcv,
    evidenceSuffix: "ohlcv",
  },
  "pattern-recognition": {
    sourceRef: FIXTURE_SOURCE_IDS.ohlcv,
    evidenceSuffix: "ohlcv",
  },
  news: { sourceRef: FIXTURE_SOURCE_IDS.news, evidenceSuffix: "news" },
  social: { sourceRef: FIXTURE_SOURCE_IDS.social, evidenceSuffix: "social" },
  "ai-ml": { sourceRef: FIXTURE_SOURCE_IDS.aiml, evidenceSuffix: "aiml" },
};

/**
 * Per-lane EnrichmentProvenance v1 records for the five analysis lanes.
 * Generic lane provenance only — no strategy-specific lane payload fields are
 * canonized; the lane output participates via `laneOutputHash`.
 */
export function buildEnrichmentProvenance(
  bundle: AnalysisBundle,
  evidenceRefs: EvidenceRefV1[]
): EnrichmentProvenanceV1[] {
  const evidenceIds = new Set(evidenceRefs.map((ref) => ref.evidenceId));
  const records: EnrichmentProvenanceV1[] = [];

  for (const lane of ANALYSIS_LANE_IDS) {
    const result = laneResult(bundle.lanes, lane);
    const binding = LANE_EVIDENCE_BINDING[lane];
    const degraded = result !== undefined && isDegradedLaneResult(result);
    const provisional = LANE_PROVISIONAL[lane];

    const record: EnrichmentProvenanceV1 = {
      laneId: lane,
      engineId: PIPEHEAD_ENGINE_ID,
      laneVersion: LANE_VERSIONS[lane],
      engineVersion: PIPEHEAD_ENGINE_VERSION,
      provisional,
      status: degraded ? "failed" : provisional ? "provisional" : "complete",
      replayabilityLevel: "deterministic",
      sourceDisclosureRefs: [binding.sourceRef],
    };

    const laneEvidenceId = `ev-${bundle.signalId}-${binding.evidenceSuffix}`;
    if (evidenceIds.has(laneEvidenceId)) {
      record.evidenceRefs = [laneEvidenceId];
    }

    if (result !== undefined) {
      record.laneOutputHash = computeCanonicalHashV1(
        projectDecimalFieldsForHash(result.payload, ENRICHMENT_DECIMAL_KEYS),
        { domainTag: D2_DOMAIN_TAGS.laneOutput }
      );
      if (degraded) {
        record.notes =
          "Lane degraded: runner failure isolated by the fan-out coordinator.";
      }
    }

    records.push(record);
  }

  return records;
}

/** Inputs to {@link buildAnalystInputEnvelope}. */
export interface EnvelopeBuildInput {
  bundle: AnalysisBundle;
  rawUss: unknown;
  evidenceRefs: EvidenceRefV1[];
  sourceDisclosureProfiles: SourceDisclosureProfileV1[];
  enrichmentProvenance: EnrichmentProvenanceV1[];
  replayProfileRef: string;
}

function providerIdFromUss(rawUss: unknown): string | undefined {
  if (rawUss === null || typeof rawUss !== "object") {
    return undefined;
  }
  const provenance = (rawUss as { provenance?: unknown }).provenance;
  if (provenance === null || typeof provenance !== "object") {
    return undefined;
  }
  const providerId = (provenance as { providerId?: unknown }).providerId;
  return typeof providerId === "string" && providerId.length > 0
    ? providerId
    : undefined;
}

/**
 * Wrap the strategy-local enriched view in a strict AnalystInputEnvelope v1.
 * The view stays OPAQUE and non-canonical: it is declared via
 * `strategyViewType` + `enrichedViewSchemaRef` and participates in hashing
 * ONLY through the explicit `strategyLocalViewHash` pin. FroggyEnrichedView
 * internals are never canonized.
 */
export function buildAnalystInputEnvelope(
  input: EnvelopeBuildInput
): AnalystInputEnvelopeV1 {
  const { bundle, rawUss } = input;
  const strategyLocalView = bundle.enrichedView as Record<string, unknown>;

  const envelope: AnalystInputEnvelopeV1 = {
    schema: ANALYST_INPUT_ENVELOPE_SCHEMA,
    signalId: bundle.signalId,
    analystId: REFERENCE_ANALYST_ID,
    strategyId: REFERENCE_STRATEGY_ID,
    strategyViewType: STRATEGY_VIEW_TYPE,
    enrichedViewSchemaRef: ENRICHED_VIEW_SCHEMA_REF,
    strategyLocalView,
    strategyLocalViewHash: computeCanonicalHashV1(
      projectDecimalFieldsForHash(strategyLocalView, ENRICHMENT_DECIMAL_KEYS),
      { domainTag: D2_DOMAIN_TAGS.strategyLocalView }
    ),
    sourceDisclosureProfiles: input.sourceDisclosureProfiles,
    evidenceRefs: input.evidenceRefs,
    enrichmentProvenance: input.enrichmentProvenance,
    replayProfileRef: input.replayProfileRef,
  };

  const providerId = providerIdFromUss(rawUss);
  if (providerId !== undefined) {
    envelope.providerId = providerId;
  }

  return envelope;
}

/** Options for {@link buildScoredSignalProjection}. */
export interface ScoredSignalProjectionOptions {
  providerId?: string;
  /**
   * Deterministic ref to the ProvenanceRecord (id-derived only; never a
   * digest of the record — see the no-cycle note in the module header).
   */
  provenanceRecordRef: string;
  /**
   * OPTIONAL domain-declared evaluation time (e.g. the OHLCV evidence asOf /
   * candle close). Never wall-clock runtime; the volatile `scoredAt` on the
   * internal carrier is NEVER emitted.
   */
  evaluatedAt?: string;
}

/** Shape of the verbatim afi-core analystScore (read, never recomputed). */
interface AnalystScoreFields {
  analystId?: unknown;
  strategyId?: unknown;
  strategyVersion?: unknown;
  direction?: unknown;
  riskBucket?: unknown;
  conviction?: unknown;
}

/**
 * Project the internal scoring result into the thin ScoredSignal v1
 * projection. PROJECTION ONLY: every scoring value is read verbatim from the
 * afi-core `analystScore` / carrier — nothing is recomputed, re-weighted, or
 * adjusted here.
 */
export function buildScoredSignalProjection(
  scored: InternalScoringResult,
  options: ScoredSignalProjectionOptions
): ScoredSignalV1 {
  const analyst = (scored.analystScore ?? {}) as AnalystScoreFields;
  const direction = analyst.direction;
  if (direction !== "long" && direction !== "short" && direction !== "neutral") {
    throw new Error(
      `buildScoredSignalProjection: unsupported direction "${String(direction)}"`
    );
  }

  const projection: ScoredSignalV1 = {
    schema: SCORED_SIGNAL_SCHEMA,
    signalId: scored.signalId,
    analystId: String(analyst.analystId ?? REFERENCE_ANALYST_ID),
    strategyId: String(analyst.strategyId ?? REFERENCE_STRATEGY_ID),
    direction,
    uwrScore: scored.uwrScore,
    uwrAxes: {
      structure: scored.uwrAxes.structure,
      execution: scored.uwrAxes.execution,
      risk: scored.uwrAxes.risk,
      insight: scored.uwrAxes.insight,
    },
    provenanceRecordRef: options.provenanceRecordRef,
  };

  if (typeof analyst.strategyVersion === "string") {
    projection.strategyVersion = analyst.strategyVersion;
  }
  if (typeof analyst.riskBucket === "string" && analyst.riskBucket.length > 0) {
    projection.riskBucket = analyst.riskBucket;
  }
  if (typeof analyst.conviction === "number") {
    projection.conviction = analyst.conviction;
  }
  if (options.providerId !== undefined) {
    projection.providerId = options.providerId;
  }
  if (options.evaluatedAt !== undefined) {
    projection.evaluatedAt = options.evaluatedAt;
  }

  return projection;
}

/** Inputs to {@link buildReplayProfile}. */
export interface ReplayProfileBuildInput {
  evidenceRefs: EvidenceRefV1[];
  /** Optional code-commit pin; omitted by default to keep goldens stable. */
  codeCommit?: string;
}

/**
 * D2-conformant ReplayProfile v1 for this reference run: committed fixtures +
 * an injected frozen clock + a deterministic kernel make the run
 * byte-reproducible, and the USS facts block is required.
 */
export function buildReplayProfile(input: ReplayProfileBuildInput): ReplayProfileV1 {
  const profile: ReplayProfileV1 = {
    schema: REPLAY_PROFILE_SCHEMA,
    replayabilityLevel: "deterministic",
    factsRequired: true,
    datasetId: FIXTURE_DATASET_ID,
    evidenceRefs: input.evidenceRefs.map((ref) => ref.evidenceId),
    evidenceHashes: input.evidenceRefs.map((ref) => ref.evidenceHash),
    sourceRefs: [...new Set(input.evidenceRefs.map((ref) => ref.sourceRef))],
    laneVersions: { ...LANE_VERSIONS },
  };
  if (input.codeCommit !== undefined) {
    profile.codeCommit = input.codeCommit;
  }
  return profile;
}

/** Inputs to {@link buildProvenanceRecord}. */
export interface ProvenanceRecordBuildInput {
  rawUss: unknown;
  bundle: AnalysisBundle;
  /** The FINISHED ScoredSignal v1 projection (built first; see no-cycle note). */
  scoredSignal: ScoredSignalV1;
  evidenceRefs: EvidenceRefV1[];
  replayProfileRef: string;
}

/**
 * Canonical material for the enrichment-bundle hash: the internal
 * AnalysisBundle without its `provenance` block (which itself carries the
 * input hash — excluded to keep the enrichment commitment independent of
 * hash-of-hash nesting).
 */
export function enrichmentBundleMaterial(bundle: AnalysisBundle): unknown {
  const { provenance: _provenance, ...material } = bundle;
  return material;
}

/** Compute the signal-input domain hash of the validated raw USS. */
export function computeInputHash(rawUss: unknown): CanonicalHashV1 {
  return computeCanonicalHashV1(rawUss, {
    domainTag: D2_DOMAIN_TAGS.signalInput,
  });
}

/** Compute the enrichment-bundle domain hash of the bundle material. */
export function computeEnrichmentHash(bundle: AnalysisBundle): CanonicalHashV1 {
  return computeCanonicalHashV1(
    projectDecimalFieldsForHash(
      enrichmentBundleMaterial(bundle),
      ENRICHMENT_DECIMAL_KEYS
    ),
    { domainTag: D2_DOMAIN_TAGS.enrichmentBundle }
  );
}

/** Compute the scored-output domain hash of a FINISHED ScoredSignal projection. */
export function computeScoredOutputHash(
  scoredSignal: ScoredSignalV1
): CanonicalHashV1 {
  return computeCanonicalHashV1(
    projectDecimalFieldsForHash(scoredSignal, SCORE_DECIMAL_KEYS),
    { domainTag: D2_DOMAIN_TAGS.scoredOutput }
  );
}

/**
 * Generalized per-pass ProvenanceRecord v1 binding input, enrichment, and
 * output through CanonicalHash v1 digests. Carries NO storage profile (this
 * path persists nothing), no on-chain commitments, no claims, and no
 * validator-decision fields. Built AFTER the ScoredSignal projection so the
 * output commitment is one-directional (no hash cycle — see module header).
 */
export function buildProvenanceRecord(
  input: ProvenanceRecordBuildInput
): ProvenanceRecordV1 {
  const inputHash = computeInputHash(input.rawUss);
  const enrichmentHash = computeEnrichmentHash(input.bundle);
  const outputHash = computeScoredOutputHash(input.scoredSignal);

  const domainTags = [
    inputHash.domainTag,
    enrichmentHash.domainTag,
    outputHash.domainTag,
    ...input.evidenceRefs.map((ref) => ref.evidenceHash.domainTag),
  ];

  return {
    schema: PROVENANCE_RECORD_SCHEMA,
    signalId: input.bundle.signalId,
    canonicalizationVersion: AFI_HASH_V1,
    inputHash,
    enrichmentHash,
    outputHash,
    evidenceRefs: input.evidenceRefs,
    sourceDisclosureRefs: [
      ...new Set(input.evidenceRefs.map((ref) => ref.sourceRef)),
    ],
    replayProfileRef: input.replayProfileRef,
    domainTags: [...new Set(domainTags)],
    schemaVersions: {
      input: "afi.usignal.v1.1",
      envelope: "afi.analyst-input-envelope.v1",
      output: "afi.scored-signal.v1",
      replay: "afi.replay-profile.v1",
    },
    notes: REFERENCE_IMPLEMENTATION_NOTE,
  };
}
