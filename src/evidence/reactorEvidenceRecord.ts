/**
 * Construct the governed canonical evidence record from a Reactor scored
 * signal — `afi.scored-signal-evidence.v2` (FCP-GOV D-FCP-7: v2 = v1 + the
 * REQUIRED afi.composition-ref.v1 composition provenance; the evidence
 * contract's own change-control rule is followed exactly — new decision, new
 * schema version, never a silent mutation).
 *
 * Assembles the record from the Reactor's OWN canonical builders (no scoring
 * reopened, no new object / lifecycle semantics): the thin
 * `afi.scored-signal.v1` projection and the `afi.provenance-record.v1`
 * (input + output CanonicalHash v1 digests) — both preimages UNCHANGED from
 * v1 (inputHash/outputHash byte-stable across the v1→v2 switch) — plus the
 * canonical strategy identity triple, lifecycle state, finality flag, the
 * required schema/canonicalization versions, the registry-backed UWR profile
 * stamp, and the composition stamp handed in from the graph scoring run.
 *
 * Scoring values are read VERBATIM from the afi-core analystScore (never
 * recomputed). The lifecycle state is SCORED (post-scoring); finality is false
 * (SCORED is not a finalized state) — the Reactor is a submitter, it does not
 * certify, qualify, or finalize (LIFE-GOV D-LIFE-3/D-LIFE-4).
 */

import type {
  ReactorScoredSignalV1,
  UwrProfileStamp,
} from "../types/ReactorScoredSignalV1.js";
import {
  uwrProfileStampFor,
  type RecognizedStrategyRegistration,
} from "../config/uwrProfilePin.js";
import type { CompositionRefV1 } from "../pipeline/manifestTypes.js";
import type { InternalScoringResult } from "./analysis/internalScoringResult.js";
import type { ProvenanceRecordV1, ScoredSignalV1 } from "./provenance/types.js";
import { PROVENANCE_RECORD_SCHEMA } from "./provenance/types.js";
import { AFI_HASH_V1 } from "./provenance/canonicalHashV1.js";
import {
  buildScoredSignalProjection,
  computeInputHash,
  computeScoredOutputHash,
  provenanceRecordRefFor,
} from "./provenance/builders.js";

export const EVIDENCE_SCHEMA = "afi.scored-signal-evidence.v2" as const;
/** SCORED — the only lifecycle state the Reactor submits (post-scoring handoff). */
export const REACTOR_LIFECYCLE_STATE = "SCORED" as const;

/**
 * The composition context of the scoring run — the complete
 * afi.composition-ref.v1 stamp plus the resolved registration identity the
 * registry-backed UWR stamp recognition consumes. Produced by
 * src/services/graphScoringService.ts; REQUIRED (all-or-nothing): a run that
 * cannot pin its full composition must refuse to submit (fail closed).
 */
export interface EvidenceCompositionContext {
  composition: CompositionRefV1;
  registration: RecognizedStrategyRegistration;
}

/**
 * The governed `afi.scored-signal-evidence.v2` record shape, as the Reactor
 * builds it — a STRICT reactor-owned view keyed on the Reactor's own District-2
 * provenance types (`ScoredSignalV1` / `ProvenanceRecordV1`), so the builder is
 * fully type-checked against the exact projection/provenance shapes it emits.
 * It is structurally the governed record; the canonical contract lives in
 * afi-config (vendored here as scored-signal-evidence.v2.schema.json) and the
 * submit path proves the FULL record against that schema before submission;
 * afi-infra's store re-validates authoritatively on submit.
 */
export interface ReactorEvidenceRecord {
  schema: typeof EVIDENCE_SCHEMA;
  signalId: string;
  analystId: string;
  strategyId: string;
  strategyVersion: string;
  canonicalizationVersion: string;
  lifecycleState: typeof REACTOR_LIFECYCLE_STATE;
  finalized: false;
  scoredSignal: ScoredSignalV1;
  provenanceRecord: ProvenanceRecordV1;
  /**
   * REQUIRED governed scoring-profile stamp: identifies the UWR profile that
   * ACTUALLY produced the score and its exact source/provenance. Built from
   * the source PROPAGATED by the composition path (never re-derived here) and
   * recognized REGISTRY-BACKED through the resolved registration (D-FCP-5 —
   * no froggy-only identity gate).
   */
  uwrProfile: UwrProfileStamp;
  /**
   * REQUIRED composition provenance (v2's one addition over v1): the
   * complete, hash-pinned identity of the composition that produced this
   * score (afi.composition-ref.v1 — pipeline manifest, analyst config, scorer
   * plugin, plugin set, execution summary, enrichment bundle).
   */
  composition: CompositionRefV1;
}

/** A failure to construct the canonical evidence artifacts from a scored signal
 *  (e.g. a non-canonicalizable input, an un-projectable direction, a missing
 *  triple member, or missing composition provenance). Surfaced as a
 *  first-class scoring-run failure — never masked. */
export class ReactorEvidenceConstructionError extends Error {
  readonly code = "EVIDENCE_CONSTRUCTION" as const;
  readonly signalId?: string;
  readonly cause?: unknown;
  constructor(message: string, signalId?: string, cause?: unknown) {
    super(message);
    this.name = "ReactorEvidenceConstructionError";
    this.signalId = signalId;
    this.cause = cause;
  }
}

/** Hoist the score surface out of `analystScore` into the InternalScoringResult
 *  carrier shape the projection builder reads (uwrScore/uwrAxes at top level). */
function toInternalScoringResult(scored: ReactorScoredSignalV1): InternalScoringResult {
  const analyst = scored.analystScore;
  return {
    signalId: scored.signalId,
    uwrScore: analyst.uwrScore,
    uwrAxes: analyst.uwrAxes,
    analystScore: analyst,
    scoredAt: scored.scoredAt,
  };
}

/** Build the `afi.provenance-record.v1` from the raw USS input and the finished
 *  projection — UNCHANGED from v1 (the composition stamp lives in the NEW
 *  afi.composition-ref.v1 object, never as a provenance-record mutation;
 *  FCP-GOV §14 PR-O1). Input + output digests are required and sufficient;
 *  the record-level `enrichmentHash` field is omitted exactly as before (the
 *  composition's enrichmentHash carries the same domain at the composition
 *  layer). */
function buildProvenanceRecordForLive(
  scored: ReactorScoredSignalV1,
  projection: ScoredSignalV1
): ProvenanceRecordV1 {
  const inputHash = computeInputHash(scored.rawUss);
  const outputHash = computeScoredOutputHash(projection);
  return {
    schema: PROVENANCE_RECORD_SCHEMA,
    signalId: scored.signalId,
    canonicalizationVersion: AFI_HASH_V1,
    inputHash,
    outputHash,
    domainTags: [...new Set([inputHash.domainTag, outputHash.domainTag])],
    schemaVersions: {
      input: "afi.usignal.v1.1",
      output: "afi.scored-signal.v1",
    },
  };
}

const COMPOSITION_FIELDS: ReadonlyArray<keyof CompositionRefV1> = [
  "schema",
  "pipelineId",
  "pipelineVersion",
  "manifestHash",
  "analystConfigHash",
  "scorerPluginId",
  "scorerPluginVersion",
  "pluginSetHash",
  "executionSummaryHash",
  "enrichmentHash",
];

/**
 * Construct the complete governed evidence record. Any failure (canonicalization,
 * un-projectable direction, incomplete triple, unstampable profile, missing or
 * partial composition provenance) throws ReactorEvidenceConstructionError.
 */
export function buildReactorEvidenceRecord(
  scored: ReactorScoredSignalV1,
  context: EvidenceCompositionContext | null | undefined
): ReactorEvidenceRecord {
  const analyst = scored.analystScore;
  const strategyVersion = analyst.strategyVersion;
  if (!strategyVersion) {
    throw new ReactorEvidenceConstructionError(
      `analystScore.strategyVersion is required for the canonical strategy triple (OBJ-GOV D-OBJ-3) — signalId '${scored.signalId}'.`,
      scored.signalId
    );
  }

  // All-or-nothing composition provenance (afi.composition-ref.v1
  // x-afiConstraints): a run that cannot produce every pin refuses to submit.
  if (!context?.composition || !context.registration) {
    throw new ReactorEvidenceConstructionError(
      `No composition provenance was propagated for signalId '${scored.signalId}' — a v2 evidence record either carries the full afi.composition-ref.v1 stamp or does not exist (fail closed).`,
      scored.signalId
    );
  }
  for (const field of COMPOSITION_FIELDS) {
    if (context.composition[field] === undefined || context.composition[field] === null) {
      throw new ReactorEvidenceConstructionError(
        `Partial composition provenance for signalId '${scored.signalId}': '${String(field)}' is missing — refusing to submit (all-or-nothing).`,
        scored.signalId
      );
    }
  }

  // Governed scoring-profile stamp, built from the source the composition path
  // ACTUALLY scored with (propagated verbatim on the scored signal — never
  // re-derived here, never read from the environment; RC-6) and recognized
  // REGISTRY-BACKED through the resolved registration (D-FCP-5).
  // uwrProfileStampFor refuses to stamp an unrecognized profile/identity or an
  // unpropagated source, and the contract REQUIRES the stamp on every record —
  // so an unstampable score fails CLOSED here rather than persisting unstamped
  // evidence.
  let uwrProfile: UwrProfileStamp | undefined;
  try {
    uwrProfile = uwrProfileStampFor(analyst, scored.uwrResolvedSource, context.registration);
  } catch (err) {
    throw new ReactorEvidenceConstructionError(
      `Refusing to stamp the canonical evidence record for signalId '${scored.signalId}': ${(err as Error)?.message ?? String(err)}`,
      scored.signalId,
      err
    );
  }
  if (!uwrProfile) {
    throw new ReactorEvidenceConstructionError(
      `No governed UWR profile stamp is available for signalId '${scored.signalId}' ` +
        `(analystId '${analyst.analystId}', strategyId '${analyst.strategyId}' does not match ` +
        `the resolved registration, or the registration's uwrProfileRef is not a registered ` +
        `profile). The canonical contract REQUIRES the scoring-profile stamp on every evidence ` +
        `record, so this score cannot be persisted as canonical evidence.`,
      scored.signalId
    );
  }

  let projection: ScoredSignalV1;
  let provenanceRecord: ProvenanceRecordV1;
  try {
    projection = buildScoredSignalProjection(toInternalScoringResult(scored), {
      providerId: scored.rawUss?.provenance?.providerId,
      provenanceRecordRef: provenanceRecordRefFor(scored.signalId),
    });
    provenanceRecord = buildProvenanceRecordForLive(scored, projection);
  } catch (err) {
    throw new ReactorEvidenceConstructionError(
      `Failed to construct canonical evidence artifacts for signalId '${scored.signalId}': ${(err as Error)?.message ?? String(err)}`,
      scored.signalId,
      err
    );
  }

  return {
    schema: EVIDENCE_SCHEMA,
    signalId: scored.signalId,
    analystId: analyst.analystId,
    strategyId: analyst.strategyId,
    strategyVersion,
    canonicalizationVersion: AFI_HASH_V1,
    lifecycleState: REACTOR_LIFECYCLE_STATE,
    finalized: false,
    scoredSignal: projection,
    provenanceRecord,
    uwrProfile,
    composition: context.composition,
  };
}
