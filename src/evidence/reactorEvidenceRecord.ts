/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — construct the governed canonical evidence
 * record from a Reactor scored signal.
 *
 * Assembles the afi-config-governed `afi.scored-signal-evidence.v1` record from
 * the Reactor's OWN canonical builders (no scoring reopened, no new object /
 * lifecycle semantics): the thin `afi.scored-signal.v1` projection and the
 * `afi.provenance-record.v1` (input + output CanonicalHash v1 digests), plus the
 * canonical strategy identity triple, lifecycle state, finality flag, and the
 * required schema/canonicalization versions.
 *
 * Scoring values are read VERBATIM from the afi-core analystScore (never
 * recomputed). The lifecycle state is SCORED (post-scoring); finality is false
 * (SCORED is not a finalized state) — the Reactor is a submitter, it does not
 * certify, qualify, or finalize (LIFE-GOV D-LIFE-3/D-LIFE-4).
 */

import type { ReactorScoredSignalV1 } from "../types/ReactorScoredSignalV1.js";
import type { InternalScoringResult } from "../pipeheads/types.js";
import type { ProvenanceRecordV1, ScoredSignalV1 } from "../pipeheads/provenance/types.js";
import { PROVENANCE_RECORD_SCHEMA } from "../pipeheads/provenance/types.js";
import { AFI_HASH_V1 } from "../pipeheads/provenance/canonicalHashV1.js";
import {
  buildScoredSignalProjection,
  computeInputHash,
  computeScoredOutputHash,
  provenanceRecordRefFor,
} from "../pipeheads/provenance/builders.js";

export const EVIDENCE_SCHEMA = "afi.scored-signal-evidence.v1" as const;
/** SCORED — the only lifecycle state the Reactor submits (post-scoring handoff). */
export const REACTOR_LIFECYCLE_STATE = "SCORED" as const;

/**
 * The governed `afi.scored-signal-evidence.v1` record shape, mirrored locally.
 * The CANONICAL contract lives in afi-config; the afi-infra store validates the
 * full record authoritatively on submit. This Reactor-owned type keeps the
 * afi-infra TypeScript source out of the Reactor's compile graph (afi-infra
 * ships .ts only; the store is bound at the runtime submission boundary).
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
}

/** A failure to construct the canonical evidence artifacts from a scored signal
 *  (e.g. a non-canonicalizable input, an un-projectable direction, or a missing
 *  triple member). Surfaced as a first-class scoring-run failure — never masked. */
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
 *  projection. Input + output digests are required and sufficient for the
 *  governed contract; `enrichmentHash` is omitted (the live path emits no
 *  canonical AnalysisBundle — the field is schema-optional). */
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

/**
 * Construct the complete governed evidence record. Any failure (canonicalization,
 * un-projectable direction, incomplete triple) throws ReactorEvidenceConstructionError.
 */
export function buildReactorEvidenceRecord(
  scored: ReactorScoredSignalV1
): ReactorEvidenceRecord {
  const analyst = scored.analystScore;
  const strategyVersion = analyst.strategyVersion;
  if (!strategyVersion) {
    throw new ReactorEvidenceConstructionError(
      `analystScore.strategyVersion is required for the canonical strategy triple (OBJ-GOV D-OBJ-3) — signalId '${scored.signalId}'.`,
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
  };
}
