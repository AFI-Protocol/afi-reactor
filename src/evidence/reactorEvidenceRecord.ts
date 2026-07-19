/**
 * Construct the governed canonical evidence record from a Reactor scored
 * signal — `afi.scored-signal-evidence.v3` (EV3-GOV D-EV3-1: the v2 record
 * shape carried forward UNCHANGED plus exactly three additions —
 * providerInvocations, recordHash, replayHash; the evidence contract's own
 * change-control rule is followed exactly — new decision, new schema
 * version, never a silent mutation).
 *
 * This is the SOLE current Evidence V3 builder (D-EV3-5(3)). It receives the
 * completed scored evaluation state and the five bound invocation proofs and
 * FAILS CLOSED on: a missing, duplicate, or unknown category proof;
 * mis-ordered proofs; a category/result-schema mismatch; a Provider,
 * ProviderInstance, or adapter identity that differs from the boot-verified
 * governed registry resolution; a category-result hash that does not equal
 * the recomputed hash of the result the analyst path actually consumed; a
 * Tiny Brains projection that fails its cross-checks; a credential-binding
 * fact inconsistent with the instance's governed record; a composition,
 * analyst, or decay identity mismatch; or an unstampable UWR profile. A
 * failed cross-check yields NO scored V3 record — never a fabricated proof,
 * never a downgraded record, never a prior-version write.
 *
 * Evidence DESCRIBES the invocation that occurred; it never re-calls a
 * provider (D-EV3-5(2)): every cross-check here recomputes over facts
 * captured inside the one live graph pass.
 *
 * The v2 core construction is carried forward byte-for-byte: scoring values
 * are read VERBATIM from the afi-core analystScore (never recomputed); the
 * inputHash/outputHash preimages are UNCHANGED (byte-stable across the
 * v2→v3 switch). The lifecycle state is SCORED; finality is false — the
 * Reactor is a submitter, it does not certify, qualify, or finalize
 * (LIFE-GOV D-LIFE-3/D-LIFE-4).
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
import type { CanonicalHashRef } from "../pipeline/hashing.js";
import type { AnalysisCategory } from "../providers/types.js";
import {
  AIML_INVOCATION_PROOF_SCHEMA,
  PROOF_CATEGORY_ORDER,
  PROVIDER_INVOCATION_PROOF_SCHEMA,
  RESULT_SCHEMA_BY_CATEGORY,
  type ProviderInvocationProofV1,
} from "../providers/invocationProof.js";
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
import {
  categoryResultHash,
  evidenceRecordHash,
  evidenceReplayHash,
  providerResultHash,
} from "./provenance/invocationProofHashes.js";

export const EVIDENCE_SCHEMA = "afi.scored-signal-evidence.v3" as const;
/** SCORED — the only lifecycle state the Reactor submits (post-scoring handoff). */
export const REACTOR_LIFECYCLE_STATE = "SCORED" as const;

/**
 * One lane's EXPECTED identity facts — the boot-verified governed registry
 * resolution of the manifest's explicit provider selection (D-FLPR-4),
 * assembled by the graph scoring service (the evidence layer never reads
 * registries itself — RC-7). The Evidence V3 builder cross-checks every
 * captured invocation proof against these facts, fail closed (D-EV3-5(3)).
 */
export interface LaneBindingExpectation {
  category: AnalysisCategory;
  nodeId: string;
  providerInstanceId: string;
  instanceRecordVersion: string;
  providerId: string;
  providerRecordVersion: string;
  adapterId: string;
  adapterVersion: string;
  /** Present exactly when the governed instance record declares a model. */
  model?: string;
  /** The instance's opaque credential reference; keyless posture iff absent. */
  credentialRef?: string;
}

/**
 * The run's captured invocation facts (EV3-GOV D-EV3-5(2)): the per-lane
 * proofs captured inside the one live graph pass, the ACTUAL category
 * results the join consumed (for fail-closed hash recomputation), the
 * expected per-lane registry resolution, and the registration-resolved decay
 * identity. Produced by src/services/graphScoringService.ts; REQUIRED — a
 * run that cannot prove its invocations must refuse to submit.
 */
export interface EvidenceInvocationCapture {
  proofs: ProviderInvocationProofV1[];
  /** category -> the category result the analyst path ACTUALLY consumed. */
  laneResults: Partial<Record<AnalysisCategory, unknown>>;
  laneBindings: LaneBindingExpectation[];
  /** The registration-resolved decay identity (binds via analystConfigHash). */
  decay: { halfLifeMinutes: number; greeksTemplateId: string };
}

/**
 * The composition context of the scoring run — the complete
 * afi.composition-ref.v1 stamp plus the resolved registration identity the
 * registry-backed UWR stamp recognition consumes, plus the captured
 * invocation facts (EV3-GOV). Produced by
 * src/services/graphScoringService.ts; REQUIRED (all-or-nothing): a run that
 * cannot pin its full composition and prove its five invocations must refuse
 * to submit (fail closed).
 */
export interface EvidenceCompositionContext {
  composition: CompositionRefV1;
  registration: RecognizedStrategyRegistration;
  invocations: EvidenceInvocationCapture;
}

/**
 * The governed `afi.scored-signal-evidence.v3` record shape, as the Reactor
 * builds it — a STRICT reactor-owned view keyed on the Reactor's own
 * District-2 provenance types, so the builder is fully type-checked against
 * the exact projection/provenance shapes it emits. It is structurally the
 * governed record; the canonical contract lives in afi-config (vendored here
 * as scored-signal-evidence.v3.schema.json) and the submit path proves the
 * FULL record against that closure before submission; afi-infra's store
 * re-validates authoritatively on submit.
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
   * ACTUALLY produced the score and its exact source/provenance (RC-6),
   * recognized REGISTRY-BACKED through the resolved registration.
   */
  uwrProfile: UwrProfileStamp;
  /**
   * REQUIRED composition provenance (carried forward unchanged from v2): the
   * complete, hash-pinned identity of the composition that produced this
   * score (afi.composition-ref.v1).
   */
  composition: CompositionRefV1;
  /**
   * REQUIRED five-lane provider invocation proof collection (v3 addition,
   * D-EV3-2): exactly five, unique by category, ordered ascending
   * case-sensitive (aiMl, news, pattern, sentiment, technical). Carried,
   * never consumed.
   */
  providerInvocations: ProviderInvocationProofV1[];
  /** REQUIRED full-record integrity commitment (afi.d2.evidence-record). */
  recordHash: CanonicalHashRef;
  /** REQUIRED deterministic semantic/replay commitment (afi.d2.evidence-replay). */
  replayHash: CanonicalHashRef;
}

/** A failure to construct the canonical evidence artifacts from a scored signal
 *  (e.g. a non-canonicalizable input, an un-projectable direction, a missing
 *  triple member, missing composition provenance, or any D-EV3-5(3) proof
 *  cross-check failure). Surfaced as a first-class scoring-run failure —
 *  never masked. */
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

/**
 * The D-EV3-5(3) fail-closed mismatch taxonomy. Every builder cross-check
 * throws EvidenceProofViolationError with EXACTLY one of these reasons —
 * the contract/mutation test suites assert the precise reason tripped.
 */
export type EvidenceProofViolationReason =
  | "invocation-capture-missing"
  | "proof-count"
  | "proof-unknown-category"
  | "proof-duplicate-category"
  | "proof-mis-ordered"
  | "proof-malformed"
  | "result-schema-mismatch"
  | "registry-identity-mismatch"
  | "credential-binding-mismatch"
  | "lane-result-missing"
  | "category-result-hash-mismatch"
  | "provider-result-hash-mismatch"
  | "price-source-mismatch"
  | "aiml-invocation-missing"
  | "aiml-invocation-mismatch"
  | "decay-identity-mismatch"
  | "composition-identity-mismatch";

/** A D-EV3-5(3) proof/identity cross-check failure (fail closed, typed reason). */
export class EvidenceProofViolationError extends ReactorEvidenceConstructionError {
  readonly reason: EvidenceProofViolationReason;
  constructor(reason: EvidenceProofViolationReason, message: string, signalId?: string) {
    super(`Refusing to build the canonical v3 evidence record: ${message}`, signalId);
    this.name = "EvidenceProofViolationError";
    this.reason = reason;
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
 *  projection — UNCHANGED from v1/v2 (the composition stamp lives in the
 *  afi.composition-ref.v1 object; the per-lane commitments live in the
 *  invocation proofs' categoryResultHash values — PR-O1 resolved by
 *  D-EV3-4(4) with this record shape untouched). Input + output digests are
 *  required and sufficient; the record-level `enrichmentHash` field is
 *  omitted exactly as before. */
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

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(PROOF_CATEGORY_ORDER);

function hashesEqual(a: CanonicalHashRef, b: CanonicalHashRef): boolean {
  return (
    a.algorithm === b.algorithm &&
    a.canonicalizationVersion === b.canonicalizationVersion &&
    a.domainTag === b.domainTag &&
    a.value === b.value
  );
}

/**
 * The D-EV3-5(3) proof validation: exactly five proofs, unique, known,
 * deterministically ordered after sort; every identity fact equal to the
 * boot-verified registry resolution; every hash recomputed from the results
 * the analyst path ACTUALLY consumed. Returns the sorted proof five-tuple.
 */
function validateInvocationProofs(
  capture: EvidenceInvocationCapture,
  signalId: string
): ProviderInvocationProofV1[] {
  const proofs = capture.proofs ?? [];

  // -- category set law: unknown / duplicate / missing / count ------------
  for (const proof of proofs) {
    if (!KNOWN_CATEGORIES.has(proof.category)) {
      throw new EvidenceProofViolationError(
        "proof-unknown-category",
        `proof names unknown category '${String(proof.category)}'`,
        signalId
      );
    }
  }
  const seen = new Set<string>();
  for (const proof of proofs) {
    if (seen.has(proof.category)) {
      throw new EvidenceProofViolationError(
        "proof-duplicate-category",
        `duplicate proof for category '${proof.category}'`,
        signalId
      );
    }
    seen.add(proof.category);
  }
  for (const category of PROOF_CATEGORY_ORDER) {
    if (!seen.has(category)) {
      throw new EvidenceProofViolationError(
        "proof-count",
        `no invocation proof for category '${category}' — a scored evaluation requires all five lanes (D-EV3-5(1))`,
        signalId
      );
    }
  }
  if (proofs.length !== PROOF_CATEGORY_ORDER.length) {
    throw new EvidenceProofViolationError(
      "proof-count",
      `expected exactly ${PROOF_CATEGORY_ORDER.length} proofs, got ${proofs.length}`,
      signalId
    );
  }

  // -- deterministic order (ascending case-sensitive category) ------------
  const sorted = [...proofs].sort((a, b) =>
    a.category < b.category ? -1 : a.category > b.category ? 1 : 0
  );
  sorted.forEach((proof, index) => {
    if (proof.category !== PROOF_CATEGORY_ORDER[index]) {
      // Unique + known + all-five makes this unreachable — an internal error.
      throw new EvidenceProofViolationError(
        "proof-mis-ordered",
        `internal error: sorted proof[${index}] is '${proof.category}', expected '${PROOF_CATEGORY_ORDER[index]}'`,
        signalId
      );
    }
  });

  // -- per-proof cross-checks --------------------------------------------
  for (const proof of sorted) {
    const category = proof.category;
    if (proof.schema !== PROVIDER_INVOCATION_PROOF_SCHEMA) {
      throw new EvidenceProofViolationError(
        "proof-malformed",
        `'${category}' proof schema const is '${String(proof.schema)}'`,
        signalId
      );
    }
    if (proof.status !== "succeeded") {
      throw new EvidenceProofViolationError(
        "proof-malformed",
        `'${category}' proof status is '${String(proof.status)}' — a scored record admits only 'succeeded'`,
        signalId
      );
    }
    if (proof.resultSchema !== RESULT_SCHEMA_BY_CATEGORY[category]) {
      throw new EvidenceProofViolationError(
        "result-schema-mismatch",
        `'${category}' proof names result schema '${proof.resultSchema}', expected '${RESULT_SCHEMA_BY_CATEGORY[category]}'`,
        signalId
      );
    }

    // Boot-verified registry resolution agreement (identity chain).
    const binding = capture.laneBindings.find(
      (b) => b.category === category && b.providerInstanceId === proof.providerInstance.providerInstanceId
    ) ?? capture.laneBindings.find((b) => b.category === category);
    if (!binding) {
      throw new EvidenceProofViolationError(
        "registry-identity-mismatch",
        `no boot-verified lane binding exists for category '${category}'`,
        signalId
      );
    }
    const identityMismatches: string[] = [];
    if (proof.providerInstance.providerInstanceId !== binding.providerInstanceId) {
      identityMismatches.push("providerInstanceId");
    }
    if (proof.providerInstance.recordVersion !== binding.instanceRecordVersion) {
      identityMismatches.push("providerInstance.recordVersion");
    }
    if (proof.provider.providerId !== binding.providerId) identityMismatches.push("providerId");
    if (proof.provider.recordVersion !== binding.providerRecordVersion) {
      identityMismatches.push("provider.recordVersion");
    }
    if (proof.adapter.adapterId !== binding.adapterId) identityMismatches.push("adapterId");
    if (proof.adapter.adapterVersion !== binding.adapterVersion) {
      identityMismatches.push("adapterVersion");
    }
    if ((proof.providerInstance.model ?? undefined) !== (binding.model ?? undefined)) {
      identityMismatches.push("model");
    }
    if (identityMismatches.length > 0) {
      throw new EvidenceProofViolationError(
        "registry-identity-mismatch",
        `'${category}' proof identity differs from the boot-verified registry resolution: ${identityMismatches.join(", ")}`,
        signalId
      );
    }

    // Credential binding consistency (keyless iff no credentialRef on the instance).
    if (binding.credentialRef === undefined) {
      if (proof.credential.mode !== "keyless") {
        throw new EvidenceProofViolationError(
          "credential-binding-mismatch",
          `'${category}' proof claims a credential but the governed instance is keyless`,
          signalId
        );
      }
    } else {
      if (proof.credential.mode !== "credentialRef") {
        throw new EvidenceProofViolationError(
          "credential-binding-mismatch",
          `'${category}' proof claims keyless posture but the governed instance binds credentialRef '${binding.credentialRef}'`,
          signalId
        );
      }
      if (proof.credential.credentialRef !== binding.credentialRef) {
        throw new EvidenceProofViolationError(
          "credential-binding-mismatch",
          `'${category}' proof names credentialRef '${proof.credential.credentialRef}', instance binds '${binding.credentialRef}'`,
          signalId
        );
      }
    }

    // Category-result recomputation from the ACTUAL joined results
    // (D-EV3-5(3)): evidence never re-calls a provider — the results were
    // captured in the one live pass.
    const laneResult = capture.laneResults[category];
    if (laneResult === undefined || laneResult === null || typeof laneResult !== "object") {
      throw new EvidenceProofViolationError(
        "lane-result-missing",
        `no captured category result exists for '${category}' — cannot recompute its commitment`,
        signalId
      );
    }
    const recomputedFull = categoryResultHash(laneResult as { category: string });
    if (!hashesEqual(recomputedFull, proof.categoryResultHash)) {
      throw new EvidenceProofViolationError(
        "category-result-hash-mismatch",
        `'${category}' categoryResultHash does not equal the recomputed hash of the result the analyst path consumed`,
        signalId
      );
    }
    const recomputedPayload = providerResultHash(laneResult as { category: string });
    if (!hashesEqual(recomputedPayload, proof.providerResultHash)) {
      throw new EvidenceProofViolationError(
        "provider-result-hash-mismatch",
        `'${category}' providerResultHash does not equal the recomputed provider payload hash`,
        signalId
      );
    }

    // Source-reference law (D-EV3-2(6)): technical priceSource only.
    if (category === "technical") {
      const actual = (laneResult as { priceSource?: unknown }).priceSource;
      if (typeof actual === "string" && proof.priceSource !== actual) {
        throw new EvidenceProofViolationError(
          "price-source-mismatch",
          `technical proof priceSource '${String(proof.priceSource)}' differs from the consumed result's '${actual}'`,
          signalId
        );
      }
    } else if (proof.priceSource !== undefined) {
      throw new EvidenceProofViolationError(
        "price-source-mismatch",
        `'${category}' proof carries priceSource — admitted on the technical lane only`,
        signalId
      );
    }

    // aiMl nested proof law (D-EV3-3): required exactly on aiMl.
    if (category === "aiMl") {
      const nested = proof.aimlInvocation;
      if (!nested) {
        throw new EvidenceProofViolationError(
          "aiml-invocation-missing",
          "aiMl proof carries no nested afi.aiml-invocation-proof.v1",
          signalId
        );
      }
      const nestedIssues: string[] = [];
      if (nested.schema !== AIML_INVOCATION_PROOF_SCHEMA) nestedIssues.push("schema const");
      if (nested.status !== "succeeded") nestedIssues.push("status");
      if (nested.hashLaw !== "tiny-brains.hash.v1") nestedIssues.push("hashLaw");
      // The orchestration profile that ran MUST be the governed instance
      // model (the adapter already verified the service echo + outputHash
      // recomputation at the boundary; the builder re-checks the identity).
      if (binding.model === undefined || nested.profileId !== binding.model) {
        nestedIssues.push("profileId vs instance model");
      }
      if (!Array.isArray(nested.experts) || nested.experts.length === 0) {
        nestedIssues.push("experts empty");
      } else {
        for (let i = 0; i < nested.experts.length; i++) {
          const expert = nested.experts[i];
          if (expert.status !== "succeeded") nestedIssues.push(`experts[${i}].status`);
          if (i > 0 && nested.experts[i - 1].expertId >= expert.expertId) {
            nestedIssues.push("experts unsorted/duplicate");
          }
        }
      }
      if (nestedIssues.length > 0) {
        throw new EvidenceProofViolationError(
          "aiml-invocation-mismatch",
          `aiMl nested invocation proof failed its cross-checks: ${nestedIssues.join(", ")}`,
          signalId
        );
      }
    } else if (proof.aimlInvocation !== undefined) {
      throw new EvidenceProofViolationError(
        "aiml-invocation-mismatch",
        `'${category}' proof carries a nested aiMl invocation — structurally forbidden off the aiMl lane`,
        signalId
      );
    }
  }

  return sorted;
}

/**
 * Construct the complete governed evidence record. Any failure
 * (canonicalization, un-projectable direction, incomplete triple, unstampable
 * profile, missing or partial composition provenance, or ANY D-EV3-5(3)
 * proof/identity/hash cross-check) throws ReactorEvidenceConstructionError
 * (proof failures as its typed EvidenceProofViolationError subclass).
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
      `No composition provenance was propagated for signalId '${scored.signalId}' — a v3 evidence record either carries the full afi.composition-ref.v1 stamp or does not exist (fail closed).`,
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

  // Composition/analyst identity agreement (D-EV3-5(3), extending the
  // existing continuity proofs): the resolved registration triple MUST be
  // the triple the analyst path actually scored with.
  if (
    context.registration.analystId !== analyst.analystId ||
    context.registration.strategyId !== analyst.strategyId ||
    context.registration.strategyVersion !== strategyVersion
  ) {
    throw new EvidenceProofViolationError(
      "composition-identity-mismatch",
      `the resolved registration triple '${context.registration.analystId}/${context.registration.strategyId}@${context.registration.strategyVersion}' differs from the scored triple '${analyst.analystId}/${analyst.strategyId}@${strategyVersion}'`,
      scored.signalId
    );
  }

  // Captured invocation facts are REQUIRED (D-EV3-2/D-EV3-5(2)).
  const capture = context.invocations;
  if (!capture || !Array.isArray(capture.proofs) || !capture.laneBindings || !capture.laneResults) {
    throw new EvidenceProofViolationError(
      "invocation-capture-missing",
      `no invocation capture was propagated for signalId '${scored.signalId}' — a v3 record carries exactly five proven invocations or does not exist`,
      scored.signalId
    );
  }

  // Decay identity (D-EV3-5(3)): the runtime decay params MUST equal the
  // registration-resolved values (they bind via analystConfigHash — asserted
  // explicitly, fail closed).
  if (
    !scored.decayParams ||
    !capture.decay ||
    scored.decayParams.halfLifeMinutes !== capture.decay.halfLifeMinutes ||
    scored.decayParams.greeksTemplateId !== capture.decay.greeksTemplateId
  ) {
    throw new EvidenceProofViolationError(
      "decay-identity-mismatch",
      `the runtime decay params (${JSON.stringify(scored.decayParams)}) do not equal the registration-resolved decay identity (${JSON.stringify(capture.decay ?? null)})`,
      scored.signalId
    );
  }

  // The five-proof law (D-EV3-2) + every per-proof cross-check (D-EV3-5(3)).
  const providerInvocations = validateInvocationProofs(capture, scored.signalId);

  // Governed scoring-profile stamp, built from the source the composition path
  // ACTUALLY scored with (propagated verbatim on the scored signal — never
  // re-derived here, never read from the environment; RC-6) and recognized
  // REGISTRY-BACKED through the resolved registration (D-FCP-5).
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

  // Assemble the v2-core-plus-proofs record, then commit to it LAST:
  // recordHash over the record minus {recordHash, replayHash}; replayHash
  // over the replay projection (D-EV3-4(6)).
  const core = {
    schema: EVIDENCE_SCHEMA,
    signalId: scored.signalId,
    analystId: analyst.analystId,
    strategyId: analyst.strategyId,
    strategyVersion,
    canonicalizationVersion: AFI_HASH_V1,
    lifecycleState: REACTOR_LIFECYCLE_STATE,
    finalized: false as const,
    scoredSignal: projection,
    provenanceRecord,
    uwrProfile,
    composition: context.composition,
    providerInvocations,
  };
  const recordHash = evidenceRecordHash(core);
  const replayHash = evidenceReplayHash(core);
  return { ...core, recordHash, replayHash };
}
