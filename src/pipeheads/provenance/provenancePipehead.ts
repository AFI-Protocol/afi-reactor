/**
 * Provenance pipehead — the final stage of the D2-native reference pipeline.
 * Projects the internal scoring result into the outward D2 artifact set:
 *
 *   - ScoredSignal v1 projection  (thin canonical projection; scoring values
 *     read VERBATIM from the afi-core analystScore, never recomputed)
 *   - ReplayProfile v1            (deterministic replay pins for this run)
 *   - ProvenanceRecord v1         (input/enrichment/output CanonicalHash v1
 *     digests + evidence and disclosure references)
 *
 * Every artifact is checked in-process against the merged afi-config schemas
 * (schemaValidation.ts) AND the forbidden-key guard (builders.ts); a failure
 * surfaces as a STRUCTURED value (`status: "failed"`), never an uncaught
 * throw.
 *
 * NO CIRCULAR HASHING: the ScoredSignal projection is built FIRST and carries
 * only the deterministic, id-derived `provenanceRecordRef`; the
 * ProvenanceRecord's `outputHash` then commits to that finished projection
 * (one-directional commitment — see builders.ts module header).
 *
 * ESM: relative imports use `.js`.
 */

import type {
  AnalysisBundle,
  InternalScoringResult,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "../types.js";
import {
  buildProvenanceRecord,
  buildReplayProfile,
  buildScoredSignalProjection,
  findForbiddenArtifactKeys,
  provenanceRecordRefFor,
  replayProfileRefFor,
  FIXTURE_SOURCE_IDS,
} from "./builders.js";
import { validateD2Artifact, type D2ArtifactKind } from "./schemaValidation.js";
import type {
  AnalystInputEnvelopeV1,
  ProvenanceRecordV1,
  ReplayProfileV1,
  ScoredSignalV1,
} from "./types.js";

export const PROVENANCE_PIPEHEAD_ID = "provenance";

/** Input: the internal intermediates the projection is derived from. */
export interface ProvenancePipeheadInput {
  bundle: AnalysisBundle;
  envelope: AnalystInputEnvelopeV1;
  scored: InternalScoringResult;
}

/** The outward D2 artifact set emitted by one successful pass. */
export interface D2ArtifactSet {
  scoredSignal: ScoredSignalV1;
  replayProfile: ReplayProfileV1;
  provenanceRecord: ProvenanceRecordV1;
}

/** One structured artifact-validation error. */
export interface D2ArtifactValidationError {
  artifact: D2ArtifactKind | "forbidden-keys";
  field: string;
  message: string;
}

export type ProvenancePipeheadOutput =
  | { ok: true; artifacts: D2ArtifactSet }
  | { ok: false; stage: "artifact-validation"; errors: D2ArtifactValidationError[] };

/**
 * Derive the OPTIONAL domain-declared evaluation time from the envelope's
 * OHLCV evidence `asOf` (the candle close the evaluation is valid for).
 * Deterministic domain evidence — never runtime wall-clock.
 */
export function deriveEvaluatedAt(
  envelope: AnalystInputEnvelopeV1
): string | undefined {
  const ohlcv = (envelope.evidenceRefs ?? []).find(
    (ref) => ref.sourceRef === FIXTURE_SOURCE_IDS.ohlcv
  );
  return ohlcv?.asOf;
}

function collectValidationErrors(
  artifacts: Array<{ kind: D2ArtifactKind; value: unknown }>
): D2ArtifactValidationError[] {
  const errors: D2ArtifactValidationError[] = [];
  for (const { kind, value } of artifacts) {
    const forbidden = findForbiddenArtifactKeys(value);
    for (const path of forbidden) {
      errors.push({
        artifact: "forbidden-keys",
        field: path,
        message: `forbidden key present in ${kind} output`,
      });
    }
    const result = validateD2Artifact(kind, value);
    if (!result.ok) {
      for (const err of result.errors) {
        errors.push({ artifact: kind, field: err.field, message: err.message });
      }
    }
  }
  return errors;
}

/**
 * Build and validate the outward D2 artifact set for one pass. Pure given
 * `(bundle, envelope, scored, rawUss)`; returns a structured value in both
 * the success and failure cases.
 */
export function buildD2Artifacts(
  input: ProvenancePipeheadInput,
  rawUss: unknown
): ProvenancePipeheadOutput {
  const { bundle, envelope, scored } = input;
  const evidenceRefs = envelope.evidenceRefs ?? [];
  const replayProfileRef =
    envelope.replayProfileRef ?? replayProfileRefFor(bundle.signalId);

  // 1. ScoredSignal v1 FIRST — carries only the deterministic id-derived ref
  //    (no digest of the record), so no hash cycle can form.
  const scoredSignal = buildScoredSignalProjection(scored, {
    providerId: envelope.providerId,
    provenanceRecordRef: provenanceRecordRefFor(bundle.signalId),
    evaluatedAt: deriveEvaluatedAt(envelope),
  });

  // 2. ReplayProfile v1 from the envelope's evidence pins.
  const replayProfile = buildReplayProfile({ evidenceRefs });

  // 3. ProvenanceRecord v1 LAST — its outputHash commits to the FINISHED
  //    ScoredSignal projection (one-directional commitment).
  const provenanceRecord = buildProvenanceRecord({
    rawUss,
    bundle,
    scoredSignal,
    evidenceRefs,
    replayProfileRef,
  });

  const errors = collectValidationErrors([
    { kind: "analyst-input-envelope", value: envelope },
    { kind: "scored-signal", value: scoredSignal },
    { kind: "replay-profile", value: replayProfile },
    { kind: "provenance-record", value: provenanceRecord },
  ]);
  if (errors.length > 0) {
    return { ok: false, stage: "artifact-validation", errors };
  }

  return { ok: true, artifacts: { scoredSignal, replayProfile, provenanceRecord } };
}

/** The provenance step as a typed pipehead. */
export const provenancePipehead: Pipehead<
  ProvenancePipeheadInput,
  ProvenancePipeheadOutput
> = {
  id: PROVENANCE_PIPEHEAD_ID,
  kind: "provenance",
  async execute(
    input: ProvenancePipeheadInput,
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<ProvenancePipeheadOutput>> {
    const startedAt = ctx.clock();
    const output = buildD2Artifacts(input, ctx.rawUss);
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: output.ok ? "ok" : "failed",
      provisional: false,
      output,
      startedAt,
      finishedAt,
    };
  },
};
